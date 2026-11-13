import { tick } from "@/lib/messaging";

export const maxDuration = 60;

/** 예약 메시지·재알림 주기 실행. CRON_SECRET 이 설정되어 있으면 Bearer 인증을 요구한다. */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  return Response.json({ processed: await tick() });
}

export const GET = handle;
export const POST = handle;
