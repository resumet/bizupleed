import { audit, newId, now, one, parseJson, q, run, tx } from "./db";
import { AppError, Ctx, isServing, requireCan, scopeSql } from "./accounts";
import { sha256 } from "./crypto";
import { getCampaign, parsePixels, Pixels } from "./campaigns";
import { defaultContent, LandingContent, LandingMode, slugify, validateForPublish } from "./landing";

export type Landing = {
  id: string; workspace_id: string; campaign_id: string; name: string; slug: string; mode: LandingMode;
  status: "draft" | "published" | "paused" | "archived"; content_json: string; published_version_id: string | null;
  created_at: string; updated_at: string;
};
export type LandingRow = Landing & { campaign_title: string; client_name: string; client_id: string; lead_count: number };
export type LandingVersion = { id: string; landing_id: string; content_json: string; note: string | null; author_name: string | null; published_at: string };

const actor = (ctx: Ctx) => ({ id: ctx.userId, name: ctx.userName });
const SELECT = `SELECT p.*, c.title AS campaign_title, c.client_id, cl.name AS client_name,
  (SELECT COUNT(*) FROM leads l WHERE l.landing_id=p.id) AS lead_count
  FROM landings p JOIN campaigns c ON c.id=p.campaign_id JOIN clients cl ON cl.id=c.client_id`;

export async function listLandings(ctx: Ctx): Promise<LandingRow[]> {
  const s = scopeSql(ctx, "c.client_id", "p.workspace_id");
  return await q<LandingRow>(`${SELECT} WHERE ${s.sql} AND p.status!='archived' ORDER BY p.updated_at DESC`, ...s.params);
}

export async function getLanding(ctx: Ctx, id: string): Promise<LandingRow | undefined> {
  const s = scopeSql(ctx, "c.client_id", "p.workspace_id");
  return await one<LandingRow>(`${SELECT} WHERE p.id=? AND ${s.sql}`, id, ...s.params);
}

export const contentOf = (l: { content_json: string; mode: LandingMode; name: string }) =>
  parseJson<LandingContent>(l.content_json, defaultContent(l.mode, l.name));

export async function createLanding(ctx: Ctx, campaignId: string, name: string, mode: LandingMode, content?: LandingContent): Promise<string> {
  requireCan(ctx, "landing.edit");
  if (!name.trim()) throw new AppError("페이지 이름을 입력해 주세요.");
  if (!["card", "blog", "auto"].includes(mode)) throw new AppError("랜딩 형식이 올바르지 않습니다.");
  if (!await getCampaign(ctx, campaignId)) throw new AppError("캠페인을 찾을 수 없습니다.");
  const id = newId("lp_");
  const t = now();
  await run(
    "INSERT INTO landings VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    id, ctx.workspaceId, campaignId, name.trim(), slugify(name), mode, "draft",
    JSON.stringify(content ?? defaultContent(mode, name.trim())), null, t, t,
  );
  await audit(ctx.workspaceId, actor(ctx), "landing.create", "landing", id);
  return id;
}

/** 저장 전 최소 구조 검증. 렌더러는 URL 을 별도로 안전 처리한다. */
function assertContent(c: LandingContent) {
  const ok = c && typeof c === "object" && c.settings && Array.isArray(c.sections) && c.form && Array.isArray(c.form.fields);
  if (!ok) throw new AppError("콘텐츠 형식이 올바르지 않습니다.");
  if (c.sections.length > 60 || c.form.fields.length > 20) throw new AppError("섹션 또는 입력 항목이 너무 많습니다.");
  if (JSON.stringify(c).length > 400_000) throw new AppError("콘텐츠 용량이 너무 큽니다.");
  for (const f of c.form.fields) if (!/^[a-z][a-z0-9_]{0,30}$/.test(f.key)) throw new AppError(`입력 항목 키는 영문 소문자·숫자·_ 만 사용할 수 있습니다: ${f.key}`);
}

export async function saveLanding(ctx: Ctx, id: string, content: LandingContent, mode?: LandingMode) {
  requireCan(ctx, "landing.edit");
  const l = await getLanding(ctx, id);
  if (!l) throw new AppError("랜딩을 찾을 수 없습니다.");
  assertContent(content);
  const m = mode && ["card", "blog", "auto"].includes(mode) ? mode : l.mode;
  await run("UPDATE landings SET content_json=?, mode=?, name=?, updated_at=? WHERE id=?", JSON.stringify(content), m, content.settings.title.trim() || l.name, now(), id);
}

async function upsertConsent(ws: string, landingId: string, kind: string, text: string): Promise<string> {
  const h = sha256(text);
  const last = await one<{ id: string; text_hash: string; version: number }>(
    "SELECT id, text_hash, version FROM consent_versions WHERE landing_id=? AND kind=? ORDER BY version DESC LIMIT 1", landingId, kind);
  if (last && last.text_hash === h) return last.id;
  const id = newId("cv_");
  await run("INSERT INTO consent_versions VALUES (?,?,?,?,?,?,?,?)", id, ws, landingId, kind, text, h, (last?.version ?? 0) + 1, now());
  return id;
}

