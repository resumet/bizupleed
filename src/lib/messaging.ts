import crypto from "node:crypto";
import { hoursFromNow, newId, now, one, parseJson, q, run, tx } from "./db";
import { decrypt, encrypt, maskPhone } from "./crypto";
import { charge, refund } from "./credits";
import { COST } from "./pricing";
import { safeFetch } from "./net";
import type { Campaign, Recipient, Rule } from "./campaigns";

export type Job = {
  id: string; workspace_id: string; campaign_id: string; lead_id: string; rule_id: string | null; kind: "customer" | "staff" | "reminder" | "sheet";
  purpose: "info" | "ad"; channel: "alimtalk" | "email" | "sheet"; recipient_enc: string; recipient_label: string | null; body: string;
  scheduled_at: string; status: "scheduled" | "queued" | "sent" | "delivered" | "failed" | "cancelled"; idempotency_key: string;
  attempts: number; last_error: string | null; created_at: string; updated_at: string;
};

// ── 발송 공급자 어댑터 ───────────────────────────────────────
// 실제 알림톡/문자/메일 공급자 연동 지점. 현재는 시뮬레이션(mock) 구현만 제공한다.
// 시뮬레이션 규칙: 번호가 0000 으로 끝나면 수신 불가, 0100000 으로 시작하면 카카오톡 미사용(문자 대체),
//                 9999 로 끝나면 공급자 일시 장애.
type SendResult = { ok: true; providerMessageId: string } | { ok: false; code: "not_kakao_user" | "invalid_number" | "temporary"; message: string };

export interface MessageProvider {
  name: string;
  sendAlimtalk(phone: string, body: string): Promise<SendResult>;
  sendSms(phone: string, body: string): Promise<SendResult>;
  sendEmail(to: string, subject: string, body: string): Promise<SendResult>;
}

const mockProvider: MessageProvider = {
  name: "mock",
  async sendAlimtalk(phone) {
    if (phone.endsWith("9999")) return { ok: false, code: "temporary", message: "공급자 일시 장애(시뮬레이션)" };
    if (phone.endsWith("0000")) return { ok: false, code: "invalid_number", message: "수신 불가 번호(시뮬레이션)" };
    if (phone.startsWith("0100000")) return { ok: false, code: "not_kakao_user", message: "카카오톡 미사용 번호(시뮬레이션)" };
    return { ok: true, providerMessageId: `mock_${crypto.randomUUID()}` };
  },
  async sendSms(phone) {
    if (phone.endsWith("0000")) return { ok: false, code: "invalid_number", message: "수신 불가 번호(시뮬레이션)" };
    return { ok: true, providerMessageId: `mock_${crypto.randomUUID()}` };
  },
  async sendEmail() {
    return { ok: true, providerMessageId: `mock_${crypto.randomUUID()}` };
  },
};

let provider: MessageProvider = mockProvider;
export const setMessageProvider = (p: MessageProvider) => { provider = p; };
export const providerName = () => provider.name;

// ── 예약 ────────────────────────────────────────────────
type LeadLite = {
  id: string; workspace_id: string; campaign_id: string; name: string; phone_enc: string | null; source: string | null;
  marketing_consent: number; is_invalid: number; status_key: string; campaign_title: string; submitted_at: string;
};

const loadLead = async (id: string) =>
  await one<LeadLite>(
    `SELECT l.id, l.workspace_id, l.campaign_id, l.name, l.phone_enc, l.source, l.marketing_consent, l.is_invalid, l.submitted_at,
            s.key AS status_key, c.title AS campaign_title
       FROM leads l JOIN lead_statuses s ON s.id=l.status_id JOIN campaigns c ON c.id=l.campaign_id WHERE l.id=?`, id);

const render = (body: string, lead: LeadLite) => body.replaceAll("{이름}", lead.name).replaceAll("{캠페인}", lead.campaign_title);

