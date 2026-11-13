// 데모 데이터 생성: npm run seed
// 계정 demo@bizuplead.kr / demo1234! 와 고객사·캠페인·발행 랜딩·방문·리드를 만든다.
import { ctxFromToken, login, signup } from "../src/lib/accounts";
import { createCampaign, createClient, createShareLink, listStatuses } from "../src/lib/campaigns";
import { topup } from "../src/lib/credits";
import { closeDb, one, q, run, usingPostgres } from "../src/lib/db";
import { autoBuild } from "../src/lib/ai";
import { createLanding, publishLanding } from "../src/lib/landings";
import { addMemo, changeLeadStatus, scopeOf, submitLead } from "../src/lib/leads";
import { processDueJobs } from "../src/lib/messaging";
import { ingestEvents } from "../src/lib/tracking";

const EMAIL = "demo@bizuplead.kr";
const PASSWORD = "demo1234!";

async function main() {
  if (usingPostgres() && !process.argv.includes("--force")) {
    console.error("DATABASE_URL 이 설정되어 있습니다. 공개된 비밀번호의 데모 계정을 외부 DB 에 만들지 않도록 중단합니다. (강제 실행: npm run seed -- --force)");
    process.exit(1);
  }
  if (await one("SELECT 1 FROM users WHERE email=?", EMAIL)) {
    console.log(`이미 데모 계정이 있습니다: ${EMAIL} / ${PASSWORD}`);
    return;
  }
  await signup({ name: "데모 운영자", phone: "01012345678", email: EMAIL, password: PASSWORD, agree: true });
  const ctx = (await ctxFromToken((await login(EMAIL, PASSWORD)).token))!;
  await topup(ctx.workspaceId, "seed", 30000, 1500);

  const slugs: string[] = [];
  for (const [client, title, landing] of [["OO치과", "11월 임플란트 상담", "임플란트 무료 상담"], ["△△필라테스", "신규 회원 모집", "1:1 체형 분석 체험"]]) {
    const clientId = await createClient(ctx, client);
    const campaignId = await createCampaign(ctx, clientId, title);
    const content = autoBuild(landing, { benefit: "첫 상담 무료 · 당일 예약 가능", points: ["전문 상담사가 1:1로 안내합니다", "비용과 일정을 투명하게 알려드립니다", "신청 후 24시간 안에 연락드립니다"], mode: "auto" });
    content.form.marketingEnabled = true;
    content.form.fields.push({ id: "f_time", key: "time", label: "통화 가능 시간", type: "select", required: false, options: ["오전", "오후", "저녁"] });
    const landingId = await createLanding(ctx, campaignId, landing, "auto", content);
    await publishLanding(ctx, landingId);
    const slug = (await one<{ slug: string }>("SELECT slug FROM landings WHERE id=?", landingId))!.slug;
    slugs.push(slug);
    if (client === "OO치과") await createShareLink(ctx, clientId, "share1234", { expiresDays: 90, allowStatusChange: true, allowExport: true, maskPhone: false });

    const sections = content.sections.map((s) => s.id);
    const sources = [{ utm_source: "meta", utm_medium: "paid_social", utm_campaign: "nov_a" }, { utm_source: "naver", utm_medium: "cpc", utm_campaign: "brand" }, { utm_source: "daangn", utm_medium: "display" }, {}];
    const names = ["김민수", "이서연", "박지훈", "최유진", "정하늘", "강도윤", "윤서아", "임준호", "한지민", "오세훈"];
    let leadNo = 0;
    for (let i = 0; i < 90; i++) {
      const utm = sources[i % sources.length] as Record<string, string>;
      const depth = i % 10; // 스크롤 깊이를 다르게 해 섹션 이탈 구간을 만든다
      const reached = sections.slice(0, depth < 3 ? 2 : depth < 6 ? 4 : sections.length);
      const events = [{ name: "page_view" }, ...reached.map((section_id) => ({ name: "section_view", section_id })), { name: "dwell", value: 8 + depth * 9 }];
      if (depth >= 3) events.push({ name: "scroll_50" });
      if (depth >= 6) events.push({ name: "scroll_90" }, { name: "cta_click" });
      if (depth >= 7) events.push({ name: "form_start" });
      const ids = { visitor_id: `seedv_${slug}_${i}`, session_id: `seeds_${slug}_${i}` };
      await ingestEvents(slug, { ...ids, utm, events }, { ip: `10.0.${i % 200}.1`, ua: i % 4 === 0 ? "Mozilla/5.0 (Windows NT 10.0)" : "Mozilla/5.0 (iPhone) Mobile" });
      if (depth >= 8) {
        const phone = `010${String(1000 + ((leadNo * 37) % 9000))}${String(1000 + ((leadNo * 91) % 8000))}`;
        await submitLead(slug, { fields: { name: names[leadNo % names.length], phone, time: ["오전", "오후", "저녁"][leadNo % 3] }, consent: true, marketing: leadNo % 2 === 0, idempotency_key: `seed-${slug}-${i}`, ...ids, utm }, { ip: `10.1.${i}.1`, ua: "Mozilla/5.0 (iPhone) Mobile" });
        leadNo++;
      }
    }
    // 날짜를 최근 14일에 고르게 분산
    for (const table of ["tracking_events", "leads"] as const) {
      const col = table === "leads" ? "submitted_at" : "event_at";
      const key = table === "leads" ? "session_id" : "session_id";
      for (const r of await q<{ s: string }>(`SELECT DISTINCT ${key} AS s FROM ${table} WHERE landing_id=?`, landingId)) {
        const n = Number(r.s.split("_").pop());
        const at = new Date(Date.now() - ((n * 7) % 14) * 86400_000 - (n % 9) * 3600_000).toISOString();
        await run(`UPDATE ${table} SET ${col}=? WHERE landing_id=? AND session_id=?`, at, landingId, r.s);
      }
    }
    // 상담 진행 상태 예시
    const st = Object.fromEntries((await listStatuses(campaignId)).map((s) => [s.key, s.id]));
    const actor = { type: "user" as const, id: ctx.userId, name: ctx.userName };
    const leads = await q<{ id: string }>("SELECT id FROM leads WHERE campaign_id=? ORDER BY submitted_at", campaignId);
    for (const [i, k] of ["contracted", "consulted", "noanswer", "booked", "trying", "bad"].entries()) {
      if (!leads[i]) continue;
      await changeLeadStatus(scopeOf(ctx), actor, leads[i].id, st[k]);
      await addMemo(scopeOf(ctx), actor, leads[i].id, "데모 메모: 통화 완료, 다음 주 재연락 예정");
    }
  }
  await processDueJobs(200);
  console.log(`데모 데이터를 만들었습니다.\n  로그인: ${EMAIL} / ${PASSWORD}\n  공개 랜딩: ${slugs.map((s) => `/p/${s}`).join(", ")}\n  광고주 공유 비밀번호: share1234`);
}

main()
  .then(closeDb)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
