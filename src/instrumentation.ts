/**
 * 서버 시작 시 예약 메시지 처리 타이머를 등록한다(상시 실행 서버 전용).
 * Vercel 같은 서버리스에서는 요청 사이에 프로세스가 멈추므로 타이머를 쓰지 않고 /api/cron/tick 을 스케줄러로 호출한다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;
  const g = globalThis as unknown as { __bizupTimer?: NodeJS.Timeout };
  if (g.__bizupTimer) return;
  const { tick } = await import("./lib/messaging");
  g.__bizupTimer = setInterval(() => void tick().catch((e) => console.error("[tick]", e)), 30_000);
  g.__bizupTimer.unref?.();
}