async function insertJob(j: Pick<Job, "workspace_id" | "campaign_id" | "lead_id" | "rule_id" | "kind" | "purpose" | "channel" | "body" | "scheduled_at" | "idempotency_key"> & { recipient: string; label: string }) {
  const t = now();
  // idempotency_key UNIQUE → 같은 트리거 인스턴스는 한 번만 예약된다(11.2).
  await run(
    `INSERT INTO message_jobs(id,workspace_id,campaign_id,lead_id,rule_id,kind,purpose,channel,recipient_enc,recipient_label,body,scheduled_at,status,idempotency_key,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (idempotency_key) DO NOTHING`,
    newId("mj_"), j.workspace_id, j.campaign_id, j.lead_id, j.rule_id, j.kind, j.purpose, j.channel, encrypt(j.recipient), j.label, j.body, j.scheduled_at, "scheduled", j.idempotency_key, t, t,
  );
}

async function staffJobs(lead: LeadLite, campaign: Campaign, kind: "staff" | "reminder", instance: string) {
  const phone = decrypt(lead.phone_enc);
  const head = kind === "staff" ? "[비즈업리드] 신규 DB 접수" : "[비즈업리드] 24시간 미처리 DB 재알림";
  const body = `${head}\n캠페인: ${lead.campaign_title}\n이름: ${lead.name}\n연락처: ${phone ? maskPhone(phone) : "-"}\n유입: ${lead.source ?? "unknown"}\n콘솔에서 상세 정보를 확인하세요.`;
  for (const [i, r] of parseJson<Recipient[]>(campaign.notify_json, []).slice(0, 3).entries()) {
    const base = { workspace_id: lead.workspace_id, campaign_id: lead.campaign_id, lead_id: lead.id, rule_id: null, kind, purpose: "info" as const, body, scheduled_at: now() };
    if (r.phone) await insertJob({ ...base, channel: "alimtalk", recipient: r.phone, label: `${r.name || "담당자"} ${maskPhone(r.phone)}`, idempotency_key: `${lead.id}:${kind}:${instance}:${i}:alimtalk` });
    if (r.email) await insertJob({ ...base, channel: "email", recipient: r.email, label: `${r.name || "담당자"} ${r.email}`, idempotency_key: `${lead.id}:${kind}:${instance}:${i}:email` });
  }
}

async function scheduleRules(lead: LeadLite, campaign: Campaign, triggerKey: string, instance: string) {
  if (!campaign.automation_enabled || !lead.phone_enc) return;
  const phone = decrypt(lead.phone_enc);
  for (const r of await q<Rule>("SELECT * FROM automation_rules WHERE campaign_id=? AND trigger_key=? AND enabled=1", lead.campaign_id, triggerKey)) {
    if (r.purpose === "ad" && !lead.marketing_consent) continue; // 광고성은 별도 동의자만(E-10)
    await insertJob({
      workspace_id: lead.workspace_id, campaign_id: lead.campaign_id, lead_id: lead.id, rule_id: r.id, kind: "customer", purpose: r.purpose,
      channel: "alimtalk", recipient: phone, label: `${lead.name} ${maskPhone(phone)}`, body: render(r.body, lead),
      scheduled_at: hoursFromNow(r.delay_hours), idempotency_key: `${lead.id}:${r.id}:${instance}`,
    });
  }
}

/** 리드 접수 직후: 고객 접수 확인 + 담당자 통지 + 시트 전달 예약. 리드 저장 트랜잭션 안에서 호출된다. */
export async function enqueueOnSubmit(leadId: string) {
  const lead = await loadLead(leadId);
  if (!lead) return;
  const campaign = (await one<Campaign>("SELECT * FROM campaigns WHERE id=?", lead.campaign_id))!;
  await scheduleRules(lead, campaign, "submitted", "submit");
  await staffJobs(lead, campaign, "staff", "submit");
  if (campaign.sheet_webhook_url) {
    await insertJob({
      workspace_id: lead.workspace_id, campaign_id: lead.campaign_id, lead_id: lead.id, rule_id: null, kind: "sheet", purpose: "info", channel: "sheet",
      recipient: campaign.sheet_webhook_url, label: "구글 시트 웹훅", body: "신규 리드 행 추가", scheduled_at: now(), idempotency_key: `${lead.id}:sheet`,
    });
  }
}