/** 발행: 검증 → 버전 스냅샷 → 동의 문구 버전 고정(C-08). */
export async function publishLanding(ctx: Ctx, id: string, note = "발행"): Promise<{ versionId: string }> {
  requireCan(ctx, "landing.edit");
  const l = await getLanding(ctx, id);
  if (!l) throw new AppError("랜딩을 찾을 수 없습니다.");
  const content = contentOf(l);
  const errors = validateForPublish(content).filter((i) => i.level === "error");
  if (errors.length) throw new AppError(`발행할 수 없습니다: ${errors.map((e) => e.message).join(" / ")}`);
  return await tx(async () => {
    const versionId = await snapshotVersion(l.workspace_id, id, content, note, ctx.userId, ctx.userName);
    await audit(ctx.workspaceId, actor(ctx), "landing.publish", "landing", id, { versionId });
    return { versionId };
  });
}

export async function snapshotVersion(ws: string, landingId: string, content: LandingContent, note: string, authorId: string | null, authorName: string | null): Promise<string> {
  const versionId = newId("lv_");
  const t = now();
  await run("INSERT INTO landing_versions VALUES (?,?,?,?,?,?,?,?)", versionId, ws, landingId, JSON.stringify(content), note, authorId, authorName, t);
  await upsertConsent(ws, landingId, "privacy", content.form.consentText);
  if (content.form.marketingEnabled) await upsertConsent(ws, landingId, "marketing", content.form.marketingText);
  await run("UPDATE landings SET status='published', published_version_id=?, content_json=?, updated_at=? WHERE id=?", versionId, JSON.stringify(content), t, landingId);
  return versionId;
}

export async function setLandingStatus(ctx: Ctx, id: string, status: "paused" | "archived" | "published") {
  requireCan(ctx, "landing.edit");
  const l = await getLanding(ctx, id);
  if (!l) throw new AppError("랜딩을 찾을 수 없습니다.");
  if (status === "published" && !l.published_version_id) throw new AppError("먼저 발행해 주세요.");
  await run("UPDATE landings SET status=?, updated_at=? WHERE id=?", status, now(), id);
  await audit(ctx.workspaceId, actor(ctx), `landing.${status}`, "landing", id);
}

export async function duplicateLanding(ctx: Ctx, id: string): Promise<string> {
  const l = await getLanding(ctx, id);
  if (!l) throw new AppError("랜딩을 찾을 수 없습니다.");
  const c = contentOf(l);
  c.settings.title = `${l.name} (복사본)`;
  return await createLanding(ctx, l.campaign_id, c.settings.title, l.mode, c);
}

export async function listVersions(ctx: Ctx, landingId: string): Promise<LandingVersion[]> {
  if (!await getLanding(ctx, landingId)) return [];
  return await q<LandingVersion>("SELECT id, landing_id, content_json, note, author_name, published_at FROM landing_versions WHERE landing_id=? ORDER BY published_at DESC LIMIT 30", landingId);
}

/** 이전 버전 내용을 편집본으로 불러온다(재발행 전까지 공개본은 유지). */
export async function restoreVersionToDraft(ctx: Ctx, landingId: string, versionId: string) {
  requireCan(ctx, "landing.edit");
  const l = await getLanding(ctx, landingId);
  const v = await one<{ content_json: string }>("SELECT content_json FROM landing_versions WHERE id=? AND landing_id=?", versionId, landingId);
  if (!l || !v) throw new AppError("버전을 찾을 수 없습니다.");
  await run("UPDATE landings SET content_json=?, updated_at=? WHERE id=?", v.content_json, now(), landingId);
  await audit(ctx.workspaceId, actor(ctx), "landing.restore_draft", "landing", landingId, { versionId });
}

export type PublicLanding = {
  landing: Landing; versionId: string; content: LandingContent; pixels: Pixels; clientId: string;
  consentIds: { privacy: string | null; marketing: string | null };
};

/** 공개 랜딩 조회. 발행 상태이고 워크스페이스 구독(체험 포함)이 유효할 때만 반환한다. */
export async function getPublicLanding(slug: string): Promise<PublicLanding | null> {
  const l = await one<Landing & { client_id: string; pixels_json: string; campaign_status: string }>(
    "SELECT p.*, c.client_id, c.pixels_json, c.status AS campaign_status FROM landings p JOIN campaigns c ON c.id=p.campaign_id WHERE p.slug=?", slug);
  if (!l || l.status !== "published" || !l.published_version_id || l.campaign_status !== "active") return null;
  if (!await isServing(l.workspace_id)) return null;
  const v = await one<{ content_json: string }>("SELECT content_json FROM landing_versions WHERE id=?", l.published_version_id);
  if (!v) return null;
  const consent = async (kind: string) =>
    (await one<{ id: string }>("SELECT id FROM consent_versions WHERE landing_id=? AND kind=? ORDER BY version DESC LIMIT 1", l.id, kind))?.id ?? null;
  return {
    landing: l, versionId: l.published_version_id, content: JSON.parse(v.content_json) as LandingContent,
    pixels: parsePixels(l), clientId: l.client_id, consentIds: { privacy: await consent("privacy"), marketing: await consent("marketing") },
  };
}
