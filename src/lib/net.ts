import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

/** 사용자가 입력한 외부 URL 을 서버에서 호출하기 전 검증(SSRF 방지): http(s) + 공인 IP 만 허용. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL 형식이 올바르지 않습니다.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("http(s) 주소만 사용할 수 있습니다.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("내부 네트워크 주소는 사용할 수 없습니다.");
  return u;
}

export async function safeFetch(raw: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const u = await assertPublicUrl(raw);
  return fetch(u, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
