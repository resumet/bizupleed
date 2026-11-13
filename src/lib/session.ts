import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Ctx, ctxFromToken } from "./accounts";

export const SESSION_COOKIE = "bl_session";

export const getCtx = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies();
  return ctxFromToken(jar.get(SESSION_COOKIE)?.value);
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 14 * 86400 });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}

export function ipOf(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** 쿠키 인증 POST 요청의 출처 검증(CSRF 방지). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // 비브라우저 클라이언트
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export const KST = (iso: string | null | undefined, withTime = true) =>
  iso
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul", year: "2-digit", month: "2-digit", day: "2-digit",
        ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
      }).format(new Date(iso))
    : "-";
