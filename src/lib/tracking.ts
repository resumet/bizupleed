import { newId, now, rateLimit, run, tx } from "./db";
import { getPublicLanding } from "./landings";

const HOST_MAP: [RegExp, string][] = [
  [/naver\./, "naver"], [/google\./, "google"], [/(facebook|fb)\./, "meta"], [/instagram\./, "meta"],
  [/kakao/, "kakao"], [/(daangn|karrot)/, "daangn"], [/(youtube|youtu\.be)/, "youtube"], [/tiktok/, "tiktok"], [/daum\./, "daum"],
];

/** 유입 출처 판정: UTM 우선 → 리퍼러 도메인 → direct. 판정 불가 시 unknown 으로 공개한다. */
export function deriveSource(utm: Record<string, string>, referrer: string): { source: string; medium: string } {
  if (utm.utm_source) return { source: utm.utm_source.toLowerCase(), medium: (utm.utm_medium || "unknown").toLowerCase() };
  if (referrer) {
    try {
      const host = new URL(referrer).hostname.replace(/^www\./, "");
      const hit = HOST_MAP.find(([re]) => re.test(host));
      return { source: hit ? hit[1] : host, medium: "referral" };
    } catch {
      return { source: "unknown", medium: "unknown" };
    }
  }
  return { source: "direct", medium: "none" };
}

export function deviceOf(ua: string): string {
  const u = ua.toLowerCase();
  if (/ipad|tablet/.test(u)) return "tablet";
  if (/mobi|android|iphone/.test(u)) return "mobile";
  return "desktop";
}

export type EventInput = {
  workspaceId: string; campaignId: string; landingId: string; versionId: string | null; visitorId: string; sessionId: string;
  name: string; source: string | null; medium: string | null; utmCampaign: string | null; device: string | null;
  sectionId?: string | null; value?: number | null; leadId?: string | null;
};

// 분석 이벤트에는 성명·전화번호·이메일 원문을 넣지 않는다(10.2 개인정보 원칙).
export async function recordEvent(e: EventInput) {
  await run(
    "INSERT INTO tracking_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    newId("ev_"), e.workspaceId, e.campaignId, e.landingId, e.versionId, e.visitorId, e.sessionId, e.name, now(),
    e.source, e.medium, e.utmCampaign, e.device, e.sectionId ?? null, e.value ?? null, e.leadId ?? null,
  );
}

const CLIENT_EVENTS = new Set(["page_view", "scroll_50", "scroll_90", "cta_click", "form_start", "section_view", "dwell"]);
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export type ClientEvent = { name: string; section_id?: string; value?: number };

/** 공개 랜딩의 브라우저 이벤트 수집. 반환값은 저장된 이벤트 수. */
export async function ingestEvents(
  slug: string,
  body: { visitor_id?: string; session_id?: string; utm?: Record<string, string>; referrer?: string; events?: ClientEvent[] },
  meta: { ip: string; ua: string },
): Promise<number> {
  const pub = await getPublicLanding(slug);
  if (!pub) return 0;
  if (!ID_RE.test(body.visitor_id ?? "") || !ID_RE.test(body.session_id ?? "")) return 0;
  if (/bot|crawler|spider|headless|preview/i.test(meta.ua)) return 0; // 봇 트래픽 제외
  if (!await rateLimit(`ev:${meta.ip}`, 600, 600)) return 0;
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign"]) {
    const v = String(body.utm?.[k] ?? "").trim().slice(0, 120);
    if (v) utm[k] = v;
  }
  const { source, medium } = deriveSource(utm, String(body.referrer ?? "").slice(0, 300));
  const device = deviceOf(meta.ua);
  const events = (body.events ?? []).slice(0, 30).filter((e) => CLIENT_EVENTS.has(e?.name));
  await tx(async () => {
    for (const e of events) {
      await recordEvent({
        workspaceId: pub.landing.workspace_id, campaignId: pub.landing.campaign_id, landingId: pub.landing.id, versionId: pub.versionId,
        visitorId: body.visitor_id!, sessionId: body.session_id!, name: e.name, source, medium, utmCampaign: utm.utm_campaign ?? null, device,
        sectionId: e.name === "section_view" && typeof e.section_id === "string" ? e.section_id.slice(0, 32) : null,
        value: e.name === "dwell" && Number.isFinite(e.value) ? Math.max(0, Math.min(3600, Number(e.value))) : null,
      });
    }
  });
  return events.length;
}
