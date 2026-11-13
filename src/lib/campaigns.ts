import { audit, hoursFromNow, newId, now, one, parseJson, q, run, tx } from "./db";
import { AppError, Ctx, requireCan, scopeSql } from "./accounts";
import { hashPassword, isValidEmail, isValidPhone, normalizePhone, randomToken, sha256, verifyPassword } from "./crypto";
import { MAX_NOTIFY_RECIPIENTS } from "./pricing";
import { isHttpUrl } from "./net";

export type Client = { id: string; workspace_id: string; name: string; memo: string | null; archived: number; created_at: string };
export type Campaign = {
  id: string; workspace_id: string; client_id: string; title: string; status: string; notify_json: string;
  sheet_webhook_url: string | null; pixels_json: string; automation_enabled: number; created_at: string;
};
export type LeadStatus = {
  id: string; campaign_id: string; key: string; label: string; color: string; terminal: number; client_editable: number; position: number;
};
export type Rule = {
  id: string; campaign_id: string; key: string; name: string; trigger_key: string; delay_hours: number;
  purpose: "info" | "ad"; body: string; enabled: number; position: number;
};
export type Recipient = { name: string; phone: string; email: string };
export type Pixels = { meta?: string; ga4?: string; daangn?: string };

export const DEFAULT_STATUSES: [string, string, string, number][] = [
  ["new", "신규", "#3b82f6", 0],
  ["trying", "연락 시도", "#f59e0b", 0],
  ["noanswer", "부재중", "#f97316", 0],
  ["booked", "상담 예약", "#8b5cf6", 0],
  ["consulted", "상담 완료", "#14b8a6", 0],
  ["contracted", "계약", "#16a34a", 1],
  ["bad", "불량/취소", "#6b7280", 1],
];

// 공개된 발송 예시 트리거를 기본 시나리오로 제공. 광고성(ad)은 수신 동의자에게만 발송된다.
const DEFAULT_RULES: [string, string, string, number, "info" | "ad", string, number][] = [
  ["confirm", "신청 접수 확인", "submitted", 0, "info", "{이름}님, {캠페인} 상담 신청이 접수되었습니다. 담당자가 곧 연락드리겠습니다.", 1],
  ["noanswer_48h", "부재중 48시간 후 · 연락 가능 시간 확인", "noanswer", 48, "info", "{이름}님, 상담 전화를 드렸으나 연결되지 않았습니다. 통화 가능한 시간을 알려주시면 맞춰 연락드리겠습니다.", 0],
  ["noanswer_7d", "부재중 7일 후 · 안내/혜택", "noanswer", 168, "ad", "(광고) {이름}님, {캠페인} 상담 혜택이 아직 유효합니다. 편하실 때 회신 주세요. 무료수신거부 080-000-0000", 0],
  ["consulted_24h", "상담 24시간 후 · 상담 내용 확인", "consulted", 24, "info", "{이름}님, 어제 상담드린 내용 중 궁금하신 점이 있으면 언제든 문의해 주세요.", 0],
  ["consulted_72h", "상담 72시간 후 미계약 · 마감 혜택", "consulted", 72, "ad", "(광고) {이름}님, 상담 고객 대상 혜택이 곧 마감됩니다. 무료수신거부 080-000-0000", 0],
  ["contracted_3d", "계약 3일 후 · 감사 및 이용 안내", "contracted", 72, "info", "{이름}님, 계약해 주셔서 감사합니다. 이용 중 불편한 점은 언제든 말씀해 주세요.", 0],
  ["contracted_90d", "계약 90일 후 · 안부", "contracted", 2160, "ad", "(광고) {이름}님, 잘 지내고 계신가요? 새로운 소식을 안내드립니다. 무료수신거부 080-000-0000", 0],
];

const actor = (ctx: Ctx) => ({ id: ctx.userId, name: ctx.userName });

// ── 고객사 ───────────────────────────────────────────────
export async function listClients(ctx: Ctx): Promise<Client[]> {
  const s = scopeSql(ctx, "id");
  return await q<Client>(`SELECT * FROM clients WHERE ${s.sql} AND archived=0 ORDER BY created_at`, ...s.params);
}

