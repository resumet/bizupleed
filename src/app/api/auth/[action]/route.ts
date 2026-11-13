import { AppError, destroySession, login, signup } from "@/lib/accounts";
import { rateLimit } from "@/lib/db";
import { ipOf, sameOrigin, SESSION_COOKIE } from "@/lib/session";
import { cookies } from "next/headers";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 14 * 86400 };

export async function POST(req: Request, ctx: RouteContext<"/api/auth/[action]">) {
  const { action } = await ctx.params;
  if (!sameOrigin(req)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
  const jar = await cookies();
  try {
    if (action === "logout") {
      const t = jar.get(SESSION_COOKIE)?.value;
      if (t) await destroySession(t);
      jar.delete(SESSION_COOKIE);
      return Response.json({ ok: true });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!await rateLimit(`auth:${ipOf(req)}`, 20, 600)) return Response.json({ error: "시도 횟수가 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    if (action === "signup") {
      await signup({
        name: String(body.name ?? ""), phone: String(body.phone ?? ""), email: String(body.email ?? ""),
        password: String(body.password ?? ""), agree: body.agree === true,
      });
    } else if (action !== "login") return Response.json({ error: "not found" }, { status: 404 });
    const { token } = await login(String(body.email ?? ""), String(body.password ?? ""));
    jar.set(SESSION_COOKIE, token, cookieOpts);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
