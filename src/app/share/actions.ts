"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/accounts";
import { getActiveShareLink, openShareSession } from "@/lib/campaigns";
import { rateLimit } from "@/lib/db";
import { changeLeadStatus } from "@/lib/leads";
import { clientIp } from "@/lib/session";
import { shareAccess, shareCookieName as cookieName } from "@/lib/share-session";

export async function shareLoginAction(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const path = `/share/${encodeURIComponent(token)}`;
  const link = await getActiveShareLink(token);
  if (!link) redirect(path);
  const ip = await clientIp();
  if (!await rateLimit(`share:${link.id}:${ip}`, 10, 600)) redirect(`${path}?error=${encodeURIComponent("시도 횟수가 많습니다. 10분 뒤 다시 시도해 주세요.")}`);
  const session = await openShareSession(link, String(fd.get("password") ?? ""), ip);
  if (!session) redirect(`${path}?error=${encodeURIComponent("비밀번호가 올바르지 않습니다.")}`);
  (await cookies()).set(cookieName(link), session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  redirect(path);
}

export async function shareStatusAction(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const path = `/share/${encodeURIComponent(token)}`;
  const { link, authed } = await shareAccess(token);
  if (!link || !authed) redirect(path);
  let error = "";
  try {
    if (!link.allow_status_change) throw new AppError("읽기 전용 공유입니다.");
    await changeLeadStatus({ workspaceId: link.workspace_id, clientIds: [link.client_id] }, { type: "client", id: link.id, name: "광고주" }, String(fd.get("id") ?? ""), String(fd.get("statusId") ?? ""), { clientOnly: true });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}
