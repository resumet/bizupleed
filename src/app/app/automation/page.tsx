import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Empty, JOB_LABEL, PageHeader, Section, Stat, Tag, num } from "@/components/ui";
import { can } from "@/lib/accounts";
import { listCampaigns, listRules } from "@/lib/campaigns";
import { getWallet } from "@/lib/credits";
import { listJobs, providerName } from "@/lib/messaging";
import { COST } from "@/lib/pricing";
import { KST, requireCtx } from "@/lib/session";
import { runTickAction } from "../actions";

const KIND_LABEL: Record<string, string> = { customer: "고객 메시지", staff: "담당자 통지", reminder: "미처리 재알림", sheet: "시트 전달" };
const CH_LABEL: Record<string, string> = { alimtalk: "알림톡", email: "메일", sheet: "시트" };

export default async function AutomationPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "automation.edit")) return <Empty title="접근 권한이 없습니다" />;
  const campaigns = await listCampaigns(ctx);
  const jobs = await listJobs(ctx.workspaceId, ctx.clientScope, { limit: 150 });
  const count = (s: string) => jobs.filter((j) => j.status === s).length;
  const wallet = await getWallet(ctx.workspaceId);
  const rulesByCampaign = new Map(await Promise.all(campaigns.map(async (c) => [c.id, await listRules(c.id)] as const)));
  return (
    <>
      <PageHeader title="알림·자동화" desc="신규 리드 통지, 고객 접수 확인, 상태·시간 기반 후속 메시지의 예약과 발송 결과입니다.">
        <form action={runTickAction}><SubmitButton className="btn btn-ghost">예약 발송 지금 처리</SubmitButton></form>
      </PageHeader>
      {providerName() === "mock" && (
        <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          현재 메시지 공급자는 <b>시뮬레이션(mock)</b>입니다. 실제 알림톡·문자·메일은 나가지 않으며 발송 흐름·크레딧 차감·실패 복구만 동일하게 동작합니다.
        </p>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="예약" value={num(count("scheduled"))} />
        <Stat label="발송" value={num(count("sent") + count("delivered"))} />
        <Stat label="실패" value={num(count("failed"))} />
        <Stat label="취소" value={num(count("cancelled"))} sub="상태 변경·미동의 등" />
        <Stat label="크레딧 잔액" value={num(wallet.total)} sub={`알림톡 ${COST.alimtalk} / 건`} href={can(ctx, "billing.manage") ? "/app/billing" : undefined} />
      </div>
      <Section title="캠페인별 시나리오" desc="시나리오 문구·지연 시간·수신자는 캠페인 설정에서 바꿉니다.">
        {campaigns.length === 0 ? <p className="text-sm text-gray-500">캠페인이 없습니다.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {campaigns.map((c) => {
              const rules = rulesByCampaign.get(c.id) ?? [];
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div><b>{c.title}</b> <span className="text-gray-500">· {c.client_name}</span> {!c.automation_enabled && <Tag tone="amber">자동화 꺼짐</Tag>}</div>
                  <div className="flex items-center gap-3"><span className="text-gray-500">사용 중 {rules.filter((r) => r.enabled).length} / {rules.length}</span><Link href={`/app/campaigns/${c.id}`} className="btn btn-ghost btn-sm">설정</Link></div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="발송 기록" desc="최근 150건">
        {jobs.length === 0 ? <p className="text-sm text-gray-500">아직 기록이 없습니다.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">시각</th><th className="th">결과</th><th className="th">종류</th><th className="th">채널</th><th className="th">수신</th><th className="th">리드</th><th className="th text-right">크레딧</th><th className="th">비고</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map((j) => {
                  const [label, tone] = JOB_LABEL[j.status];
                  return (
                    <tr key={j.id}>
                      <td className="td whitespace-nowrap text-gray-500">{j.status === "scheduled" ? `${KST(j.scheduled_at)} 예정` : KST(j.updated_at)}</td>
                      <td className="td"><Tag tone={tone}>{label}</Tag></td>
                      <td className="td whitespace-nowrap">{KIND_LABEL[j.kind]} {j.purpose === "ad" && <Tag tone="amber">광고성</Tag>}</td>
                      <td className="td">{CH_LABEL[j.channel]}</td>
                      <td className="td whitespace-nowrap text-gray-600">{j.recipient_label}</td>
                      <td className="td">{j.lead_name ? <Link href={`/app/leads/${j.lead_id}`} className="text-blue-700 hover:underline">{j.lead_name}</Link> : "-"}</td>
                      <td className="td text-right tabular-nums">{j.cost || "-"}</td>
                      <td className="td text-xs text-gray-500">{j.last_error ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