/** 상태 변경 시: 미집행 고객 예약을 즉시 취소하고, 새 상태에 맞는 시나리오만 다시 예약한다(E-06, E-07). */
export async function onStatusChanged(leadId: string, newStatusKey: string, instance: string) {
  await tx(async () => {
    await run("UPDATE message_jobs SET status='cancelled', last_error='상태 변경으로 취소', updated_at=? WHERE lead_id=? AND kind='customer' AND status='scheduled'", now(), leadId);
    if (newStatusKey !== "new") await run("UPDATE message_jobs SET status='cancelled', last_error='처리 시작으로 취소', updated_at=? WHERE lead_id=? AND kind='reminder' AND status='scheduled'", now(), leadId);
    const lead = await loadLead(leadId);
    if (!lead) return;
    const campaign = (await one<Campaign>("SELECT * FROM campaigns WHERE id=?", lead.campaign_id))!;
    await scheduleRules(lead, campaign, newStatusKey, instance);
  });
}

// ── 실행 ────────────────────────────────────────────────
const MAX_ATTEMPTS = 3;

async function finish(job: Job, status: Job["status"], error: string | null = null) {
  await run("UPDATE message_jobs SET status=?, last_error=?, attempts=attempts+1, updated_at=? WHERE id=?", status, error, now(), job.id);
}

async function retryOrFail(job: Job, error: string) {
  if (job.attempts + 1 >= MAX_ATTEMPTS) return finish(job, "failed", error);
  await run("UPDATE message_jobs SET status='scheduled', scheduled_at=?, last_error=?, attempts=attempts+1, updated_at=? WHERE id=?", hoursFromNow((5 * (job.attempts + 1)) / 60), error, now(), job.id);
}

async function delivery(job: Job, channel: string, status: string, cost: number, providerMessageId: string | null, error: string | null) {
  await run("INSERT INTO message_deliveries VALUES (?,?,?,?,?,?,?,?,?,?)", newId("md_"), job.workspace_id, job.id, provider.name, channel, providerMessageId, status, cost, error, now());
}

/** 광고성 메시지 야간(21~08시 KST) 발송 제한: 다음 08시로 미룬다. */
function nightDeferral(): string | null {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const h = kst.getUTCHours();
  if (h >= 8 && h < 21) return null;
  const next = new Date(kst);
  if (h >= 21) next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(8, 0, 0, 0);
  return new Date(next.getTime() - 9 * 3600_000).toISOString();
}

async function sendPaid(job: Job, channel: "alimtalk" | "sms", to: string): Promise<{ ok: boolean; code?: string; message?: string }> {
  const cost = channel === "alimtalk" ? COST.alimtalk : COST.sms;
  const opId = `msg:${job.id}:${channel}:${job.attempts}`;
  const c = await charge(job.workspace_id, opId, cost, channel === "alimtalk" ? "카카오 알림톡 발송" : "문자 대체 발송");
  if (!c.ok) return { ok: false, code: "insufficient_credits", message: "크레딧 잔액 부족" };
  let r: SendResult;
  try {
    r = channel === "alimtalk" ? await provider.sendAlimtalk(to, job.body) : await provider.sendSms(to, job.body);
  } catch (e) {
    r = { ok: false, code: "temporary", message: e instanceof Error ? e.message : "공급자 오류" };
  }
  if (r.ok) {
    await delivery(job, channel, "sent", cost, r.providerMessageId, null);
    return { ok: true };
  }
  await refund(job.workspace_id, opId, "발송 실패 크레딧 복구"); // 실패 시 반대 거래로 복구(J-04), 중복 환급 없음
  await delivery(job, channel, "failed", 0, null, r.message);
  return { ok: false, code: r.code, message: r.message };
}

