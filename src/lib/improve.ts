import { audit, newId, now, one, parseJson, q, run, tx } from "./db";
import { AppError, Ctx, requireCan } from "./accounts";
import { charge, refund } from "./credits";
import { COST, IMPROVEMENT_MIN_VISITORS } from "./pricing";
import { rates, sectionReach } from "./analytics";
import { getLanding, snapshotVersion } from "./landings";
import { Improvement, suggestImprovement } from "./ai";
import { LandingContent, SECTION_TYPES, Section } from "./landing";
import { scopeOf } from "./leads";

export type SectionStat = { id: string; type: string; label: string; preview: string; reach: number; reachPct: number; dropPct: number };
export type Analysis = { sessions: number; enough: boolean; sections: SectionStat[]; suspectId: string | null; versionId: string | null };

const preview = (s: Section) => String(s.props.title || s.props.text || s.props.body || "").slice(0, 40);
const typeLabel = (t: string) => SECTION_TYPES.find((x) => x.type === t)?.label ?? t;

/** 현재 발행 버전 기준 섹션 도달률과 이탈 의심 구간(H-01). 표본 50 방문 이하면 신뢰도 부족으로 표시한다. */
export async function analyzeLanding(ctx: Ctx, landingId: string): Promise<Analysis | null> {
  const l = await getLanding(ctx, landingId);
  if (!l || !l.published_version_id) return null;
  const v = (await one<{ content_json: string; published_at: string }>("SELECT content_json, published_at FROM landing_versions WHERE id=?", l.published_version_id))!;
  const content = JSON.parse(v.content_json) as LandingContent;
  const { sessions, reach } = await sectionReach({ scope: scopeOf(ctx), landingId, from: v.published_at, to: "9999" });
  let prev = 100;
  let worst = 0;
  let suspectId: string | null = null;
  const sections = content.sections.filter((s) => s.type !== "chat").map((s) => {
    const r = reach.get(s.id) ?? 0;
    const pct = sessions ? Math.min(100, (r / sessions) * 100) : 0;
    const drop = Math.max(0, prev - pct);
    if (drop > worst && drop >= 10) { worst = drop; suspectId = s.id; }
    prev = pct;
    return { id: s.id, type: s.type, label: typeLabel(s.type), preview: preview(s), reach: r, reachPct: pct, dropPct: drop };
  });
  const enough = sessions > IMPROVEMENT_MIN_VISITORS;
  return { sessions, enough, sections, suspectId: enough ? suspectId : null, versionId: l.published_version_id };
}

export type Suggestion = {
  id: string; landing_id: string; section_id: string; source_version_id: string | null; analysis_json: string; suggestion_json: string;
  engine: string | null; status: "proposed" | "applied" | "reverted" | "rejected"; applied_version_id: string | null; prev_version_id: string | null;
  applied_at: string | null; created_at: string;
};

export const listSuggestions = async (ctx: Ctx, landingId: string) =>
  await getLanding(ctx, landingId) ? await q<Suggestion>("SELECT * FROM ai_suggestions WHERE landing_id=? ORDER BY created_at DESC LIMIT 30", landingId) : [];

export const suggestionBody = (s: Suggestion) => parseJson<Improvement>(s.suggestion_json, { rationale: "", tips: [] });

