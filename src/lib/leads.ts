import { audit, newId, now, one, parseJson, q, Param, rateLimit, run, tx } from "./db";
import { AppError, Ctx } from "./accounts";
import { decrypt, encrypt, isValidEmail, isValidPhone, keyedHash, normalizePhone } from "./crypto";
import { LeadStatus, listStatuses } from "./campaigns";
import { getPublicLanding } from "./landings";
import { enqueueOnSubmit, onStatusChanged } from "./messaging";
import { deriveSource, deviceOf, recordEvent } from "./tracking";

/** 데이터 접근 범위. 콘솔 사용자와 광고주 공유 화면이 같은 경로로 격리된다. */
export type Scope = { workspaceId: string; clientIds: string[] | null };
export type Actor = { type: "user" | "client" | "system"; id: string | null; name: string };

export const scopeOf = (ctx: Ctx): Scope => ({ workspaceId: ctx.workspaceId, clientIds: ctx.clientScope });

function scopeWhere(s: Scope, alias = "l"): { sql: string; params: Param[] } {
  if (!s.clientIds) return { sql: `${alias}.workspace_id=?`, params: [s.workspaceId] };
  if (!s.clientIds.length) return { sql: `${alias}.workspace_id=? AND 1=0`, params: [s.workspaceId] };
  return { sql: `${alias}.workspace_id=? AND ${alias}.client_id IN (${s.clientIds.map(() => "?").join(",")})`, params: [s.workspaceId, ...s.clientIds] };
}

export type LeadRow = {
  id: string; workspace_id: string; client_id: string; campaign_id: string; landing_id: string; landing_version_id: string | null;
  name: string; phone_enc: string | null; phone_hash: string | null; email_enc: string | null; fields_json: string;
  status_id: string; owner_id: string | null; source: string | null; medium: string | null; utm_json: string; referrer: string | null;
  device: string | null; is_duplicate: number; is_invalid: number; marketing_consent: number; submitted_at: string;
  status_changed_at: string; first_contact_at: string | null; last_contact_at: string | null; reminded_at: string | null; version: number;
};
export type LeadView = LeadRow & {
  phone: string; email: string; status_key: string; status_label: string; status_color: string; status_terminal: number;
  campaign_title: string; client_name: string; landing_name: string; owner_name: string | null; overdue: boolean;
};

export class SubmitError extends AppError {
  constructor(message: string, public status = 400, public field?: string) {
    super(message);
  }
}

export type SubmitPayload = {
  fields: Record<string, unknown>; consent: boolean; marketing?: boolean; idempotency_key: string;
  visitor_id?: string; session_id?: string; utm?: Record<string, string>; referrer?: string; hp?: string;
};

const clean = (v: unknown, max = 2000) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

