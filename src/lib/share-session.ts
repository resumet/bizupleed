import { cookies } from "next/headers";
import { checkShareSession, getActiveShareLink, ShareLink } from "./campaigns";

export const shareCookieName = (link: ShareLink) => `bl_share_${link.id}`;

/** 공유 링크 + 세션 검증. 광고주 화면의 모든 조회·변경이 이 함수를 거친다. (서버 전용 — 서버 액션으로 노출하지 않는다) */
export async function shareAccess(token: string): Promise<{ link: ShareLink | null; authed: boolean }> {
  const link = await getActiveShareLink(token) ?? null;
  if (!link) return { link: null, authed: false };
  return { link, authed: await checkShareSession(link, (await cookies()).get(shareCookieName(link))?.value) };
}