/** AI 개선 제안 생성(제안 1건당 300크레딧, 실패 시 복구). */
export async function createSuggestion(ctx: Ctx, landingId: string, sectionId: string): Promise<string> {
  requireCan(ctx, "landing.edit");
  const a = await analyzeLanding(ctx, landingId);
  if (!a) throw new AppError("발행된 랜딩에서만 제안을 만들 수 있습니다.");
  if (!a.enough) throw new AppError(`방문 ${IMPROVEMENT_MIN_VISITORS}건을 넘어야 제안을 만들 수 있습니다(현재 ${a.sessions}건). 표본이 적으면 통계적 신뢰도가 부족합니다.`);
  const idx = a.sections.findIndex((s) => s.id === sectionId);
  if (idx < 0) throw new AppError("섹션을 찾을 수 없습니다.");
  const v = (await one<{ content_json: string }>("SELECT content_json FROM landing_versions WHERE id=?", a.versionId))!;
  const section = (JSON.parse(v.content_json) as LandingContent).sections.find((s) => s.id === sectionId)!;
  const id = newId("sg_");
  const opId = `improve:${id}`;
  const c = await charge(ctx.workspaceId, opId, COST.improvement, "AI 이탈 개선 제안", ctx.userId);
  if (!c.ok) throw new AppError(`크레딧이 부족합니다. 필요 ${COST.improvement} / 보유 ${c.balance.toLocaleString()}`);
  try {
    const st = a.sections[idx];
    const { suggestion, engine } = await suggestImprovement(section, {
      reachPct: st.reachPct, prevReachPct: idx ? a.sections[idx - 1].reachPct : 100, dropPct: st.dropPct, position: idx + 1, total: a.sections.length,
    });
    await run("INSERT INTO ai_suggestions(id,workspace_id,landing_id,section_id,source_version_id,analysis_json,suggestion_json,engine,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      id, ctx.workspaceId, landingId, sectionId, a.versionId, JSON.stringify({ sessions: a.sessions, ...st }), JSON.stringify(suggestion), engine, now());
    return id;
  } catch (e) {
    await refund(ctx.workspaceId, opId, "제안 생성 실패 크레딧 복구");
    throw new AppError(`제안 생성에 실패했습니다. 크레딧은 복구되었습니다. (${e instanceof Error ? e.message : "오류"})`);
  }
}

function patchSection(content: LandingContent, sectionId: string, patch: Record<string, unknown>): boolean {
  const s = content.sections.find((x) => x.id === sectionId);
  if (!s) return false;
  Object.assign(s.props, patch);
  return true;
}

async function getSuggestion(ctx: Ctx, id: string) {
  const s = await one<Suggestion>("SELECT * FROM ai_suggestions WHERE id=? AND workspace_id=?", id, ctx.workspaceId);
  if (!s || !await getLanding(ctx, s.landing_id)) throw new AppError("제안을 찾을 수 없습니다.");
  return s;
}

/** 운영자 승인 후에만 적용(H-03). 새 버전으로 발행하고 이전 버전을 기억한다. */
export async function applySuggestion(ctx: Ctx, id: string) {
  requireCan(ctx, "landing.edit");
  const s = await getSuggestion(ctx, id);
  if (s.status !== "proposed") throw new AppError("이미 처리된 제안입니다.");
  const l = (await getLanding(ctx, s.landing_id))!;
  if (l.published_version_id !== s.source_version_id) throw new AppError("제안 생성 이후 랜딩이 다시 발행되어 적용할 수 없습니다(버전 충돌). 제안을 새로 만들어 주세요.");
  const body = suggestionBody(s);
  const patch: Record<string, unknown> = {};
  for (const k of ["title", "body", "text"] as const) if (body[k]) patch[k] = body[k];
  if (!Object.keys(patch).length) throw new AppError("적용할 문구 변경이 없는 제안입니다(구성 팁만 포함).");
  await tx(async () => {
    const pub = JSON.parse((await one<{ content_json: string }>("SELECT content_json FROM landing_versions WHERE id=?", l.published_version_id))!.content_json) as LandingContent;
    const before: Record<string, unknown> = {};
    const sec = pub.sections.find((x) => x.id === s.section_id);
    if (!sec) throw new AppError("대상 섹션이 더 이상 존재하지 않습니다.");
    for (const k of Object.keys(patch)) before[k] = sec.props[k];
    patchSection(pub, s.section_id, patch);
    const draft = JSON.parse(l.content_json) as LandingContent;
    const versionId = newId("lv_");
    await run("INSERT INTO landing_versions VALUES (?,?,?,?,?,?,?,?)", versionId, l.workspace_id, l.id, JSON.stringify(pub), "AI 개선안 적용", ctx.userId, ctx.userName, now());
    // 편집 중인 초안은 덮어쓰지 않고 해당 섹션만 갱신한다.
    patchSection(draft, s.section_id, patch);
    await run("UPDATE landings SET published_version_id=?, content_json=?, updated_at=? WHERE id=?", versionId, JSON.stringify(draft), now(), l.id);
    await run("UPDATE ai_suggestions SET status='applied', applied_version_id=?, prev_version_id=?, applied_at=?, decided_by=?, analysis_json=? WHERE id=?",
      versionId, l.published_version_id, now(), ctx.userName, JSON.stringify({ ...parseJson<Record<string, unknown>>(s.analysis_json, {}), before }), id);
    await audit(ctx.workspaceId, { id: ctx.userId, name: ctx.userName }, "improvement.apply", "landing", l.id, { suggestionId: id, versionId });
  });
}

/** 적용 취소(H-04): 이전 버전 내용을 새 버전으로 다시 발행한다. 변경 로그는 유지된다. */
export async function revertSuggestion(ctx: Ctx, id: string) {
  requireCan(ctx, "landing.edit");
  const s = await getSuggestion(ctx, id);
  if (s.status !== "applied" || !s.prev_version_id) throw new AppError("되돌릴 수 없는 제안입니다.");
  const l = (await getLanding(ctx, s.landing_id))!;
  if (l.published_version_id !== s.applied_version_id) throw new AppError("적용 이후 랜딩이 다시 발행되어 자동으로 되돌릴 수 없습니다. 버전 기록에서 복원해 주세요.");
  await tx(async () => {
    const prev = JSON.parse((await one<{ content_json: string }>("SELECT content_json FROM landing_versions WHERE id=?", s.prev_version_id))!.content_json) as LandingContent;
    const before = parseJson<{ before?: Record<string, unknown> }>(s.analysis_json, {}).before ?? {};
    const draft = JSON.parse(l.content_json) as LandingContent;
    patchSection(draft, s.section_id, before);
    const versionId = await snapshotVersion(l.workspace_id, l.id, prev, "AI 개선안 되돌리기", ctx.userId, ctx.userName);
    await run("UPDATE landings SET content_json=? WHERE id=?", JSON.stringify(draft), l.id);
    await run("UPDATE ai_suggestions SET status='reverted', decided_by=? WHERE id=?", ctx.userName, id);
    await audit(ctx.workspaceId, { id: ctx.userId, name: ctx.userName }, "improvement.revert", "landing", l.id, { suggestionId: id, versionId });
  });
}

export async function rejectSuggestion(ctx: Ctx, id: string) {
  requireCan(ctx, "landing.edit");
  const s = await getSuggestion(ctx, id);
  if (s.status !== "proposed") throw new AppError("이미 처리된 제안입니다.");
  await run("UPDATE ai_suggestions SET status='rejected', decided_by=? WHERE id=?", ctx.userName, id);
}

/** 적용 전후 비교(H-05, H-07): 같은 길이의 기간으로 완독률·CTA 클릭률을 비교한다. 단순 전후 비교이므로 참고치다. */
export async function compareSuggestion(ctx: Ctx, s: Suggestion) {
  if (!s.applied_at) return null;
  const end = Math.min(Date.now(), new Date(s.applied_at).getTime() + 14 * 86400_000);
  const span = Math.max(3600_000, end - new Date(s.applied_at).getTime());
  const scope = scopeOf(ctx);
  const before = await rates({ scope, landingId: s.landing_id, from: new Date(new Date(s.applied_at).getTime() - span).toISOString(), to: s.applied_at });
  const after = await rates({ scope, landingId: s.landing_id, from: s.applied_at, to: new Date(end).toISOString() });
  return { before, after, days: span / 86400_000 };
}