export async function createClient(ctx: Ctx, name: string, memo = ""): Promise<string> {
  requireCan(ctx, "client.manage");
  if (!name.trim()) throw new AppError("고객사 이름을 입력해 주세요.");
  const id = newId("cl_");
  await run("INSERT INTO clients VALUES (?,?,?,?,0,?)", id, ctx.workspaceId, name.trim(), memo.trim() || null, now());
  await audit(ctx.workspaceId, actor(ctx), "client.create", "client", id);
  return id;
}

// ── 캠페인 ───────────────────────────────────────────────
export type CampaignRow = Campaign & { client_name: string; lead_count: number; landing_count: number };

export async function listCampaigns(ctx: Ctx): Promise<CampaignRow[]> {
  const s = scopeSql(ctx, "c.client_id", "c.workspace_id");
  return await q<CampaignRow>(
    `SELECT c.*, cl.name AS client_name,
            (SELECT COUNT(*) FROM leads l WHERE l.campaign_id=c.id) AS lead_count,
            (SELECT COUNT(*) FROM landings p WHERE p.campaign_id=c.id AND p.status!='archived') AS landing_count
       FROM campaigns c JOIN clients cl ON cl.id=c.client_id
      WHERE ${s.sql} AND c.status!='archived' ORDER BY c.created_at DESC`,
    ...s.params,
  );
}

export async function getCampaign(ctx: Ctx, id: string): Promise<(Campaign & { client_name: string }) | undefined> {
  const s = scopeSql(ctx, "c.client_id", "c.workspace_id");
  return await one(`SELECT c.*, cl.name AS client_name FROM campaigns c JOIN clients cl ON cl.id=c.client_id WHERE c.id=? AND ${s.sql}`, id, ...s.params);
}

export async function createCampaign(ctx: Ctx, clientId: string, title: string): Promise<string> {
  requireCan(ctx, "campaign.create");
  if (!title.trim()) throw new AppError("캠페인 이름을 입력해 주세요.");
  const s = scopeSql(ctx, "id");
  if (!await one(`SELECT 1 FROM clients WHERE id=? AND ${s.sql}`, clientId, ...s.params)) throw new AppError("고객사를 찾을 수 없습니다.");
  return await tx(async () => {
    const id = newId("cp_");
    const owner = (await one<{ name: string; email: string; phone: string | null }>("SELECT name,email,phone FROM users WHERE id=?", ctx.userId))!;
    const notify: Recipient[] = [{ name: owner.name, phone: owner.phone ?? "", email: owner.email }];
    await run(
      "INSERT INTO campaigns(id,workspace_id,client_id,title,notify_json,created_at) VALUES (?,?,?,?,?,?)",
      id, ctx.workspaceId, clientId, title.trim(), JSON.stringify(notify), now(),
    );
    for (const [i, [key, label, color, terminal]] of DEFAULT_STATUSES.entries())
      await run("INSERT INTO lead_statuses VALUES (?,?,?,?,?,?,?,?,?)", newId("st_"), ctx.workspaceId, id, key, label, color, terminal, 1, i);
    for (const [i, [key, name, trigger, delay, purpose, body, enabled]] of DEFAULT_RULES.entries())
      await run("INSERT INTO automation_rules VALUES (?,?,?,?,?,?,?,?,?,?,?)", newId("ar_"), ctx.workspaceId, id, key, name, trigger, delay, purpose, body, enabled, i);
    await audit(ctx.workspaceId, actor(ctx), "campaign.create", "campaign", id);
    return id;
  });
}

