import { beforeEach, describe, expect, it } from "vitest";
import { addMember, AppError, ctxFromToken, Ctx, login, signup } from "../src/lib/accounts";
import { createCampaign, createClient, createShareLink, getActiveShareLink, listRules, listStatuses, openShareSession, updateRule } from "../src/lib/campaigns";
import { charge, getWallet, refund, topup } from "../src/lib/credits";
import { one, q, resetDbForTests, run } from "../src/lib/db";
import { analyzeLanding, applySuggestion, createSuggestion, revertSuggestion } from "../src/lib/improve";
import { createLanding, getPublicLanding, publishLanding } from "../src/lib/landings";
import { changeLeadStatus, getLead, listLeads, scopeOf, submitLead, SubmitError } from "../src/lib/leads";
import { listJobs, processDueJobs, scheduleReminders } from "../src/lib/messaging";
import { funnel, overview } from "../src/lib/analytics";
import { ingestEvents } from "../src/lib/tracking";
import { createProject, listPages, revisePages, runImages, runPlan } from "../src/lib/studio-server";
import { parseTargets } from "../src/lib/studio";

const META = { ip: "1.1.1.1", ua: "Mozilla/5.0 (iPhone) Mobile" };
let n = 0;

async function account(name: string): Promise<Ctx> {
  const email = `${name}${++n}@test.kr`;
  await signup({ name, phone: "01012345678", email, password: "password1", agree: true });
  return (await ctxFromToken((await login(email, "password1")).token))!;
}

async function setup(ctx: Ctx, clientName = "고객사A") {
  const clientId = await createClient(ctx, clientName);
  const campaignId = await createCampaign(ctx, clientId, `${clientName} 캠페인`);
  const landingId = await createLanding(ctx, campaignId, "테스트 랜딩", "blog");
  // 블로그 기본 템플릿의 빈 이미지 섹션 제거 후 발행
  const row = (await one<{ content_json: string; slug: string }>("SELECT content_json, slug FROM landings WHERE id=?", landingId))!;
  const content = JSON.parse(row.content_json);
  content.sections = content.sections.filter((s: { type: string }) => s.type !== "image");
  content.form.marketingEnabled = true;
  await run("UPDATE landings SET content_json=? WHERE id=?", JSON.stringify(content), landingId);
  await publishLanding(ctx, landingId);
  return { clientId, campaignId, landingId, slug: row.slug, content };
}

const payload = (key: string, phone = "01055556666", extra: object = {}) => ({
  fields: { name: "홍길동", phone }, consent: true, idempotency_key: key, visitor_id: "visitor_1", session_id: `session_${key}`, ...extra,
});

beforeEach(async () => await resetDbForTests());

describe("가입·체험·구독", () => {
  it("카드 없이 가입하면 14일 체험이 시작되고, 만료되면 공개만 중지되고 리드는 남는다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    expect(await getPublicLanding(slug)).not.toBeNull();
    await submitLead(slug, payload("idem-0001"), META);
    await run("UPDATE subscriptions SET trial_end='2000-01-01T00:00:00.000Z' WHERE workspace_id=?", ctx.workspaceId);
    expect(await getPublicLanding(slug)).toBeNull();
    expect((await one<{ status: string }>("SELECT status FROM subscriptions WHERE workspace_id=?", ctx.workspaceId))!.status).toBe("suspended");
    expect(await listLeads(scopeOf(ctx))).toHaveLength(1);
    await expect(submitLead(slug, payload("idem-0002"), META)).rejects.toThrow(SubmitError);
  });

  it("가입 입력값을 검증한다", async () => {
    await expect(signup({ name: "가나", phone: "01012345678", email: "a@b.kr", password: "short", agree: true })).rejects.toThrow(AppError);
    await expect(signup({ name: "가나", phone: "01012345678", email: "a@b.kr", password: "password1", agree: false })).rejects.toThrow(AppError);
    await account("dup");
    await expect(signup({ name: "가나", phone: "01012345678", email: `dup${n}@test.kr`, password: "password1", agree: true })).rejects.toThrow("이미 가입된");
  });
});

