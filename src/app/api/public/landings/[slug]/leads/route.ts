import { after } from "next/server";
import { submitLead, SubmitError, SubmitPayload } from "@/lib/leads";
import { tick } from "@/lib/messaging";
import { ipOf } from "@/lib/session";

export const maxDuration = 30;

/** 공개 폼 접수. 서버 검증 필수 · idempotency_key 기준 1회 저장. */
export async function POST(req: Request, ctx: RouteContext<"/api/public/landings/[slug]/leads">) {
  const { slug } = await ctx.params;
  const body = (await req.json().catch(() => null)) as SubmitPayload | null;
  if (!body || typeof body !== "object") return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  try {
    const r = await submitLead(slug, body, { ip: ipOf(req), ua: req.headers.get("user-agent") ?? "" });
    // 알림은 응답을 보낸 뒤 처리한다. after() 는 서버리스에서도 함수가 끝나기 전까지 실행을 보장한다.
    if (!r.replay) after(() => tick().catch((e) => console.error("[tick]", e)));
    return Response.json({ ok: true, lead_id: r.leadId, replay: r.replay, message: r.message });
  } catch (e) {
    if (e instanceof SubmitError) return Response.json({ error: e.message, field: e.field ?? null }, { status: e.status });
    throw e;
  }
}