export async function updateCampaignSettings(
  ctx: Ctx, id: string,
  input: { title: string; recipients: Recipient[]; sheetUrl: string; pixels: Pixels; automationEnabled: boolean },
) {
  requireCan(ctx, "automation.edit");
  const c = await getCampaign(ctx, id);
  if (!c) throw new AppError("캠페인을 찾을 수 없습니다.");
  const recipients = input.recipients
    .map((r) => ({ name: r.name.trim(), phone: normalizePhone(r.phone), email: r.email.trim().toLowerCase() }))
    .filter((r) => r.phone || r.email);
  if (recipients.length > MAX_NOTIFY_RECIPIENTS) throw new AppError(`알림 수신자는 최대 ${MAX_NOTIFY_RECIPIENTS}명입니다.`);
  for (const r of recipients) {
    if (r.phone && !isValidPhone(r.phone)) throw new AppError(`수신자 전화번호가 올바르지 않습니다: ${r.phone}`);
    if (r.email && !isValidEmail(r.email)) throw new AppError(`수신자 이메일이 올바르지 않습니다: ${r.email}`);
  }
  const sheet = input.sheetUrl.trim();
  if (sheet && !(isHttpUrl(sheet) && sheet.startsWith("https://"))) throw new AppError("시트 웹훅 주소는 https:// 로 시작해야 합니다.");
  const p = { meta: input.pixels.meta?.trim() ?? "", ga4: input.pixels.ga4?.trim().toUpperCase() ?? "", daangn: input.pixels.daangn?.trim() ?? "" };
  if (p.meta && !/^\d{5,20}$/.test(p.meta)) throw new AppError("메타 픽셀 ID는 숫자만 입력해 주세요.");
  if (p.ga4 && !/^G-[A-Z0-9]{4,20}$/.test(p.ga4)) throw new AppError("GA4 측정 ID는 G-XXXXXXX 형식입니다.");
  if (p.daangn && !/^[A-Za-z0-9_-]{4,64}$/.test(p.daangn)) throw new AppError("당근 추적 ID 형식이 올바르지 않습니다.");
  await run(
    "UPDATE campaigns SET title=?, notify_json=?, sheet_webhook_url=?, pixels_json=?, automation_enabled=? WHERE id=?",
    input.title.trim() || c.title, JSON.stringify(recipients), sheet || null, JSON.stringify(p), input.automationEnabled ? 1 : 0, id,
  );
  await audit(ctx.workspaceId, actor(ctx), "campaign.settings", "campaign", id, { pixels: p, recipients: recipients.length, sheet: !!sheet });
}

export const listStatuses = async (campaignId: string) =>
  await q<LeadStatus>("SELECT * FROM lead_statuses WHERE campaign_id=? ORDER BY position", campaignId);

export async function updateStatus(ctx: Ctx, statusId: string, label: string, color: string, clientEditable: boolean) {
  requireCan(ctx, "automation.edit");
  const st = await one<LeadStatus>("SELECT * FROM lead_statuses WHERE id=? AND workspace_id=?", statusId, ctx.workspaceId);
  if (!st || !await getCampaign(ctx, st.campaign_id)) throw new AppError("상태를 찾을 수 없습니다.");
  if (!label.trim()) throw new AppError("상태 이름을 입력해 주세요.");
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new AppError("색상 값이 올바르지 않습니다.");
  await run("UPDATE lead_statuses SET label=?, color=?, client_editable=? WHERE id=?", label.trim(), color, clientEditable ? 1 : 0, statusId);
}

export const listRules = async (campaignId: string) =>
  await q<Rule>("SELECT * FROM automation_rules WHERE campaign_id=? ORDER BY position", campaignId);

export async function updateRule(ctx: Ctx, ruleId: string, input: { enabled: boolean; body: string; delayHours: number }) {
  requireCan(ctx, "automation.edit");
  const r = await one<Rule>("SELECT * FROM automation_rules WHERE id=? AND workspace_id=?", ruleId, ctx.workspaceId);
  if (!r || !await getCampaign(ctx, r.campaign_id)) throw new AppError("시나리오를 찾을 수 없습니다.");
  if (!input.body.trim()) throw new AppError("메시지 내용을 입력해 주세요.");
  if (r.purpose === "ad" && !/\(광고\)/.test(input.body)) throw new AppError("광고성 메시지는 본문에 (광고) 표기가 필요합니다.");
  const delay = r.trigger_key === "submitted" ? 0 : Math.max(0, Math.min(24 * 365, Number(input.delayHours) || 0));
  await run("UPDATE automation_rules SET enabled=?, body=?, delay_hours=? WHERE id=?", input.enabled ? 1 : 0, input.body.trim(), delay, ruleId);
  await audit(ctx.workspaceId, actor(ctx), "automation.rule.update", "rule", ruleId, { enabled: input.enabled });
}

// ── 광고주 공유 링크(F-03, F-06) ────────────────────────────
export type ShareLink = {
  id: string; workspace_id: string; client_id: string; token: string; password_hash: string; expires_at: string | null;
  allow_status_change: number; allow_export: number; mask_phone: number; revoked: number; created_at: string;
};

