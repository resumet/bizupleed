import { cookies } from "next/headers";
import { checkShareSession, getActiveShareLink } from "@/lib/campaigns";
import { audit } from "@/lib/db";
import { leadsToXlsx, xlsxResponse } from "@/lib/export";
import { listLeads } from "@/lib/leads";

/** 광고주 화면 엑셀 내려받기: 링크 유효성·세션·허용 여부를 모두 확인하고 감사 기록을 남긴다. */
export async function GET(_req: Request, ctx: RouteContext<"/api/share/[token]/export">) {
  const { token } = await ctx.params;
  const link = await getActiveShareLink(token);
  if (!link || !await checkShareSession(link, (await cookies()).get(`bl_share_${link.id}`)?.value)) return new Response("접근 권한이 없습니다.", { status: 401 });
  if (!link.allow_export) return new Response("내려받기가 허용되지 않은 공유입니다.", { status: 403 });
  const leads = await listLeads({ workspaceId: link.workspace_id, clientIds: [link.client_id] }, { limit: 5000 });
  await audit(link.workspace_id, { id: link.id, name: "광고주(공유 링크)" }, "share.export", "share_link", link.id, { count: leads.length });
  return xlsxResponse(await leadsToXlsx(leads, { maskPhone: !!link.mask_phone }), `리드_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
