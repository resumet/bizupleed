import { AutoSelect, SubmitButton } from "@/components/client";
import { BarList, DailyBars, FunnelChart } from "@/components/charts";
import { Empty, PageHeader, Section, Stat, Tag, num, pct } from "@/components/ui";
import { can } from "@/lib/accounts";
import { channels, devices, dwell, funnel, overview, parseRange, sourcesList, trend } from "@/lib/analytics";
import { listCampaigns } from "@/lib/campaigns";
import { analyzeLanding, compareSuggestion, listSuggestions, suggestionBody } from "@/lib/improve";
import { listLandings } from "@/lib/landings";
import { scopeOf } from "@/lib/leads";
import { COST, IMPROVEMENT_MIN_VISITORS } from "@/lib/pricing";
import { KST, requireCtx } from "@/lib/session";
import { applySuggestionAction, createSuggestionAction, rejectSuggestionAction, revertSuggestionAction } from "../actions";

const sec = (v: number | null) => (v === null ? "–" : v >= 60 ? `${Math.floor(v / 60)}분 ${Math.round(v % 60)}초` : `${Math.round(v)}초`);
const SG_LABEL: Record<string, [string, "gray" | "green" | "blue" | "amber"]> = { proposed: ["승인 대기", "blue"], applied: ["적용됨", "green"], reverted: ["되돌림", "amber"], rejected: ["거절", "gray"] };

