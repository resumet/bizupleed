import crypto from "node:crypto";
import { activateSubscription, markPaymentFailed } from "@/lib/accounts";
import { topup } from "@/lib/credits";
import { one } from "@/lib/db";
import { applyDeliveryReport } from "@/lib/messaging";

/**
 * 외부 공급자 웹훅(결제·메시지 수신 결과). 실제 PG/메시지 업체 연동 시 서명 검증 방식에 맞게 교체한다.
 * WEBHOOK_SECRET 이 없으면 비활성. 같은 payment_id / provider_message_id 재호출은 멱등 처리된다.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/webhooks/[kind]">) {
  const { kind } = await ctx.params;
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "webhook disabled" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-webhook-secret") ?? "");
  if (given.length !== secret.length || !crypto.timingSafeEqual(given, Buffer.from(secret))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (kind === "message-provider") {
    const ok = await applyDeliveryReport(String(b.provider_message_id ?? ""), b.status === "delivered" ? "delivered" : "failed", b.error ? String(b.error) : undefined);
    return Response.json({ ok });
  }
  if (kind === "payment") {
    const ws = String(b.workspace_id ?? "");
    const paymentId = String(b.payment_id ?? "");
    if (!paymentId || !await one("SELECT 1 FROM workspaces WHERE id=?", ws)) return Response.json({ error: "unknown workspace" }, { status: 400 });
    if (b.type === "subscription.paid") await activateSubscription(ws, paymentId);
    else if (b.type === "subscription.failed") await markPaymentFailed(ws);
    else if (b.type === "topup.paid") await topup(ws, `pay:${paymentId}`, Math.max(0, Math.floor(Number(b.amount) || 0)), Math.max(0, Math.floor(Number(b.bonus) || 0)));
    else return Response.json({ error: "unknown type" }, { status: 400 });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "not found" }, { status: 404 });
}
