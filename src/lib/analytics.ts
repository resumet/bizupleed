import { one, Param, q } from "./db";
import type { Scope } from "./leads";

export type AFilter = { scope: Scope; campaignId?: string; landingId?: string; source?: string; from: string; to: string };

export const FUNNEL_STEPS: [string, string][] = [
  ["page_view", "방문"], ["scroll_50", "절반 읽음"], ["cta_click", "버튼 클릭"], ["form_start", "입력 시작"], ["lead_submit_success", "신청 완료"],
];

function evWhere(f: AFilter): { sql: string; params: Param[] } {
  const cond = ["e.workspace_id=?", "e.event_at>=?", "e.event_at<?"];
  const params: Param[] = [f.scope.workspaceId, f.from, f.to];
  if (f.scope.clientIds) {
    if (!f.scope.clientIds.length) cond.push("1=0");
    else {
      cond.push(`e.campaign_id IN (SELECT id FROM campaigns WHERE client_id IN (${f.scope.clientIds.map(() => "?").join(",")}))`);
      params.push(...f.scope.clientIds);
    }
  }
  if (f.campaignId) { cond.push("e.campaign_id=?"); params.push(f.campaignId); }
  if (f.landingId) { cond.push("e.landing_id=?"); params.push(f.landingId); }
  if (f.source) { cond.push("e.source=?"); params.push(f.source); }
  return { sql: cond.join(" AND "), params };
}

function leadWhere(f: AFilter): { sql: string; params: Param[] } {
  const cond = ["l.workspace_id=?", "l.submitted_at>=?", "l.submitted_at<?"];
  const params: Param[] = [f.scope.workspaceId, f.from, f.to];
  if (f.scope.clientIds) {
    if (!f.scope.clientIds.length) cond.push("1=0");
    else { cond.push(`l.client_id IN (${f.scope.clientIds.map(() => "?").join(",")})`); params.push(...f.scope.clientIds); }
  }
  if (f.campaignId) { cond.push("l.campaign_id=?"); params.push(f.campaignId); }
  if (f.landingId) { cond.push("l.landing_id=?"); params.push(f.landingId); }
  if (f.source) { cond.push("l.source=?"); params.push(f.source); }
  return { sql: cond.join(" AND "), params };
}

export type Overview = {
  visitors: number; pageviews: number; sessions: number; leads: number; uniqueContacts: number; convertedSessions: number;
  conversion: number | null; pending: number; overdue: number; unknownSourceLeads: number;
};

/**
 * 지표 정의
 * - 방문자: page_view 가 있는 고유 visitor_id 수 / 페이지뷰: page_view 이벤트 수
 * - 리드: 정상 접수 레코드 수(허수 표기 제외) / 고유 연락처: 전화번호 해시 기준
 * - 전환율: 신청 완료 고유 세션 ÷ 방문 고유 세션
 */
export async function overview(f: AFilter): Promise<Overview> {
  const e = evWhere(f);
  const ev = (await one<{ visitors: number; pageviews: number; sessions: number; converted: number }>(
    `SELECT COUNT(DISTINCT CASE WHEN event_name='page_view' THEN visitor_id END) AS visitors,
            SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) AS pageviews,
            COUNT(DISTINCT CASE WHEN event_name='page_view' THEN session_id END) AS sessions,
            COUNT(DISTINCT CASE WHEN event_name='lead_submit_success' THEN session_id END) AS converted
       FROM tracking_events e WHERE ${e.sql}`, ...e.params))!;
  const l = leadWhere(f);
  const ld = (await one<{ leads: number; uniq: number; pending: number; overdue: number; unknown: number }>(
    `SELECT SUM(CASE WHEN l.is_invalid=0 THEN 1 ELSE 0 END) AS leads,
            COUNT(DISTINCT CASE WHEN l.is_invalid=0 THEN COALESCE(l.phone_hash, l.id) END) AS uniq,
            SUM(CASE WHEN s.key='new' AND l.is_invalid=0 THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN s.key='new' AND l.is_invalid=0 AND l.submitted_at<? THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN l.is_invalid=0 AND (l.source IS NULL OR l.source IN ('unknown','direct')) THEN 1 ELSE 0 END) AS unknown
       FROM leads l JOIN lead_statuses s ON s.id=l.status_id WHERE ${l.sql}`,
    new Date(Date.now() - 24 * 3600_000).toISOString(), ...l.params))!;
  return {
    visitors: ev.visitors ?? 0, pageviews: ev.pageviews ?? 0, sessions: ev.sessions ?? 0, leads: ld.leads ?? 0, uniqueContacts: ld.uniq ?? 0,
    convertedSessions: ev.converted ?? 0, conversion: ev.sessions ? (ev.converted ?? 0) / ev.sessions : null,
    pending: ld.pending ?? 0, overdue: ld.overdue ?? 0, unknownSourceLeads: ld.unknown ?? 0,
  };
}

/** 날짜별(KST) 방문자·신청 추이. 데이터가 없는 날도 0 으로 채운다. */
export async function trend(f: AFilter): Promise<{ day: string; visitors: number; leads: number }[]> {
  const e = evWhere(f);
  const v = await q<{ day: string; n: number }>(
    `SELECT to_char(e.event_at::timestamptz AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS day, COUNT(DISTINCT visitor_id) AS n FROM tracking_events e WHERE ${e.sql} AND event_name='page_view' GROUP BY day`, ...e.params);
  const l = leadWhere(f);
  const ld = await q<{ day: string; n: number }>(
    `SELECT to_char(l.submitted_at::timestamptz AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS day, COUNT(*) AS n FROM leads l WHERE ${l.sql} AND l.is_invalid=0 GROUP BY day`, ...l.params);
  const vm = new Map(v.map((r) => [r.day, r.n]));
  const lm = new Map(ld.map((r) => [r.day, r.n]));
  const out: { day: string; visitors: number; leads: number }[] = [];
  const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000);
  const end = kst(new Date(new Date(f.to).getTime() - 1).toISOString());
  for (const d = kst(f.from); d <= end && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    out.push({ day, visitors: vm.get(day) ?? 0, leads: lm.get(day) ?? 0 });
  }
  return out;
}

