import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Empty, PageHeader, Section } from "@/components/ui";
import { can } from "@/lib/accounts";
import { listCampaigns, listClients } from "@/lib/campaigns";
import { KST, requireCtx } from "@/lib/session";
import { createCampaignAction } from "../actions";

export default async function CampaignsPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "campaign.create")) return <Empty title="접근 권한이 없습니다" />;
  const clients = await listClients(ctx);
  const campaigns = await listCampaigns(ctx);
  return (
    <>
      <PageHeader title="캠페인" desc="캠페인 단위로 랜딩·리드 상태·알림 수신자·광고 추적 ID를 관리합니다." />
      {clients.length === 0 ? (
        <Empty title="먼저 고객사를 등록해 주세요">{can(ctx, "client.manage") && <Link href="/app/clients" className="btn btn-primary">고객사 등록</Link>}</Empty>
      ) : (
        <Section title="캠페인 만들기">
          <form action={createCampaignAction} className="flex flex-wrap items-end gap-3">
            <div className="min-w-40"><label className="label" htmlFor="cp-client">고객사</label><select id="cp-client" name="clientId" className="input">{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="min-w-56 flex-1"><label className="label" htmlFor="cp-title">캠페인 이름</label><input id="cp-title" name="title" className="input" required placeholder="예: 11월 임플란트 상담" /></div>
            <SubmitButton>만들기</SubmitButton>
          </form>
        </Section>
      )}
      {campaigns.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-100"><tr><th className="th">캠페인</th><th className="th">고객사</th><th className="th text-right">랜딩</th><th className="th text-right">리드</th><th className="th">생성일</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="td font-semibold"><Link href={`/app/campaigns/${c.id}`} className="hover:underline">{c.title}</Link></td>
                  <td className="td text-gray-600">{c.client_name}</td>
                  <td className="td text-right tabular-nums">{c.landing_count}</td>
                  <td className="td text-right tabular-nums"><Link href={`/app/leads?campaign=${c.id}`} className="text-blue-600 hover:underline">{c.lead_count}</Link></td>
                  <td className="td text-gray-500">{KST(c.created_at, false)}</td>
                  <td className="td text-right"><Link href={`/app/campaigns/${c.id}`} className="btn btn-ghost btn-sm">설정</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