describe("리드 접수", () => {
  it("같은 idempotency key 는 한 번만 저장된다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    const a = await submitLead(slug, payload("idem-same-1"), META);
    const b = await submitLead(slug, payload("idem-same-1"), META);
    expect(a.replay).toBe(false);
    expect(b.replay).toBe(true);
    expect(b.leadId).toBe(a.leadId);
    expect(await listLeads(scopeOf(ctx))).toHaveLength(1);
    // 즉시 알림도 중복 예약되지 않는다
    const jobs = await listJobs(ctx.workspaceId, null);
    expect(new Set(jobs.map((j) => j.idempotency_key)).size).toBe(jobs.length);
    expect(jobs.filter((j) => j.kind === "customer")).toHaveLength(1);
  });

  it("동의·필수값·전화번호를 서버에서 재검증한다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    await expect(submitLead(slug, { ...payload("idem-noconsent"), consent: false }, META)).rejects.toThrow("동의");
    await expect(submitLead(slug, payload("idem-badphone", "12345"), META)).rejects.toThrow("전화번호");
    await expect(submitLead(slug, { ...payload("idem-noname"), fields: { phone: "01055556666" } }, META)).rejects.toThrow("이름");
    await expect(submitLead(slug, { ...payload("idem-bot"), hp: "spam" }, META)).rejects.toThrow(SubmitError);
    expect(await listLeads(scopeOf(ctx))).toHaveLength(0);
  });

  it("연락처는 암호화 저장되고 같은 번호는 중복으로 표시된다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    await submitLead(slug, payload("idem-dup-1"), META);
    await submitLead(slug, payload("idem-dup-2"), META);
    const raw = await q<{ phone_enc: string; is_duplicate: number }>("SELECT phone_enc, is_duplicate FROM leads ORDER BY seq");
    expect(raw[0].phone_enc).not.toContain("01055556666");
    expect(raw.map((r) => r.is_duplicate)).toEqual([0, 1]);
    expect(await listLeads(scopeOf(ctx), { q: "6666" })).toHaveLength(2);
    expect((await listLeads(scopeOf(ctx), { q: "010-5555-6666" }))[0].phone).toBe("01055556666");
    expect(await listLeads(scopeOf(ctx), { q: "1234" })).toHaveLength(0);
  });

  it("동의 문구 버전과 동의 시각을 증적으로 남긴다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    const { leadId } = await submitLead(slug, { ...payload("idem-consent"), marketing: true }, META);
    const consents = await q<{ kind: string; text: string }>("SELECT lc.kind, cv.text FROM lead_consents lc JOIN consent_versions cv ON cv.id=lc.consent_version_id WHERE lc.lead_id=?", leadId);
    expect(consents.map((c) => c.kind).sort()).toEqual(["marketing", "privacy"]);
    expect(consents.find((c) => c.kind === "privacy")!.text).toContain("개인정보");
  });
});

describe("테넌트 격리·권한", () => {
  it("다른 워크스페이스·다른 고객사의 리드에 접근할 수 없다", async () => {
    const a = await account("agencyA");
    const b = await account("agencyB");
    const A1 = await setup(a, "고객사A");
    const A2 = await setup(a, "고객사B");
    const leadA1 = (await submitLead(A1.slug, payload("idem-iso-1"), META)).leadId;
    const leadA2 = (await submitLead(A2.slug, payload("idem-iso-2", "01077778888"), META)).leadId;

    expect(await getLead(scopeOf(b), leadA1)).toBeUndefined();
    expect(await listLeads(scopeOf(b))).toHaveLength(0);
    await expect(changeLeadStatus(scopeOf(b), { type: "user", id: b.userId, name: "b" }, leadA1, (await listStatuses(A1.campaignId))[1].id)).rejects.toThrow(AppError);

    // 고객사A 만 할당된 상담 담당자
    await addMember(a, { name: "상담원", email: "agent@test.kr", password: "password1", role: "agent", clientIds: [A1.clientId], canExport: false });
    const agent = (await ctxFromToken((await login("agent@test.kr", "password1")).token))!;
    expect((await listLeads(scopeOf(agent))).map((l) => l.id)).toEqual([leadA1]);
    expect(await getLead(scopeOf(agent), leadA2)).toBeUndefined();
    await expect(createClient(agent, "X")).rejects.toThrow("권한");
    expect(agent.canExport).toBe(false);

    // 광고주 공유 범위(고객사A)
    const shareScope = { workspaceId: a.workspaceId, clientIds: [A1.clientId] };
    expect(await getLead(shareScope, leadA2)).toBeUndefined();
    expect((await overview({ scope: shareScope, from: "2000", to: "9999" })).leads).toBe(1);
  });

  it("공유 링크는 비밀번호로 보호되고 접속 기록이 남는다", async () => {
    const a = await account("agency");
    const { clientId } = await setup(a);
    const id = await createShareLink(a, clientId, "secret12", { expiresDays: 7, allowStatusChange: true, allowExport: false, maskPhone: false });
    const link = (await getActiveShareLink((await one<{ token: string }>("SELECT token FROM share_links WHERE id=?", id))!.token))!;
    expect(await openShareSession(link, "wrong", "9.9.9.9")).toBeNull();
    expect(await openShareSession(link, "secret12", "9.9.9.9")).toBeTruthy();
    expect((await q("SELECT ok FROM share_access_logs ORDER BY seq")).map((r) => r.ok)).toEqual([0, 1]);
    await run("UPDATE share_links SET expires_at='2000-01-01' WHERE id=?", id);
    expect(await getActiveShareLink(link.token)).toBeUndefined();
  });
});

