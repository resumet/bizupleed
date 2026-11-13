import Link from "next/link";
import { AutoSelect } from "@/components/client";
import { Badge, Empty, PageHeader, Tag } from "@/components/ui";
import { can } from "@/lib/accounts";
import { parseRange } from "@/lib/analytics";
import { DEFAULT_STATUSES, listCampaigns, listStatuses } from "@/lib/campaigns";
import { formatPhone } from "@/lib/crypto";
import { LeadFilter, listLeads, scopeOf } from "@/lib/leads";
import { KST, requireCtx } from "@/lib/session";
import { leadStatusAction } from "../actions";

export default async function LeadsPage({ searchParams }: PageProps<"/app/leads">) {
  const sp = await searchParams;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const ctx = await requireCtx();
  const campaigns = await listCampaigns(ctx);
  const filter: LeadFilter = { q: g("q"), campaignId: g("campaign") || undefined, statusKey: g("status") || undefined, flag: g("flag") as LeadFilter["flag"], limit: 300 };
  if (g("from") || g("to")) {
    const r = parseRange(g("from") || "2000-01-01", g("to") || undefined);
    filter.from = r.from;
    filter.to = r.to;
  }
  const leads = await listLeads(scopeOf(ctx), filter);
  const statusByCampaign = new Map(await Promise.all(campaigns.map(async (c) => [c.id, await listStatuses(c.id)] as const)));
  const statusTabs = filter.campaignId && statusByCampaign.get(filter.campaignId)
    ? statusByCampaign.get(filter.campaignId)!.map((s) => [s.key, s.label] as const)
    : DEFAULT_STATUSES.map(([k, label]) => [k, label] as const);
  const qs = new URLSearchParams(Object.entries({ q: g("q"), campaign: g("campaign"), status: g("status"), flag: g("flag"), from: g("from"), to: g("to") }).filter(([, v]) => v));
  const tab = (patch: Record<string, string>) => {
    const p = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    return `/app/leads${p.size ? `?${p}` : ""}`;
  };
  const back = `/app/leads${qs.size ? `?${qs}` : ""}`;
  const editable = can(ctx, "lead.edit");

  return (
    <>
      <PageHeader title="리드(DB) 관리" desc={`${leads.length}건${leads.length >= 300 ? " (최근 300건만 표시 — 필터로 좁혀 보세요)" : ""}`}>
        {can(ctx, "lead.export") && <a href={`/api/leads/export${qs.size ? `?${qs}` : ""}`} className="btn btn-ghost">엑셀 내보내기</a>}
      </PageHeader>
      <form method="get" className="card mb-3 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.2fr_auto_auto_auto]">
        <input name="q" defaultValue={g("q")} className="input" placeholder="이름 또는 연락처(뒤 4자리·전체 번호)" aria-label="검색어" />
        <AutoSelect name="campaign" defaultValue={g("campaign")} ariaLabel="캠페인">
          <option value="">전체 캠페인</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.client_name} · {c.title}</option>)}
        </AutoSelect>
        <input type="date" name="from" defaultValue={g("from")} className="input" aria-label="시작일" />
        <input type="date" name="to" defaultValue={g("to")} className="input" aria-label="종료일" />
        {g("status") && <input type="hidden" name="status" value={g("status")} />}
        {g("flag") && <input type="hidden" name="flag" value={g("flag")} />}
        <button className="btn btn-primary">검색</button>
      </form>
      <nav aria-label="상태 필터" className="mb-3 flex flex-wrap gap-1.5 text-sm">
        {[["", "전체"] as const, ...statusTabs].map(([k, label]) => (
          <Link key={k} href={tab({ status: k, flag: "" })} aria-current={g("status") === k && !g("flag") ? "true" : undefined} className={`rounded-full px-3 py-1 font-semibold ${g("status") === k && !g("flag") ? "bg-gray-900 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>{label}</Link>
        ))}
        <span className="mx-1 self-center text-gray-300">|</span>
        {([["overdue", "24h 미처리"], ["duplicate", "중복"], ["invalid", "허수"]] as const).map(([k, label]) => (
          <Link key={k} href={tab({ flag: g("flag") === k ? "" : k, status: "" })} className={`rounded-full px-3 py-1 font-semibold ${g("flag") === k ? "bg-red-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>{label}</Link>
        ))}
      </nav>

      {leads.length === 0 ? (
        <Empty title="조건에 맞는 리드가 없습니다" desc="필터를 바꾸거나, 랜딩을 발행해 신청을 받아 보세요." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-100"><tr><th className="th">신청일시</th><th className="th">이름</th><th className="th">연락처</th><th className="th">캠페인</th><th className="th">유입</th><th className="th">담당</th><th className="th">상태</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {leads.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="td whitespace-nowrap text-gray-500">{KST(l.submitted_at)}</td>
                  <td className="td whitespace-nowrap font-semibold">
                    <Link href={`/app/leads/${l.id}`} className="hover:underline">{l.name}</Link>{" "}
                    {l.overdue && <Tag tone="red">24h 초과</Tag>} {!!l.is_duplicate && <Tag tone="amber">중복</Tag>} {!!l.is_invalid && <Tag>허수</Tag>}
                  </td>
                  <td className="td whitespace-nowrap tabular-nums">{l.phone ? formatPhone(l.phone) : l.email || "-"}</td>
                  <td className="td text-gray-600">{l.campaign_title}</td>
                  <td className="td text-gray-600">{l.source ?? "unknown"}</td>
                  <td className="td text-gray-600">{l.owner_name ?? "-"}</td>
                  <td className="td">
                    {editable ? (
                      <form action={leadStatusAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={l.id} /><input type="hidden" name="version" value={l.version} /><input type="hidden" name="back" value={back} />
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.status_color }} />
                        <AutoSelect name="statusId" defaultValue={l.status_id} className="input !w-32 !py-1" ariaLabel={`${l.name} 상태`}>
                          {(statusByCampaign.get(l.campaign_id) ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </AutoSelect>
                      </form>
                    ) : <Badge color={l.status_color}>{l.status_label}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
