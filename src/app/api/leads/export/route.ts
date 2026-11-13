import { can } from "@/lib/accounts";
import { parseRange } from "@/lib/analytics";
import { audit } from "@/lib/db";
import { leadsToXlsx, xlsxResponse } from "@/lib/export";
import { LeadFilter, listLeads, scopeOf } from "@/lib/leads";
import { getCtx } from "@/lib/session";

/** 필터 결과 엑셀 내보내기. 권한 확인 후 감사 기록을 남긴다. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("로그인이 필요합니다.", { status: 401 });
  if (!can(ctx, "lead.export")) return new Response("내보내기 권한이 없습니다.", { status: 403 });
  const p = new URL(req.url).searchParams;
  const filter: LeadFilter = {
    q: p.get("q") ?? "", campaignId: p.get("campaign") || undefined, statusKey: p.get("status") || undefined,
    flag: (p.get("flag") as LeadFilter["flag"]) || "", limit: 5000,
  };
  if (p.get("from") || p.get("to")) Object.assign(filter, (({ from, to }) => ({ from, to }))(parseRange(p.get("from") ?? "2000-01-01", p.get("to") ?? undefined)));
  const leads = await listLeads(scopeOf(ctx), filter);
  await audit(ctx.workspaceId, { id: ctx.userId, name: ctx.userName }, "lead.export", "lead", undefined, { count: leads.length, filter: { ...filter, q: filter.q ? "(검색어)" : "" } });
  return xlsxResponse(await leadsToXlsx(leads), `리드_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