describe("크레딧 원장", () => {
  it("차감·환급은 operation_id 기준으로 중복되지 않는다", async () => {
    const ctx = await account("owner");
    const ws = ctx.workspaceId;
    expect(await charge(ws, "op1", 100, "x")).toMatchObject({ ok: false, reason: "insufficient" });
    await topup(ws, "pay1", 1000, 100);
    await topup(ws, "pay1", 1000, 100); // 웹훅 재호출
    expect((await getWallet(ws)).total).toBe(1100);
    expect(await charge(ws, "op1", 300, "x")).toMatchObject({ ok: true, already: false });
    expect(await charge(ws, "op1", 300, "x")).toMatchObject({ ok: true, already: true });
    const w = await getWallet(ws);
    expect([w.paid_balance, w.bonus_balance]).toEqual([800, 0]); // 무상 100 먼저 사용
    expect(await refund(ws, "op1", "r")).toBe(true);
    expect(await refund(ws, "op1", "r")).toBe(false);
    const w2 = await getWallet(ws);
    expect([w2.paid_balance, w2.bonus_balance]).toEqual([1000, 100]);
    expect((await q("SELECT kind FROM credit_ledger WHERE workspace_id=? ORDER BY seq", ws)).map((r) => r.kind)).toEqual(["topup", "charge", "refund"]);
  });
});

