"use client";

import { useCallback, useEffect, useRef } from "react";
import type { LandingContent, LandingMode } from "@/lib/landing";
import { LandingView, SubmitResult } from "./LandingView";

type W = Window & { fbq?: (...a: unknown[]) => void; gtag?: (...a: unknown[]) => void; karrotPixel?: { track: (e: string) => void } };

const rid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

function stored(store: "localStorage" | "sessionStorage", key: string, make: () => string): string {
  try {
    const s = window[store];
    let v = s.getItem(key);
    if (!v) { v = make(); s.setItem(key, v); }
    return v;
  } catch {
    return make(); // 저장소 차단 환경
  }
}

/** 공개 랜딩: 방문·스크롤·CTA·폼 이벤트 수집, 광고 픽셀 이벤트 전달, 폼 제출. */
export function PublicLanding({ slug, content, mode }: { slug: string; content: LandingContent; mode: LandingMode }) {
  const ids = useRef<{ visitor: string; session: string; utm: Record<string, string>; referrer: string } | null>(null);
  const queue = useRef<{ name: string; section_id?: string; value?: number }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idem = useRef("");
  const once = useRef(new Set<string>());

  const flush = useCallback((beacon = false) => {
    if (!ids.current || !queue.current.length) return;
    const body = JSON.stringify({ slug, visitor_id: ids.current.visitor, session_id: ids.current.session, utm: ids.current.utm, referrer: ids.current.referrer, events: queue.current.splice(0) });
    if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/tracking/events", body);
    else void fetch("/api/tracking/events", { method: "POST", body, keepalive: true }).catch(() => {});
  }, [slug]);

  const track = useCallback((name: string, sectionId?: string, value?: number) => {
    const key = `${name}:${sectionId ?? ""}`;
    if (name !== "dwell") {
      if (once.current.has(key)) return; // 세션당 1회
      once.current.add(key);
    }
    queue.current.push({ name, section_id: sectionId, value });
    const w = window as W;
    if (name === "scroll_50") { w.fbq?.("track", "ViewContent"); w.gtag?.("event", "view_item"); w.karrotPixel?.track("ViewContent"); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 800);
  }, [flush]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const utm: Record<string, string> = JSON.parse(stored("sessionStorage", "bl_utm", () => {
      const u: Record<string, string> = {};
      for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) if (params.get(k)) u[k] = params.get(k)!;
      return JSON.stringify(u);
    }));
    ids.current = { visitor: stored("localStorage", "bl_vid", rid), session: stored("sessionStorage", "bl_sid", rid), utm, referrer: stored("sessionStorage", "bl_ref", () => document.referrer || "-").replace(/^-$/, "") };
    idem.current = rid();
    track("page_view");
    const started = Date.now();
    const onScroll = () => {
      const ratio = (window.scrollY + window.innerHeight) / Math.max(1, document.documentElement.scrollHeight);
      if (ratio >= 0.5) track("scroll_50");
      if (ratio >= 0.9) track("scroll_90");
    };
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      track("dwell", undefined, Math.round((Date.now() - started) / 1000));
      flush(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [track, flush]);

  const submit = useCallback(async (values: Record<string, string | string[]>, consent: boolean, marketing: boolean, hp: string): Promise<SubmitResult> => {
    const res = await fetch(`/api/public/landings/${encodeURIComponent(slug)}/leads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fields: values, consent, marketing, hp, idempotency_key: idem.current, // 재시도해도 같은 키 → 1회만 저장
        visitor_id: ids.current?.visitor, session_id: ids.current?.session, utm: ids.current?.utm, referrer: ids.current?.referrer,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; field?: string };
    if (!res.ok || !data.ok) return { ok: false, message: data.error ?? "신청 처리 중 오류가 발생했습니다.", field: data.field };
    idem.current = rid();
    const w = window as W;
    w.fbq?.("track", "Lead");
    w.gtag?.("event", "generate_lead");
    w.karrotPixel?.track("Lead");
    return { ok: true, message: data.message ?? "" };
  }, [slug]);

  return <LandingView content={content} mode={mode} track={track} submit={submit} />;
}
