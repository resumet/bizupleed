import { ingestEvents } from "@/lib/tracking";
import { ipOf } from "@/lib/session";

/** 방문·스크롤·CTA 이벤트 접수(sendBeacon 은 text/plain 으로 보내므로 본문을 직접 파싱한다). */
export async function POST(req: Request) {
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse((await req.text()).slice(0, 20_000));
  } catch {
    /* ignore */
  }
  if (!body || typeof body.slug !== "string") return new Response(null, { status: 204 });
  await ingestEvents(body.slug, body, { ip: ipOf(req), ua: req.headers.get("user-agent") ?? "" });
  return new Response(null, { status: 204 });
}