export async function listShareLinks(ctx: Ctx): Promise<(ShareLink & { client_name: string; access_count: number; last_access: string | null })[]> {
  requireCan(ctx, "client.manage");
  return await q(
    `SELECT s.*, c.name AS client_name,
            (SELECT COUNT(*) FROM share_access_logs a WHERE a.share_link_id=s.id AND a.ok=1) AS access_count,
            (SELECT MAX(created_at) FROM share_access_logs a WHERE a.share_link_id=s.id AND a.ok=1) AS last_access
       FROM share_links s JOIN clients c ON c.id=s.client_id WHERE s.workspace_id=? AND s.revoked=0 ORDER BY s.created_at DESC`,
    ctx.workspaceId,
  );
}

export async function createShareLink(
  ctx: Ctx, clientId: string, password: string,
  opts: { expiresDays: number; allowStatusChange: boolean; allowExport: boolean; maskPhone: boolean },
): Promise<string> {
  requireCan(ctx, "client.manage");
  if (!await one("SELECT 1 FROM clients WHERE id=? AND workspace_id=?", clientId, ctx.workspaceId)) throw new AppError("고객사를 찾을 수 없습니다.");
  if (password.length < 6) throw new AppError("공유 비밀번호는 6자 이상이어야 합니다.");
  const id = newId("sh_");
  await run(
    "INSERT INTO share_links VALUES (?,?,?,?,?,?,?,?,?,0,?)",
    id, ctx.workspaceId, clientId, randomToken(18), hashPassword(password),
    opts.expiresDays > 0 ? hoursFromNow(24 * opts.expiresDays) : null,
    opts.allowStatusChange ? 1 : 0, opts.allowExport ? 1 : 0, opts.maskPhone ? 1 : 0, now(),
  );
  await audit(ctx.workspaceId, actor(ctx), "share.create", "share_link", id, { clientId });
  return id;
}

export async function revokeShareLink(ctx: Ctx, id: string) {
  requireCan(ctx, "client.manage");
  await tx(async () => {
    await run("UPDATE share_links SET revoked=1 WHERE id=? AND workspace_id=?", id, ctx.workspaceId);
    await run("DELETE FROM share_sessions WHERE share_link_id=?", id);
    await audit(ctx.workspaceId, actor(ctx), "share.revoke", "share_link", id);
  });
}

export async function rotateSharePassword(ctx: Ctx, id: string, password: string) {
  requireCan(ctx, "client.manage");
  if (password.length < 6) throw new AppError("공유 비밀번호는 6자 이상이어야 합니다.");
  await tx(async () => {
    await run("UPDATE share_links SET password_hash=? WHERE id=? AND workspace_id=?", hashPassword(password), id, ctx.workspaceId);
    await run("DELETE FROM share_sessions WHERE share_link_id=?", id);
    await audit(ctx.workspaceId, actor(ctx), "share.rotate_password", "share_link", id);
  });
}

export async function getActiveShareLink(token: string): Promise<ShareLink | undefined> {
  const s = await one<ShareLink>("SELECT * FROM share_links WHERE token=? AND revoked=0", token);
  if (!s || (s.expires_at && s.expires_at < now())) return undefined;
  return s;
}

/** 비밀번호 검증 후 공유 세션 토큰 발급. 접속 기록을 남긴다. */
export async function openShareSession(link: ShareLink, password: string, ip: string): Promise<string | null> {
  const ok = verifyPassword(password, link.password_hash);
  await run("INSERT INTO share_access_logs VALUES (?,?,?,?,?,?)", newId("sa_"), link.workspace_id, link.id, ip, ok ? 1 : 0, now());
  if (!ok) return null;
  const t = randomToken();
  await run("INSERT INTO share_sessions VALUES (?,?,?)", sha256(t), link.id, hoursFromNow(12));
  return t;
}

export async function checkShareSession(link: ShareLink, sessionToken: string | undefined): Promise<boolean> {
  if (!sessionToken) return false;
  const s = await one<{ expires_at: string }>("SELECT expires_at FROM share_sessions WHERE token_hash=? AND share_link_id=?", sha256(sessionToken), link.id);
  return !!s && s.expires_at > now();
}

export const parseRecipients = (c: Campaign) => parseJson<Recipient[]>(c.notify_json, []);
export const parsePixels = (c: { pixels_json: string }) => parseJson<Pixels>(c.pixels_json, {});