describe("알림·자동화", () => {
  it("접수 직후 고객 알림톡과 담당자 통지가 발송되고 크레딧이 차감된다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    await topup(ctx.workspaceId, "pay", 1000, 0);
    await submitLead(slug, payload("idem-msg-1"), META);
    await processDueJobs();
    const jobs = await listJobs(ctx.workspaceId, null);
    expect(jobs.map((j) => `${j.kind}/${j.channel}/${j.status}`).sort()).toEqual(["customer/alimtalk/sent", "staff/alimtalk/sent", "staff/email/sent"]);
    expect((await getWallet(ctx.workspaceId)).total).toBe(1000 - 60);
    expect(await processDueJobs()).toBe(0); // 재실행해도 재발송 없음
  });

  it("카카오톡 불가 번호는 문자로 대체하고, 수신 불가 번호는 실패 처리 후 크레딧을 복구한다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    await run("UPDATE campaigns SET notify_json='[]'");
    await topup(ctx.workspaceId, "pay", 1000, 0);
    await submitLead(slug, payload("idem-sms-1", "01000001234"), META);
    await processDueJobs();
    expect(await q("SELECT channel, status, cost_credits FROM message_deliveries ORDER BY seq")).toEqual([
      { channel: "alimtalk", status: "failed", cost_credits: 0 },
      { channel: "sms", status: "sent", cost_credits: 30 },
    ]);
    expect((await getWallet(ctx.workspaceId)).total).toBe(970);

    await submitLead(slug, payload("idem-sms-2", "01033330000"), META);
    await processDueJobs();
    expect((await listJobs(ctx.workspaceId, null))[0].status).toBe("failed");
    expect((await getWallet(ctx.workspaceId)).total).toBe(970);
  });

  it("잔액이 부족하면 유료 발송을 실행하지 않는다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    await submitLead(slug, payload("idem-nocredit"), META);
    await processDueJobs();
    const jobs = await listJobs(ctx.workspaceId, null);
    expect(jobs.find((j) => j.kind === "customer")!.status).toBe("failed");
    expect(jobs.find((j) => j.channel === "email")!.status).toBe("sent"); // 메일 통지는 무료
    expect(await q("SELECT 1 FROM message_deliveries WHERE channel='alimtalk'")).toHaveLength(0);
  });

  it("계약으로 바뀐 리드의 미계약 재촉 예약은 취소되고 발송되지 않는다", async () => {
    const ctx = await account("owner");
    const { slug, campaignId } = await setup(ctx);
    await topup(ctx.workspaceId, "pay", 10000, 0);
    const rule = (await listRules(campaignId)).find((r) => r.key === "consulted_72h")!;
    await updateRule(ctx, rule.id, { enabled: true, body: rule.body, delayHours: 72 });
    const { leadId } = await submitLead(slug, { ...payload("idem-auto-1"), marketing: true }, META);
    await processDueJobs();
    const st = Object.fromEntries((await listStatuses(campaignId)).map((s) => [s.key, s.id]));
    const actor = { type: "user" as const, id: ctx.userId, name: ctx.userName };

    await changeLeadStatus(scopeOf(ctx), actor, leadId, st.consulted);
    const pending = async () => (await listJobs(ctx.workspaceId, null, { leadId })).filter((j) => j.rule_id === rule.id);
    expect((await pending()).map((j) => j.status)).toEqual(["scheduled"]);

    await changeLeadStatus(scopeOf(ctx), actor, leadId, st.contracted);
    expect((await pending()).map((j) => j.status)).toEqual(["cancelled"]);
    await run("UPDATE message_jobs SET scheduled_at='2000-01-01T00:00:00.000Z' WHERE rule_id=?", rule.id);
    await processDueJobs();
    expect(await q("SELECT 1 FROM message_deliveries d JOIN message_jobs j ON j.id=d.job_id WHERE j.rule_id=?", rule.id)).toHaveLength(0);

    // 발송 직전 재검증: 예약이 남아 있어도 상태가 다르면 취소
    await run("UPDATE message_jobs SET status='scheduled' WHERE rule_id=?", rule.id);
    await processDueJobs();
    expect((await pending()).map((j) => j.status)).toEqual(["cancelled"]);
  });

  it("광고성 시나리오는 수신 동의가 없으면 예약되지 않는다", async () => {
    const ctx = await account("owner");
    const { slug, campaignId } = await setup(ctx);
    const rule = (await listRules(campaignId)).find((r) => r.key === "consulted_72h")!;
    await updateRule(ctx, rule.id, { enabled: true, body: rule.body, delayHours: 72 });
    const { leadId } = await submitLead(slug, payload("idem-noad"), META);
    const st = Object.fromEntries((await listStatuses(campaignId)).map((s) => [s.key, s.id]));
    await changeLeadStatus(scopeOf(ctx), { type: "user", id: ctx.userId, name: "o" }, leadId, st.consulted);
    expect((await listJobs(ctx.workspaceId, null, { leadId })).filter((j) => j.rule_id === rule.id)).toHaveLength(0);
    await expect(updateRule(ctx, rule.id, { enabled: true, body: "광고 표기 없는 문구", delayHours: 72 })).rejects.toThrow("(광고)");
  });

  it("24시간 미처리 리드는 한 번만 재알림한다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    const { leadId } = await submitLead(slug, payload("idem-remind"), META);
    await run("UPDATE leads SET submitted_at='2000-01-01T00:00:00.000Z' WHERE id=?", leadId);
    expect(await scheduleReminders()).toBe(1);
    expect(await scheduleReminders()).toBe(0);
    expect((await listJobs(ctx.workspaceId, null)).filter((j) => j.kind === "reminder").length).toBeGreaterThan(0);
    expect(await listLeads(scopeOf(ctx), { flag: "overdue" })).toHaveLength(1);
  });
});