async function deliver(job: Job) {
  const to = decrypt(job.recipient_enc);
  // 발송 직전 재검증(11.2): 리드 상태·수신 동의·발송 시간 정책
  if (job.kind === "customer") {
    const lead = await loadLead(job.lead_id);
    if (!lead || lead.is_invalid) return finish(job, "cancelled", "리드 없음 또는 허수 표기");
    const rule = job.rule_id ? await one<Rule>("SELECT * FROM automation_rules WHERE id=?", job.rule_id) : undefined;
    if (rule && rule.trigger_key !== "submitted" && rule.trigger_key !== lead.status_key) return finish(job, "cancelled", "리드 상태가 변경됨");
    if (job.purpose === "ad") {
      if (!lead.marketing_consent) return finish(job, "cancelled", "광고성 수신 미동의");
      const defer = nightDeferral();
      if (defer) {
        await run("UPDATE message_jobs SET status='scheduled', scheduled_at=?, last_error='야간 발송 제한으로 연기', updated_at=? WHERE id=?", defer, now(), job.id);
        return;
      }
    }
  }
  if (job.kind === "reminder") {
    const lead = await loadLead(job.lead_id);
    if (!lead || lead.status_key !== "new") return finish(job, "cancelled", "이미 처리된 리드");
  }

  if (job.channel === "email") {
    const r = await provider.sendEmail(to, job.body.split("\n")[0], job.body);
    await delivery(job, "email", r.ok ? "sent" : "failed", 0, r.ok ? r.providerMessageId : null, r.ok ? null : r.message);
    return r.ok ? await finish(job, "sent") : await retryOrFail(job, r.message);
  }

  if (job.channel === "sheet") {
    try {
      const lead = await one<Record<string, string | null>>(
        "SELECT l.id, l.name, l.phone_enc, l.email_enc, l.fields_json, l.source, l.medium, l.utm_json, l.submitted_at, c.title AS campaign FROM leads l JOIN campaigns c ON c.id=l.campaign_id WHERE l.id=?", job.lead_id);
      if (!lead) return finish(job, "cancelled", "리드 없음");
      const res = await safeFetch(to, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lead_id: lead.id, campaign: lead.campaign, name: lead.name, phone: decrypt(lead.phone_enc), email: decrypt(lead.email_enc),
          fields: parseJson(lead.fields_json, {}), source: lead.source, medium: lead.medium, utm: parseJson(lead.utm_json, {}), submitted_at: lead.submitted_at,
        }),
      });
      // Apps Script 웹앱은 성공 시 302 로 응답하므로 3xx 도 성공으로 본다.
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      await delivery(job, "sheet", "sent", 0, null, null);
      return finish(job, "sent");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "전송 실패";
      await delivery(job, "sheet", "failed", 0, null, msg);
      return retryOrFail(job, msg);
    }
  }

  // 알림톡 → (카카오톡 수신 불가 시) 문자 대체(E-02)
  const r = await sendPaid(job, "alimtalk", to);
  if (r.ok) return finish(job, "sent");
  if (r.code === "insufficient_credits") return finish(job, "failed", r.message);
  if (r.code === "temporary") return retryOrFail(job, r.message ?? "일시 오류");
  if (r.code === "not_kakao_user") {
    const s = await sendPaid(job, "sms", to);
    if (s.ok) return finish(job, "sent", "알림톡 불가 → 문자 대체 발송");
    return finish(job, "failed", s.message ?? "문자 발송 실패");
  }
  return finish(job, "failed", r.message ?? "발송 실패");
}

const g = globalThis as unknown as { __bizupTick?: Promise<number> | null };

/** 예약 시각이 지난 작업을 실행한다. 각 작업은 scheduled→queued 원자적 선점으로 1회만 집행된다. */
export async function processDueJobs(limit = 50): Promise<number> {
  const due = await q<Job>("SELECT * FROM message_jobs WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at LIMIT ?", now(), limit);
  let n = 0;
  for (const job of due) {
    const claimed = await run("UPDATE message_jobs SET status='queued', updated_at=? WHERE id=? AND status='scheduled'", now(), job.id);
    if (Number(claimed.changes) !== 1) continue;
    try {
      await deliver(job);
    } catch (e) {
      await retryOrFail(job, e instanceof Error ? e.message : "알 수 없는 오류");
    }
    n++;
  }
  return n;
}