/** 공개 폼 접수. 서버에서 필수값·전화번호·동의를 재검증하고(C-06) 멱등 키로 1회만 저장한다. */
export async function submitLead(slug: string, p: SubmitPayload, meta: { ip: string; ua: string }): Promise<{ leadId: string; replay: boolean; message: string }> {
  const pub = await getPublicLanding(slug);
  if (!pub) throw new SubmitError("현재 신청을 받을 수 없는 페이지입니다.", 404);
  const { landing, content } = pub;
  const idem = clean(p.idempotency_key, 80);
  if (idem.length < 8) throw new SubmitError("요청 식별자가 올바르지 않습니다.");
  const existing = await one<{ id: string }>("SELECT id FROM leads WHERE landing_id=? AND idempotency_key=?", landing.id, idem);
  if (existing) return { leadId: existing.id, replay: true, message: content.settings.successMessage };

  if (clean(p.hp)) throw new SubmitError("요청이 거부되었습니다.", 400); // 허니팟(봇)
  if (!await rateLimit(`lead:${meta.ip}:${landing.id}`, 8, 600)) throw new SubmitError("잠시 후 다시 시도해 주세요.", 429);
  if (p.consent !== true) throw new SubmitError("개인정보 수집·이용에 동의해 주세요.", 400, "consent");

  const values: Record<string, string> = {};
  let phone = "", email = "", name = "";
  for (const f of content.form.fields) {
    const raw = p.fields?.[f.key];
    let v = Array.isArray(raw) ? raw.map((x) => clean(x, 100)).filter(Boolean).join(", ") : clean(raw, f.type === "textarea" ? 2000 : 200);
    if (f.required && !v) throw new SubmitError(`'${f.label}' 항목을 입력해 주세요.`, 400, f.key);
    if (v) {
      if (f.type === "phone") {
        v = normalizePhone(v);
        if (!isValidPhone(v)) throw new SubmitError("전화번호를 정확히 입력해 주세요.", 400, f.key);
        phone ||= v;
      } else if (f.type === "email") {
        if (!isValidEmail(v)) throw new SubmitError("이메일 형식이 올바르지 않습니다.", 400, f.key);
        email ||= v.toLowerCase();
      } else if (f.type === "select" || f.type === "radio") {
        if (!(f.options ?? []).includes(v)) throw new SubmitError(`'${f.label}' 선택값이 올바르지 않습니다.`, 400, f.key);
      } else if (f.type === "checkbox") {
        if (v.split(", ").some((x) => !(f.options ?? []).includes(x))) throw new SubmitError(`'${f.label}' 선택값이 올바르지 않습니다.`, 400, f.key);
      } else if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new SubmitError(`'${f.label}' 날짜가 올바르지 않습니다.`, 400, f.key);
      if (f.key === "name") name = v;
      else if (f.type !== "phone" && f.type !== "email") values[f.label] = v;
    }
  }

  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = clean(p.utm?.[k], 120);
    if (v) utm[k] = v;
  }
  const referrer = clean(p.referrer, 300);
  const { source, medium } = deriveSource(utm, referrer);
  const marketing = !!(content.form.marketingEnabled && p.marketing === true);
  const statuses = await listStatuses(landing.campaign_id);
  const first = statuses[0];
  const phoneHash = phone ? keyedHash(phone) : null;
  const leadId = newId("ld_");
  const t = now();
  const visitorId = clean(p.visitor_id, 64) || `anon_${leadId}`;
  const sessionId = clean(p.session_id, 64) || `anon_${leadId}`;

  const inserted = await tx(async () => {
    // 동시 재전송 대비: 트랜잭션 안에서 다시 확인
    const again = await one<{ id: string }>("SELECT id FROM leads WHERE landing_id=? AND idempotency_key=?", landing.id, idem);
    if (again) return again.id;
    const dup = phoneHash ? !!await one("SELECT 1 FROM leads WHERE campaign_id=? AND phone_hash=? LIMIT 1", landing.campaign_id, phoneHash) : false;
    // 다른 연결에서 같은 멱등 키가 동시에 들어오면 UNIQUE 충돌 대신 0행 삽입으로 끝난다.
    const ins = await run(
      `INSERT INTO leads(id,workspace_id,client_id,campaign_id,landing_id,landing_version_id,visitor_id,session_id,name,phone_enc,phone_hash,phone_last4,
         email_enc,fields_json,status_id,source,medium,utm_json,referrer,device,is_duplicate,marketing_consent,idempotency_key,submitted_at,status_changed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (landing_id, idempotency_key) DO NOTHING`,
      leadId, landing.workspace_id, pub.clientId, landing.campaign_id, landing.id, pub.versionId, visitorId, sessionId,
      name || "이름 없음", phone ? encrypt(phone) : null, phoneHash, phone ? phone.slice(-4) : null, email ? encrypt(email) : null,
      JSON.stringify(values), first.id, source, medium, JSON.stringify(utm), referrer || null, deviceOf(meta.ua), dup ? 1 : 0, marketing ? 1 : 0, idem, t, t,
    );
    if (ins.changes !== 1) return (await one<{ id: string }>("SELECT id FROM leads WHERE landing_id=? AND idempotency_key=?", landing.id, idem))!.id;
    const evidence = JSON.stringify({ ip_hash: keyedHash(meta.ip).slice(0, 16), ua: meta.ua.slice(0, 200), landing_version_id: pub.versionId });
    if (pub.consentIds.privacy) await run("INSERT INTO lead_consents VALUES (?,?,?,?,?,?)", newId("lc_"), leadId, pub.consentIds.privacy, "privacy", t, evidence);
    if (marketing && pub.consentIds.marketing) await run("INSERT INTO lead_consents VALUES (?,?,?,?,?,?)", newId("lc_"), leadId, pub.consentIds.marketing, "marketing", t, evidence);
    await activity(landing.workspace_id, leadId, { type: "system", id: null, name: "시스템" }, "created", null, dup ? "신청 접수(중복 연락처)" : "신청 접수");
    await recordEvent({
      workspaceId: landing.workspace_id, campaignId: landing.campaign_id, landingId: landing.id, versionId: pub.versionId,
      visitorId, sessionId, name: "lead_submit_success", source, medium, utmCampaign: utm.utm_campaign ?? null, device: deviceOf(meta.ua), leadId,
    });
    await enqueueOnSubmit(leadId);
    return null;
  });
  if (inserted) return { leadId: inserted, replay: true, message: content.settings.successMessage };
  return { leadId, replay: false, message: content.settings.successMessage };
}