describe("추적·퍼널·AI 개선", () => {
  async function visit(slug: string, i: number, events: string[], sectionIds: string[] = []) {
    await ingestEvents(slug, {
      visitor_id: `visitor_${i}`, session_id: `session_${i}`, utm: { utm_source: "meta", utm_medium: "paid_social" },
      events: [...events.map((name) => ({ name })), ...sectionIds.map((section_id) => ({ name: "section_view", section_id }))],
    }, { ip: `2.2.2.${i % 250}`, ua: META.ua });
  }

  it("5단계 퍼널과 전환율을 고유 세션 기준으로 집계한다", async () => {
    const ctx = await account("owner");
    const { slug } = await setup(ctx);
    for (let i = 0; i < 10; i++) await visit(slug, i, i < 5 ? ["page_view", "scroll_50", "cta_click", "form_start"] : ["page_view"]);
    await submitLead(slug, { ...payload("idem-funnel"), visitor_id: "visitor_0", session_id: "session_0", utm: { utm_source: "meta" } }, META);
    const f = { scope: scopeOf(ctx), from: "2000", to: "9999" };
    expect((await funnel(f)).map((s) => s.count)).toEqual([10, 5, 5, 5, 1]);
    const o = await overview(f);
    expect([o.visitors, o.pageviews, o.leads]).toEqual([10, 10, 1]);
    expect(o.conversion).toBeCloseTo(0.1);
    expect((await listLeads(scopeOf(ctx)))[0].source).toBe("meta");
  });

  it("개선안은 승인 전에는 공개 랜딩을 바꾸지 않고, 적용 후 되돌릴 수 있다", async () => {
    const ctx = await account("owner");
    const { slug, landingId, content } = await setup(ctx);
    const [s1, s2] = content.sections.filter((s: { type: string }) => s.type === "text").map((s: { id: string }) => s.id);
    await expect(createSuggestion(ctx, landingId, s2)).rejects.toThrow("50");
    for (let i = 0; i < 60; i++) await visit(slug, i, ["page_view"], i < 20 ? [s1, s2] : [s1]);
    const a = (await analyzeLanding(ctx, landingId))!;
    expect(a.enough).toBe(true);
    expect(a.suspectId).toBe(s2);

    await expect(createSuggestion(ctx, landingId, s2)).rejects.toThrow("크레딧");
    await topup(ctx.workspaceId, "pay", 1000, 0);
    const id = await createSuggestion(ctx, landingId, s2);
    expect((await getWallet(ctx.workspaceId)).total).toBe(700);
    const titleOf = async () => (await getPublicLanding(slug))!.content.sections.find((s) => s.id === s2)!.props.title;
    const original = await titleOf();
    expect((await one<{ status: string }>("SELECT status FROM ai_suggestions WHERE id=?", id))!.status).toBe("proposed");
    expect(await titleOf()).toBe(original); // 승인 전 변경 없음

    await applySuggestion(ctx, id);
    expect(await titleOf()).not.toBe(original);
    await revertSuggestion(ctx, id);
    expect(await titleOf()).toBe(original);
    expect((await q("SELECT note FROM landing_versions WHERE landing_id=? ORDER BY seq", landingId)).map((v) => v.note)).toEqual(["발행", "AI 개선안 적용", "AI 개선안 되돌리기"]);
  });
});

describe("AI 상세페이지 작업실", () => {
  it("체험 무료 혜택 → 기획 → 이미지 → 지정 장만 재생성하고 실패 시 크레딧을 복구한다", async () => {
    const ctx = await account("owner");
    const id = await createProject(ctx, { name: "프리미엄 필라테스", mode: "quick", description: "1:1 맞춤 수업. 체형 분석 제공. 주차 가능.", productUrl: "", referenceUrl: "", photos: [] });
    await runPlan(ctx, id); // 체험 무료 1회 사용
    expect((await one<{ free_plan_left: number }>("SELECT free_plan_left FROM subscriptions WHERE workspace_id=?", ctx.workspaceId))!.free_plan_left).toBe(1);
    await runImages(ctx, id);
    const before = await listPages(ctx, id);
    expect(before).toHaveLength(5);

    expect((await revisePages(ctx, id, [3], "3번째 장 배경을 파란색으로")).failed[0].error).toContain("크레딧");
    await topup(ctx.workspaceId, "pay", 5000, 0);
    const r = await revisePages(ctx, id, [3], "3번째 장 배경을 파란색으로");
    expect(r.done).toEqual([3]);
    const after = await listPages(ctx, id);
    expect(after[2].spec.bg).toBe("#1d4ed8");
    expect(after.filter((_, i) => i !== 2).map((p) => p.spec)).toEqual(before.filter((_, i) => i !== 2).map((p) => p.spec));
    expect((await getWallet(ctx.workspaceId)).total).toBe(4000);

    const bad = await revisePages(ctx, id, [1], "음"); // 해석 불가 → 복구
    expect(bad.failed).toHaveLength(1);
    expect((await getWallet(ctx.workspaceId)).total).toBe(4000);
  });

  it("채팅 명령에서 대상 장을 해석한다", () => {
    expect(parseTargets("3번째 장 배경 변경", 8)).toEqual({ pages: [3], all: false });
    expect(parseTargets("2번이랑 5번 장 제목 수정", 8).pages).toEqual([2, 5]);
    expect(parseTargets("전체 배경을 검정으로", 4)).toEqual({ pages: [1, 2, 3, 4], all: true });
    expect(parseTargets("배경 바꿔줘", 4).pages).toEqual([]);
  });
});