/** 5단계 퍼널: 단계별 이벤트가 발생한 고유 세션 수(세션 내 순서는 강제하지 않음). */
export async function funnel(f: AFilter): Promise<{ key: string; label: string; count: number }[]> {
  const e = evWhere(f);
  const rows = await q<{ event_name: string; n: number }>(
    `SELECT event_name, COUNT(DISTINCT session_id) AS n FROM tracking_events e WHERE ${e.sql} GROUP BY event_name`, ...e.params);
  const m = new Map(rows.map((r) => [r.event_name, r.n]));
  return FUNNEL_STEPS.map(([key, label]) => ({ key, label, count: m.get(key) ?? 0 }));
}

export async function channels(f: AFilter): Promise<{ source: string; medium: string; sessions: number; leads: number }[]> {
  const e = evWhere(f);
  return await q(
    `SELECT COALESCE(source,'unknown') AS source, COALESCE(medium,'unknown') AS medium,
            COUNT(DISTINCT CASE WHEN event_name='page_view' THEN session_id END) AS sessions,
            COUNT(DISTINCT CASE WHEN event_name='lead_submit_success' THEN session_id END) AS leads
       FROM tracking_events e WHERE ${e.sql} GROUP BY 1,2 ORDER BY sessions DESC LIMIT 30`, ...e.params);
}

export async function devices(f: AFilter): Promise<{ device: string; sessions: number }[]> {
  const e = evWhere(f);
  return await q(`SELECT COALESCE(device,'unknown') AS device, COUNT(DISTINCT session_id) AS sessions FROM tracking_events e WHERE ${e.sql} AND event_name='page_view' GROUP BY 1 ORDER BY 2 DESC`, ...e.params);
}

/** 체류시간(초): 세션별 최대 dwell 값의 평균·중앙값. */
export async function dwell(f: AFilter): Promise<{ avg: number | null; median: number | null; samples: number }> {
  const e = evWhere(f);
  const vals = (await q<{ v: number }>(`SELECT MAX(value) AS v FROM tracking_events e WHERE ${e.sql} AND event_name='dwell' GROUP BY session_id ORDER BY v`, ...e.params)).map((r) => r.v);
  if (!vals.length) return { avg: null, median: null, samples: 0 };
  const mid = Math.floor(vals.length / 2);
  return {
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    median: vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2,
    samples: vals.length,
  };
}

/** 섹션별 도달 세션 수(landingId 필수). */
export async function sectionReach(f: AFilter): Promise<{ sessions: number; reach: Map<string, number> }> {
  const e = evWhere(f);
  const total = (await one<{ n: number }>(`SELECT COUNT(DISTINCT session_id) AS n FROM tracking_events e WHERE ${e.sql} AND event_name='page_view'`, ...e.params))!.n;
  const rows = await q<{ section_id: string; n: number }>(
    `SELECT section_id, COUNT(DISTINCT session_id) AS n FROM tracking_events e WHERE ${e.sql} AND event_name='section_view' AND section_id IS NOT NULL GROUP BY section_id`, ...e.params);
  return { sessions: total, reach: new Map(rows.map((r) => [r.section_id, r.n])) };
}

/** 구간 비율 지표(개선 전후 비교용): 완독률(scroll_90)·CTA 클릭률. */
export async function rates(f: AFilter): Promise<{ sessions: number; readRate: number | null; ctaRate: number | null; submitRate: number | null }> {
  const m = new Map((await funnel(f)).map((s) => [s.key, s.count]));
  const e = evWhere(f);
  const read = (await one<{ n: number }>(`SELECT COUNT(DISTINCT session_id) AS n FROM tracking_events e WHERE ${e.sql} AND event_name='scroll_90'`, ...e.params))!.n;
  const s = m.get("page_view") ?? 0;
  return {
    sessions: s, readRate: s ? read / s : null, ctaRate: s ? (m.get("cta_click") ?? 0) / s : null,
    submitRate: s ? (m.get("lead_submit_success") ?? 0) / s : null,
  };
}

export async function sourcesList(f: AFilter): Promise<string[]> {
  const e = evWhere({ ...f, source: undefined });
  return (await q<{ source: string }>(`SELECT DISTINCT COALESCE(source,'unknown') AS source FROM tracking_events e WHERE ${e.sql} ORDER BY 1 LIMIT 50`, ...e.params)).map((r) => r.source);
}

/** 기간 파라미터 해석(KST 기준 날짜 → UTC ISO 구간). 기본 최근 14일. */
export function parseRange(fromDay?: string, toDay?: string): { from: string; to: string; fromDay: string; toDay: string } {
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const td = toDay && dayRe.test(toDay) ? toDay : todayKst;
  const defFrom = new Date(new Date(`${td}T00:00:00Z`).getTime() - 13 * 86400_000).toISOString().slice(0, 10);
  const fd = fromDay && dayRe.test(fromDay) && fromDay <= td ? fromDay : defFrom;
  const from = new Date(new Date(`${fd}T00:00:00Z`).getTime() - 9 * 3600_000).toISOString();
  const to = new Date(new Date(`${td}T00:00:00Z`).getTime() + 15 * 3600_000).toISOString();
  return { from, to, fromDay: fd, toDay: td };
}