export async function activity(ws: string, leadId: string, a: Actor, type: string, oldV: string | null, newV: string | null): Promise<string> {
  const id = newId("la_");
  await run("INSERT INTO lead_activities VALUES (?,?,?,?,?,?,?,?,?,?)", id, ws, leadId, a.type, a.id, a.name, type, oldV, newV, now());
  return id;
}

export type LeadFilter = {
  q?: string; campaignId?: string; statusKey?: string; from?: string; to?: string; flag?: "duplicate" | "invalid" | "overdue" | "";
  limit?: number;
};

const VIEW_SELECT = `SELECT l.*, s.key AS status_key, s.label AS status_label, s.color AS status_color, s.terminal AS status_terminal,
  c.title AS campaign_title, cl.name AS client_name, p.name AS landing_name, u.name AS owner_name
  FROM leads l JOIN lead_statuses s ON s.id=l.status_id JOIN campaigns c ON c.id=l.campaign_id
  JOIN clients cl ON cl.id=l.client_id JOIN landings p ON p.id=l.landing_id LEFT JOIN users u ON u.id=l.owner_id`;

const OVERDUE_MS = 24 * 3600_000;

function toView(r: LeadRow & Record<string, unknown>): LeadView {
  const v = r as unknown as LeadView;
  v.phone = decrypt(r.phone_enc);
  v.email = decrypt(r.email_enc);
  v.overdue = v.status_key === "new" && !r.is_invalid && Date.now() - new Date(r.submitted_at).getTime() > OVERDUE_MS;
  return v;
}