/** 선점(queued) 후 인스턴스가 종료되어 멈춘 작업을 다시 예약한다(서버리스 타임아웃 대비). */
async function recoverStuckJobs() {
  await run("UPDATE message_jobs SET status='scheduled', last_error='처리 중단으로 재예약', updated_at=? WHERE status='queued' AND updated_at<?", now(), hoursFromNow(-0.25));
}

/** 24시간 미처리(신규 상태) 리드 담당자 재알림(D-07, E-05). 리드당 1회. */
export async function scheduleReminders(): Promise<number> {
  const rows = await q<{ id: string }>(
    `SELECT l.id FROM leads l JOIN lead_statuses s ON s.id=l.status_id
      WHERE s.key='new' AND l.is_invalid=0 AND l.reminded_at IS NULL AND l.submitted_at<? LIMIT 200`, hoursFromNow(-24));
  for (const { id } of rows) {
    await tx(async () => {
      const lead = (await loadLead(id))!;
      const campaign = (await one<Campaign>("SELECT * FROM campaigns WHERE id=?", lead.campaign_id))!;
      await staffJobs(lead, campaign, "reminder", "24h");
      await run("UPDATE leads SET reminded_at=? WHERE id=?", now(), id);
    });
  }
  return rows.length;
}

/** 주기 실행 진입점(서버 내 타이머·/api/cron/tick·접수 직후). 같은 인스턴스의 동시 실행은 하나로 합치고, 인스턴스 간 중복은 작업 선점(UPDATE … WHERE status='scheduled')으로 막는다. */
export function tick(): Promise<number> {
  if (!g.__bizupTick) {
    g.__bizupTick = (async () => {
      try {
        await recoverStuckJobs();
        await scheduleReminders();
        return await processDueJobs();
      } finally {
        g.__bizupTick = null;
      }
    })();
  }
  return g.__bizupTick;
}

export type JobView = Job & { lead_name: string | null; campaign_title: string; cost: number };

export async function listJobs(workspaceId: string, clientIds: string[] | null, opts: { leadId?: string; limit?: number } = {}): Promise<JobView[]> {
  const cond = ["j.workspace_id=?"];
  const params: (string | number)[] = [workspaceId];
  if (clientIds) {
    if (!clientIds.length) return [];
    cond.push(`c.client_id IN (${clientIds.map(() => "?").join(",")})`);
    params.push(...clientIds);
  }
  if (opts.leadId) { cond.push("j.lead_id=?"); params.push(opts.leadId); }
  params.push(opts.limit ?? 200);
  return await q<JobView>(
    `SELECT j.*, l.name AS lead_name, c.title AS campaign_title,
            (SELECT COALESCE(SUM(cost_credits),0) FROM message_deliveries d WHERE d.job_id=j.id) AS cost
       FROM message_jobs j JOIN campaigns c ON c.id=j.campaign_id LEFT JOIN leads l ON l.id=j.lead_id
      WHERE ${cond.join(" AND ")} ORDER BY j.created_at DESC, j.seq DESC LIMIT ?`, ...params);
}

/** 메시지 공급자 수신 결과 웹훅 반영. */
export async function applyDeliveryReport(providerMessageId: string, status: "delivered" | "failed", error?: string) {
  const d = await one<{ id: string; job_id: string }>("SELECT id, job_id FROM message_deliveries WHERE provider_message_id=?", providerMessageId);
  if (!d) return false;
  await run("UPDATE message_deliveries SET status=?, error=? WHERE id=?", status, error ?? null, d.id);
  if (status === "delivered") await run("UPDATE message_jobs SET status='delivered', updated_at=? WHERE id=? AND status='sent'", now(), d.job_id);
  return true;
}