export default async function AnalyticsPage({ searchParams }: PageProps<"/app/analytics">) {
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const ctx = await requireCtx();
  if (!can(ctx, "analytics.view")) return <Empty title="접근 권한이 없습니다" />;
  const campaigns = await listCampaigns(ctx);
  const landings = (await listLandings(ctx)).filter((l) => !g("campaign") || l.campaign_id === g("campaign"));
  const range = parseRange(g("from"), g("to"));
  const landing = landings.find((l) => l.id === g("landing"));
  const f = { scope: scopeOf(ctx), from: range.from, to: range.to, campaignId: g("campaign") || undefined, landingId: landing?.id, source: g("source") || undefined };
  const o = await overview(f);
  const t = await trend(f);
  const dw = await dwell(f);
  const dv = await devices(f);
  const ch = await channels(f);
  const back = `/app/analytics?${new URLSearchParams(Object.entries({ campaign: g("campaign"), landing: g("landing"), from: g("from"), to: g("to"), source: g("source") }).filter(([, v]) => v))}`;
  const analysis = landing ? await analyzeLanding(ctx, landing.id) : null;
  const suggestions = landing ? await listSuggestions(ctx, landing.id) : [];
  const editable = can(ctx, "landing.edit");
  const comparisons = new Map(await Promise.all(suggestions.filter((sg) => sg.status === "applied").map(async (sg) => [sg.id, await compareSuggestion(ctx, sg)] as const)));

  return (
    <>
      <PageHeader title="추적·분석" desc={`${range.fromDay} ~ ${range.toDay} (KST) · 수집 즉시 집계`} />
      <form method="get" className="card mb-5 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto_auto]">
        <AutoSelect name="campaign" defaultValue={g("campaign")} ariaLabel="캠페인"><option value="">전체 캠페인</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.client_name} · {c.title}</option>)}</AutoSelect>
        <AutoSelect name="landing" defaultValue={landing?.id ?? ""} ariaLabel="랜딩"><option value="">전체 랜딩</option>{landings.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</AutoSelect>
        <AutoSelect name="source" defaultValue={g("source")} ariaLabel="유입 채널"><option value="">전체 채널</option>{(await sourcesList(f)).map((s) => <option key={s}>{s}</option>)}</AutoSelect>
        <input type="date" name="from" defaultValue={range.fromDay} className="input" aria-label="시작일" />
        <input type="date" name="to" defaultValue={range.toDay} className="input" aria-label="종료일" />
        <button className="btn btn-primary">적용</button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="방문자" value={num(o.visitors)} sub={`세션 ${num(o.sessions)}`} />
        <Stat label="페이지뷰" value={num(o.pageviews)} />
        <Stat label="리드" value={num(o.leads)} sub={`고유 연락처 ${num(o.uniqueContacts)}`} />
        <Stat label="전환율" value={pct(o.conversion)} sub="신청 세션 ÷ 방문 세션" />
        <Stat label="평균 체류" value={sec(dw.avg)} sub={`중앙값 ${sec(dw.median)}`} />
        <Stat label="출처 확인률" value={pct(o.leads ? 1 - o.unknownSourceLeads / o.leads : null, 0)} sub="direct·unknown 제외 리드" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="5단계 신청 퍼널" desc="방문 → 절반 읽음 → 버튼 클릭 → 입력 시작 → 신청 완료. 단계별 이벤트가 발생한 고유 세션 수(순서 비강제).">
          <FunnelChart steps={await funnel(f)} />
        </Section>
        <Section title="날짜별 추이" desc="방문자와 신청은 척도가 달라 각각 표시합니다.">
          <div className="space-y-4">
            <DailyBars title="방문자" data={t.map((d) => ({ day: d.day, value: d.visitors }))} />
            <DailyBars title="신청(리드)" data={t.map((d) => ({ day: d.day, value: d.leads }))} />
          </div>
        </Section>
        <Section title="매체·유입별 성과" desc="UTM → 리퍼러 순으로 판정. 판정 불가 유입은 direct/unknown으로 표시합니다.">
          {ch.length === 0 ? <p className="text-sm text-gray-500">데이터가 없습니다.</p> : (
            <table className="w-full">
              <thead><tr><th className="th">출처 / 매체</th><th className="th text-right">방문 세션</th><th className="th text-right">신청</th><th className="th text-right">전환율</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {ch.map((c) => (<tr key={c.source + c.medium}><td className="td">{c.source} <span className="text-xs text-gray-400">/ {c.medium}</span></td><td className="td text-right tabular-nums">{num(c.sessions)}</td><td className="td text-right tabular-nums">{num(c.leads)}</td><td className="td text-right tabular-nums">{pct(c.sessions ? c.leads / c.sessions : null)}</td></tr>))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="기기 · 체류시간" desc={`체류시간 표본 ${num(dw.samples)} 세션. 지역 통계는 수집하지 않습니다.`}>
          {dv.length === 0 ? <p className="text-sm text-gray-500">데이터가 없습니다.</p> : <BarList unit=" 세션" rows={dv.map((d) => ({ label: { mobile: "모바일", desktop: "데스크톱", tablet: "태블릿" }[d.device] ?? d.device, value: d.sessions }))} />}
          <p className="mt-3 text-xs text-gray-500">광고 차단·추적 거부 브라우저와 봇 트래픽은 집계에서 제외되어 광고 플랫폼 수치와 다를 수 있습니다.</p>
        </Section>
      </div>

      <Section title="섹션 도달 · AI 이탈 개선" desc={landing ? `${landing.name} — 현재 발행 버전 기준` : "랜딩을 하나 선택하면 섹션별 도달률과 AI 개선 제안을 볼 수 있습니다."}>
        {!landing ? null : !analysis ? <p className="text-sm text-gray-500">아직 발행되지 않은 랜딩입니다.</p> : (
          <>
            <p className="mb-3 text-sm text-gray-600">
              현재 버전 방문 <b>{num(analysis.sessions)}</b> 세션.{" "}
              {!analysis.enough && <span className="font-semibold text-amber-700">방문 {IMPROVEMENT_MIN_VISITORS}건을 넘어야 이탈 구간을 판정합니다(표본이 적어 통계적 신뢰도 부족).</span>}
              {analysis.enough && !analysis.suspectId && "뚜렷한 이탈 구간(10%p 이상)이 없습니다."}
            </p>
            <BarList unit="%" rows={analysis.sections.map((s, i) => ({ label: `${i + 1}. ${s.label}${s.preview ? ` · ${s.preview}` : ""}`, value: s.reachPct, sub: s.dropPct >= 1 ? `−${s.dropPct.toFixed(0)}%p` : "", mark: s.id === analysis.suspectId }))} />
            {editable && analysis.enough && (
              <form action={createSuggestionAction} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
                <input type="hidden" name="landingId" value={landing.id} /><input type="hidden" name="back" value={back} />
                <div className="min-w-56 flex-1">
                  <label className="label" htmlFor="sg-sec">개선 제안을 받을 섹션</label>
                  <select id="sg-sec" name="sectionId" className="input" defaultValue={analysis.suspectId ?? undefined}>
                    {analysis.sections.filter((s) => ["text", "notice", "cta", "form", "reviews", "countdown"].includes(s.type)).map((s) => <option key={s.id} value={s.id}>{s.label} · {s.preview} (도달 {s.reachPct.toFixed(0)}%)</option>)}
                  </select>
                </div>
                <SubmitButton pendingText="분석 중…" confirm={`AI 개선 제안 1건에 ${COST.improvement}크레딧이 차감됩니다. 진행할까요?`}>AI 개선 제안 받기 · {COST.improvement}크레딧</SubmitButton>
              </form>
            )}
            {suggestions.length > 0 && (
              <ul className="mt-5 space-y-3">
                {suggestions.map((sg) => {
                  const b = suggestionBody(sg);
                  const [label, tone] = SG_LABEL[sg.status];
                  const cmp = comparisons.get(sg.id) ?? null;
                  const st = analysis.sections.find((x) => x.id === sg.section_id);
                  return (
                    <li key={sg.id} className="rounded-lg border border-gray-200 p-4 text-sm">
                      <div className="mb-2 flex flex-wrap items-center gap-2"><Tag tone={tone}>{label}</Tag><b>{st ? `${st.label} · ${st.preview}` : "섹션"}</b><span className="text-xs text-gray-500">{KST(sg.created_at)} · {sg.engine === "claude" ? "Claude" : "규칙 기반"}</span></div>
                      <p className="text-gray-700"><b>원인 가설</b> {b.rationale}</p>
                      {(b.title || b.body || b.text) && (
                        <div className="mt-2 rounded-lg bg-blue-50 p-3">
                          <p className="mb-1 text-xs font-bold text-blue-800">수정안 미리보기 (승인 전에는 공개 페이지가 바뀌지 않습니다)</p>
                          {b.title && <p className="font-bold">{b.title}</p>}
                          {b.text && <p className="font-bold">{b.text}</p>}
                          {b.body && <p className="whitespace-pre-wrap text-gray-700">{b.body}</p>}
                        </div>
                      )}
                      {b.tips.length > 0 && <ul className="mt-2 list-disc pl-5 text-gray-600">{b.tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>}
                      {cmp && (
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full max-w-lg text-sm">
                            <thead><tr><th className="th">적용 전후 ({cmp.days.toFixed(1)}일씩)</th><th className="th text-right">세션</th><th className="th text-right">완독률</th><th className="th text-right">CTA 클릭률</th></tr></thead>
                            <tbody className="divide-y divide-gray-100">
                              <tr><td className="td">적용 전</td><td className="td text-right tabular-nums">{num(cmp.before.sessions)}</td><td className="td text-right tabular-nums">{pct(cmp.before.readRate)}</td><td className="td text-right tabular-nums">{pct(cmp.before.ctaRate)}</td></tr>
                              <tr><td className="td">적용 후 ({KST(sg.applied_at)}~)</td><td className="td text-right tabular-nums">{num(cmp.after.sessions)}</td><td className="td text-right tabular-nums">{pct(cmp.after.readRate)}</td><td className="td text-right tabular-nums">{pct(cmp.after.ctaRate)}</td></tr>
                            </tbody>
                          </table>
                          <p className="mt-1 text-xs text-gray-500">단순 전후 비교입니다. 같은 기간에 광고 소재·예산·유입 채널이 바뀌었다면 효과로 단정할 수 없으니 참고치로만 보세요.</p>
                        </div>
                      )}
                      {editable && (
                        <div className="mt-3 flex gap-2">
                          {sg.status === "proposed" && (
                            <>
                              <form action={applySuggestionAction}><input type="hidden" name="id" value={sg.id} /><input type="hidden" name="back" value={back} /><SubmitButton className="btn btn-primary btn-sm" confirm="이 수정안을 공개 랜딩에 적용할까요? 새 버전으로 발행됩니다.">승인하고 적용</SubmitButton></form>
                              <form action={rejectSuggestionAction}><input type="hidden" name="id" value={sg.id} /><input type="hidden" name="back" value={back} /><SubmitButton className="btn btn-ghost btn-sm">거절</SubmitButton></form>
                            </>
                          )}
                          {sg.status === "applied" && <form action={revertSuggestionAction}><input type="hidden" name="id" value={sg.id} /><input type="hidden" name="back" value={back} /><SubmitButton className="btn btn-ghost btn-sm" confirm="적용 전 상태로 되돌릴까요?">되돌리기</SubmitButton></form>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Section>
    </>
  );
}
