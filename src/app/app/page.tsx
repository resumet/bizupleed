import Link from "next/link";
import { DailyBars, FunnelChart } from "@/components/charts";
import { Badge, Empty, PageHeader, Section, Stat, Tag, num, pct } from "@/components/ui";
import { can } from "@/lib/accounts";
import { channels, funnel, overview, parseRange, trend } from "@/lib/analytics";
import { listCampaigns } from "@/lib/campaigns";
import { maskPhone } from "@/lib/crypto";
import { listLeads, scopeOf } from "@/lib/leads";
import { KST, requireCtx } from "@/lib/session";

export default async function Dashboard() {
  const ctx = await requireCtx();
  const scope = scopeOf(ctx);
  const campaigns = await listCampaigns(ctx);
  const range = parseRange();
  const f = { scope, from: range.from, to: range.to };
  const o = await overview(f);
  const all = await overview({ scope, from: "2000", to: "9999" });
  const t = await trend(f);
  const recent = await listLeads(scope, { limit: 8 });
  const ch = (await channels(f)).slice(0, 5);

  if (!campaigns.length)
    return (
      <>
        <PageHeader title="시작하기" desc="첫 랜딩을 발행하고 신청 DB를 받아 보세요." />
        <Empty title="아직 캠페인이 없습니다" desc="① 고객사 등록 → ② 캠페인 만들기 → ③ 랜딩 제작·발행 → ④ 테스트 신청으로 DB·알림을 확인하세요.">
          {can(ctx, "client.manage") ? <Link href="/app/clients" className="btn btn-primary">고객사 등록하기</Link> : <p className="text-sm text-gray-500">관리자에게 캠페인 접근 권한을 요청하세요.</p>}
        </Empty>
      </>
    );

  return (
    <>
      <PageHeader title="대시보드" desc={`최근 14일 (${range.fromDay} ~ ${range.toDay}, KST)`}>
        {can(ctx, "analytics.view") && <Link href="/app/analytics" className="btn btn-ghost">상세 분석</Link>}
      </PageHeader>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="방문자" value={num(o.visitors)} sub="고유 방문자" />
        <Stat label="페이지뷰" value={num(o.pageviews)} />
        <Stat label="신규 리드" value={num(o.leads)} sub={`고유 연락처 ${num(o.uniqueContacts)}`} />
        <Stat label="전환율" value={pct(o.conversion)} sub="신청 세션 ÷ 방문 세션" />
        <Stat label="처리 대기" value={num(all.pending)} sub="신규 상태 전체" href="/app/leads?status=new" />
        <Stat label="확인 필요" value={num(all.overdue)} sub="24시간 넘게 미처리" href="/app/leads?flag=overdue" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="방문·신청 추이" desc="날짜별(KST). 두 지표는 척도가 달라 따로 표시합니다.">
          <div className="space-y-4">
            <DailyBars title="방문자" data={t.map((d) => ({ day: d.day, value: d.visitors }))} />
            <DailyBars title="신청(리드)" data={t.map((d) => ({ day: d.day, value: d.leads }))} />
          </div>
        </Section>
        <Section title="신청 퍼널" desc="단계별 고유 세션 수 · ↓는 직전 단계 대비">
          <FunnelChart steps={await funnel(f)} />
          <h3 className="mb-2 mt-6 text-xs font-bold text-gray-700">채널 성과</h3>
          {ch.length ? (
            <table className="w-full">
              <thead><tr><th className="th">유입</th><th className="th text-right">방문 세션</th><th className="th text-right">신청</th><th className="th text-right">전환율</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {ch.map((c) => (
                  <tr key={c.source + c.medium}><td className="td">{c.source} <span className="text-xs text-gray-400">/ {c.medium}</span></td><td className="td text-right tabular-nums">{num(c.sessions)}</td><td className="td text-right tabular-nums">{num(c.leads)}</td><td className="td text-right tabular-nums">{pct(c.sessions ? c.leads / c.sessions : null)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500">아직 수집된 방문이 없습니다. 랜딩을 발행하고 링크를 공유해 보세요.</p>}
        </Section>
      </div>
      <Section title="최근 DB" action={<Link href="/app/leads" className="text-xs font-semibold text-blue-600">전체 보기 →</Link>}>
        {recent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">신청일시</th><th className="th">이름</th><th className="th">연락처</th><th className="th">캠페인</th><th className="th">유입</th><th className="th">상태</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {recent.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="td whitespace-nowrap text-gray-500">{KST(l.submitted_at)}</td>
                    <td className="td font-semibold"><Link href={`/app/leads/${l.id}`} className="hover:underline">{l.name}</Link> {l.overdue && <Tag tone="red">24h 초과</Tag>}</td>
                    <td className="td tabular-nums">{l.phone ? maskPhone(l.phone) : "-"}</td>
                    <td className="td">{l.campaign_title}</td>
                    <td className="td text-gray-600">{l.source ?? "unknown"}</td>
                    <td className="td"><Badge color={l.status_color}>{l.status_label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-gray-500">아직 접수된 DB가 없습니다.</p>}
      </Section>
    </>
  );
}