export async function listLeads(scope: Scope, f: LeadFilter = {}): Promise<LeadView[]> {
  const w = scopeWhere(scope);
  const cond = [w.sql];
  const params: Param[] = [...w.params];
  if (f.campaignId) { cond.push("l.campaign_id=?"); params.push(f.campaignId); }
  if (f.statusKey) { cond.push("s.key=?"); params.push(f.statusKey); }
  if (f.from) { cond.push("l.submitted_at>=?"); params.push(f.from); }
  if (f.to) { cond.push("l.submitted_at<?"); params.push(f.to); }
  if (f.flag === "duplicate") cond.push("l.is_duplicate=1");
  if (f.flag === "invalid") cond.push("l.is_invalid=1");
  if (f.flag === "overdue") { cond.push("s.key='new' AND l.is_invalid=0 AND l.submitted_at<?"); params.push(new Date(Date.now() - OVERDUE_MS).toISOString()); }
  const term = (f.q ?? "").trim();
  if (term) {
    const digits = normalizePhone(term);
    const ors = ["l.name ILIKE ? ESCAPE '\\'"];
    params.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`);
    if (digits.length >= 4) {
      ors.push("l.phone_last4=?", "l.phone_hash=?");
      params.push(digits.slice(-4), keyedHash(digits));
    }
    cond.push(`(${ors.join(" OR ")})`);
  }
  params.push(Math.min(f.limit ?? 300, 5000));
  return (await q<LeadRow & Record<string, unknown>>(`${VIEW_SELECT} WHERE ${cond.join(" AND ")} ORDER BY l.submitted_at DESC LIMIT ?`, ...params)).map(toView);
}

export async function getLead(scope: Scope, id: string): Promise<LeadView | undefined> {
  const w = scopeWhere(scope);
  const r = await one<LeadRow & Record<string, unknown>>(`${VIEW_SELECT} WHERE l.id=? AND ${w.sql}`, id, ...w.params);
  return r ? toView(r) : undefined;
}

export type Activity = { id: string; actor_type: string; actor_name: string | null; event_type: string; old_value: string | null; new_value: string | null; created_at: string };
export const listActivities = async (leadId: string) =>
  await q<Activity>("SELECT * FROM lead_activities WHERE lead_id=? ORDER BY created_at DESC, seq DESC", leadId);

/** 상태 변경 → 이력 기록 → 자동화 재평가(취소/예약). 광고주 화면과 콘솔이 같은 레코드를 본다(D-05, F-05). */
export async function changeLeadStatus(scope: Scope, a: Actor, leadId: string, statusId: string, opts: { expectedVersion?: number; clientOnly?: boolean } = {}) {
  return await tx(async () => {
    await one("SELECT id FROM leads WHERE id=? AND workspace_id=? FOR UPDATE", leadId, scope.workspaceId); // 동시 상태 변경 직렬화
    const lead = await getLead(scope, leadId);
    if (!lead) throw new AppError("리드를 찾을 수 없습니다.");
    const st = await one<LeadStatus>("SELECT * FROM lead_statuses WHERE id=? AND campaign_id=?", statusId, lead.campaign_id);
    if (!st) throw new AppError("상태를 찾을 수 없습니다.");
    if (opts.clientOnly && !st.client_editable) throw new AppError("광고주에게 허용되지 않은 상태입니다.");
    if (opts.expectedVersion && opts.expectedVersion !== lead.version) throw new AppError("다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.");
    if (st.id === lead.status_id) return;
    const t = now();
    const contacted = st.key !== "new";
    await run(
      "UPDATE leads SET status_id=?, status_changed_at=?, first_contact_at=COALESCE(first_contact_at, ?), last_contact_at=COALESCE(?, last_contact_at), version=version+1 WHERE id=?",
      st.id, t, contacted ? t : null, contacted ? t : null, leadId,
    );
    const actId = await activity(lead.workspace_id, leadId, a, "status", lead.status_label, st.label);
    await onStatusChanged(leadId, st.key, actId);
  });
}

export async function addMemo(scope: Scope, a: Actor, leadId: string, text: string) {
  const lead = await getLead(scope, leadId);
  if (!lead) throw new AppError("리드를 찾을 수 없습니다.");
  if (!text.trim()) throw new AppError("메모 내용을 입력해 주세요.");
  await activity(lead.workspace_id, leadId, a, "memo", null, text.trim().slice(0, 2000));
}

export async function assignOwner(scope: Scope, a: Actor, leadId: string, ownerId: string | null) {
  const lead = await getLead(scope, leadId);
  if (!lead) throw new AppError("리드를 찾을 수 없습니다.");
  let ownerName = "미지정";
  if (ownerId) {
    const m = await one<{ name: string }>("SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=?", lead.workspace_id, ownerId);
    if (!m) throw new AppError("담당자를 찾을 수 없습니다.");
    ownerName = m.name;
  }
  await run("UPDATE leads SET owner_id=?, version=version+1 WHERE id=?", ownerId, leadId);
  await activity(lead.workspace_id, leadId, a, "owner", lead.owner_name ?? "미지정", ownerName);
}

export async function setLeadFlag(scope: Scope, a: Actor, leadId: string, flag: "is_duplicate" | "is_invalid", value: boolean) {
  const lead = await getLead(scope, leadId);
  if (!lead) throw new AppError("리드를 찾을 수 없습니다.");
  await run(`UPDATE leads SET ${flag === "is_invalid" ? "is_invalid" : "is_duplicate"}=?, version=version+1 WHERE id=?`, value ? 1 : 0, leadId);
  await activity(lead.workspace_id, leadId, a, "flag", null, `${flag === "is_invalid" ? "허수(불량 DB)" : "중복"} 표기 ${value ? "설정" : "해제"}`);
}

/** 개인정보 삭제 요청 처리: 리드와 연관 기록을 파기한다. */
export async function deleteLead(ctx: Ctx, leadId: string) {
  if (ctx.role !== "owner") throw new AppError("권한이 없습니다.");
  const lead = await getLead(scopeOf(ctx), leadId);
  if (!lead) throw new AppError("리드를 찾을 수 없습니다.");
  await tx(async () => {
    for (const t of ["lead_activities", "lead_consents", "message_jobs"]) await run(`DELETE FROM ${t} WHERE lead_id=?`, leadId);
    await run("UPDATE tracking_events SET lead_id=NULL WHERE lead_id=?", leadId);
    await run("DELETE FROM leads WHERE id=?", leadId);
    await audit(ctx.workspaceId, { id: ctx.userId, name: ctx.userName }, "lead.delete", "lead", leadId);
  });
}

export const fieldsOf = (l: { fields_json: string }) => parseJson<Record<string, string>>(l.fields_json, {});
export const utmOf = (l: { utm_json: string }) => parseJson<Record<string, string>>(l.utm_json, {});
