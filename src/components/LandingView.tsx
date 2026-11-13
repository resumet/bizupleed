"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormField, LandingContent, LandingMode, Section } from "@/lib/landing";

export type SubmitResult = { ok: boolean; message: string; field?: string | null };
export type ViewHandlers = {
  /** 미리보기 모드: 추적·제출을 하지 않고 섹션 선택만 한다 */
  preview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  track?: (name: string, sectionId?: string) => void;
  submit?: (values: Record<string, string | string[]>, consent: boolean, marketing: boolean, hp: string) => Promise<SubmitResult>;
};

/** 외부 입력 URL 은 http(s) 또는 업로드 경로만 허용한다(javascript: 등 차단). */
export const safeUrl = (u: unknown): string => {
  const s = String(u ?? "").trim();
  return /^https?:\/\//i.test(s) || /^\/uploads\/[\w.-]+$/.test(s) ? s : "";
};

const FORM_ANCHOR = "lead-form";

export function LandingView({ content, mode, ...h }: { content: LandingContent; mode: LandingMode } & ViewHandlers) {
  const { settings: st } = content;
  const rootRef = useRef<HTMLDivElement>(null);
  const theme = /^#[0-9a-fA-F]{6}$/.test(st.themeColor) ? st.themeColor : "#2563eb";

  // 등장 효과 + 섹션 도달 추적
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = [...root.querySelectorAll<HTMLElement>("[data-sec]")];
    if (h.preview || typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("lv-in"));
      return;
    }
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("lv-in");
          const id = (e.target as HTMLElement).dataset.sec!;
          if (!seen.has(id)) { seen.add(id); h.track?.("section_view", id); }
        }
      },
      { threshold: 0.25 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.sections.length, h.preview]);

  const goForm = () => {
    h.track?.("cta_click");
    rootRef.current?.querySelector(`#${FORM_ANCHOR}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const chat = content.sections.find((s) => s.type === "chat");
  const flow = content.sections.filter((s) => s.type !== "chat");
  const cardMode = mode === "card";
  const sns = Object.entries(st.sns).filter(([, v]) => safeUrl(v));

  return (
    <div ref={rootRef} className={`relative mx-auto min-h-full w-full max-w-[480px] ${cardMode ? "bg-gray-100" : "bg-white"}`} style={{ ["--theme" as string]: theme }}>
      {mode === "blog" && <BlogHeader content={content} />}
      <div className={cardMode ? "space-y-3 p-3" : mode === "blog" ? "px-1" : ""}>
        {flow.map((s) => (
          <div
            key={s.id}
            data-sec={s.id}
            onClick={h.preview ? () => h.onSelect?.(s.id) : undefined}
            className={`lv-anim lv-anim-${s.anim || "none"} ${cardMode && s.type !== "notice" ? "overflow-hidden rounded-2xl bg-white shadow-sm" : ""} ${
              h.preview ? `cursor-pointer outline-2 -outline-offset-2 ${h.selectedId === s.id ? "outline outline-blue-500" : "hover:outline hover:outline-blue-200"}` : ""
            }`}
          >
            <SectionBody s={s} content={content} goForm={goForm} h={h} />
          </div>
        ))}
      </div>
      {mode === "blog" && <BlogFooter content={content} />}
      {sns.length > 0 && (
        <div className="flex justify-center gap-2 px-4 py-6">
          {sns.map(([k, v]) => (
            <a key={k} href={safeUrl(v)} target="_blank" rel="noopener noreferrer" className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700">
              {{ kakao: "카카오톡", instagram: "인스타그램", youtube: "유튜브", blog: "블로그" }[k] ?? k}
            </a>
          ))}
        </div>
      )}
      <div className="h-20" />

      {/* 하단 고정 영역: 스크롤 추종 미디어 · 채팅 버튼 · 고정 신청 바 */}
      <div className="pointer-events-none sticky bottom-0 z-20 flex flex-col items-end">
        {st.floating.enabled && safeUrl(st.floating.src) && (
          <div className="pointer-events-auto mb-2 mr-3 w-24 overflow-hidden rounded-xl shadow-lg ring-1 ring-black/10">
            {st.floating.kind === "video" ? (
              <video src={safeUrl(st.floating.src)} muted autoPlay loop playsInline className="block w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={safeUrl(st.floating.src)} alt="" className="block w-full" />
            )}
          </div>
        )}
        {chat && (
          <a
            href={safeUrl(chat.props.url) || undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { if (h.preview) { e.preventDefault(); h.onSelect?.(chat.id); } }}
            className={`pointer-events-auto mb-2 mr-3 rounded-full bg-yellow-300 px-4 py-2.5 text-sm font-bold text-gray-900 shadow-lg ${h.selectedId === chat.id ? "ring-2 ring-blue-500" : ""}`}
          >
            💬 {chat.props.label || "채팅 문의"}
          </a>
        )}
        {st.stickyBar.enabled && (
          <div className="pointer-events-auto flex w-full items-center gap-3 border-t border-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{st.stickyBar.text}</p>
            <button type="button" onClick={goForm} className="shrink-0 rounded-full px-5 py-2.5 text-sm font-bold text-white" style={{ background: theme }}>
              {st.stickyBar.button || "신청하기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionBody({ s, content, goForm, h }: { s: Section; content: LandingContent; goForm: () => void; h: ViewHandlers }) {
  const p = s.props;
  switch (s.type) {
    case "notice":
      return <div className="px-4 py-2.5 text-center text-sm font-semibold" style={{ background: p.bg, color: p.color }}>{p.text}</div>;
    case "text":
      return (
        <div className="px-5 py-7" style={{ textAlign: p.align === "center" ? "center" : "left" }}>
          {p.title && <h2 className="mb-3 text-2xl font-extrabold leading-snug tracking-tight text-gray-900">{p.title}</h2>}
          {p.body && <p className="whitespace-pre-wrap text-[15px] leading-7 text-gray-700">{p.body}</p>}
        </div>
      );
    case "image":
      return safeUrl(p.src) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={safeUrl(p.src)} alt={p.alt || ""} className="block w-full" loading="lazy" />
      ) : (
        <Placeholder text="이미지를 등록하세요" />
      );
    case "gallery": {
      const imgs = ((p.images as string[]) ?? []).map(safeUrl).filter(Boolean);
      if (!imgs.length) return <Placeholder text="사진을 추가하세요" />;
      return p.layout === "grid" ? (
        <div className="grid grid-cols-2 gap-1 p-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {imgs.map((src, i) => <img key={i} src={src} alt="" className="aspect-square w-full object-cover" loading="lazy" />)}
        </div>
      ) : (
        <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {imgs.map((src, i) => <img key={i} src={src} alt="" className="w-[84%] shrink-0 snap-center rounded-xl object-cover" loading="lazy" />)}
        </div>
      );
    }
    case "countdown":
      return <Countdown title={p.title} deadline={p.deadline} endText={p.endText} />;
    case "cta":
      return (
        <div className="px-5 py-6 text-center">
          <button type="button" onClick={h.preview ? undefined : goForm} className="w-full rounded-2xl px-5 py-4 text-lg font-extrabold text-white shadow-md" style={{ background: "var(--theme)" }}>
            {p.text}
          </button>
          {p.sub && <p className="mt-2 text-xs text-gray-500">{p.sub}</p>}
        </div>
      );
    case "reviews":
      return (
        <div className="px-5 py-7">
          {p.title && <h2 className="mb-4 text-xl font-extrabold text-gray-900">{p.title}</h2>}
          <div className="space-y-3">
            {((p.items as { name: string; text: string; rating: number }[]) ?? []).map((r, i) => (
              <div key={i} className="rounded-xl bg-gray-50 p-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-800">{r.name}</span>
                  <span className="text-sm text-amber-500" aria-label={`별점 ${r.rating}점`}>{"★".repeat(Math.max(1, Math.min(5, Number(r.rating) || 5)))}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      );
    case "form":
      return (
        <div id={FORM_ANCHOR} className="scroll-mt-4 px-5 py-8" style={{ background: "color-mix(in srgb, var(--theme) 7%, white)" }}>
          {p.title && <h2 className="text-center text-2xl font-extrabold text-gray-900">{p.title}</h2>}
          {p.subtitle && <p className="mb-5 mt-2 text-center text-sm text-gray-600">{p.subtitle}</p>}
          <LeadForm content={content} h={h} />
        </div>
      );
    default:
      return null;
  }
}

const Placeholder = ({ text }: { text: string }) => (
  <div className="m-3 flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-sm text-gray-400">{text}</div>
);

function Countdown({ title, deadline, endText }: { title: string; deadline: string; endText: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버·클라이언트 시각 차이로 인한 hydration 불일치를 피하려고 마운트 후에 설정
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = now === null ? null : new Date(deadline).getTime() - now;
  const parts = left !== null && left > 0 ? [Math.floor(left / 86400000), Math.floor(left / 3600000) % 24, Math.floor(left / 60000) % 60, Math.floor(left / 1000) % 60] : null;
  return (
    <div className="bg-gray-900 px-5 py-6 text-center text-white">
      <p className="mb-3 text-sm font-semibold text-gray-300">{title}</p>
      {left !== null && left <= 0 ? (
        <p className="text-lg font-bold">{endText}</p>
      ) : (
        <div className="flex justify-center gap-2" role="timer">
          {["일", "시간", "분", "초"].map((u, i) => (
            <div key={u} className="w-16 rounded-lg bg-white/10 py-2">
              <div className="text-2xl font-extrabold tabular-nums">{parts ? String(parts[i]).padStart(2, "0") : "--"}</div>
              <div className="text-[11px] text-gray-400">{u}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadForm({ content, h }: { content: LandingContent; h: ViewHandlers }) {
  const { form, settings } = content;
  const uid = useId();
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [hp, setHp] = useState("");
  const [openConsent, setOpenConsent] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<{ message: string; field?: string | null } | null>(null);
  const started = useRef(false);

  const touch = () => {
    if (!started.current) { started.current = true; h.track?.("form_start"); }
  };
  const set = (k: string, v: string | string[]) => { touch(); setValues((p) => ({ ...p, [k]: v })); };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (h.preview || !h.submit || state === "sending") return;
    if (!consent) return setError({ message: "개인정보 수집·이용에 동의해 주세요.", field: "consent" });
    setState("sending");
    setError(null);
    try {
      const r = await h.submit(values, consent, marketing, hp);
      if (r.ok) setState("done");
      else { setError({ message: r.message, field: r.field }); setState("idle"); }
    } catch {
      setError({ message: "전송에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요." });
      setState("idle");
    }
  }

  if (state === "done")
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm" role="status">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl text-green-600">✓</div>
        <p className="whitespace-pre-wrap text-base font-bold text-gray-900">{settings.successMessage}</p>
      </div>
    );

  const inputCls = "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-[15px] outline-none focus:border-[var(--theme)]";
  return (
    <form onSubmit={onSubmit} className="space-y-3.5" noValidate={h.preview}>
      {form.fields.map((f) => (
        <FieldInput key={f.id} f={f} id={`${uid}-${f.id}`} value={values[f.key]} set={(v) => set(f.key, v)} cls={inputCls} invalid={error?.field === f.key} />
      ))}
      {/* 허니팟: 사람에게는 보이지 않는다 */}
      <input type="text" name="website" value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      <div className="rounded-xl bg-white p-3 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={consent} onChange={(e) => { touch(); setConsent(e.target.checked); }} className="mt-0.5 h-4 w-4" aria-invalid={error?.field === "consent"} />
          <span className="flex-1 font-semibold text-gray-800">(필수) 개인정보 수집·이용에 동의합니다.</span>
          <button type="button" onClick={() => setOpenConsent((v) => !v)} className="shrink-0 text-xs text-gray-500 underline" aria-expanded={openConsent}>
            {openConsent ? "접기" : "전문 보기"}
          </button>
        </label>
        {openConsent && <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 text-xs leading-5 text-gray-600">{form.consentText}</p>}
        {form.marketingEnabled && (
          <label className="mt-2 flex items-start gap-2">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span className="text-gray-700">{form.marketingText}</span>
          </label>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{error.message}</p>}
      <button type="submit" disabled={state === "sending"} className="w-full rounded-2xl px-5 py-4 text-lg font-extrabold text-white shadow-md disabled:opacity-60" style={{ background: "var(--theme)" }}>
        {state === "sending" ? "전송 중…" : form.submitText}
      </button>
    </form>
  );
}

function FieldInput({ f, id, value, set, cls, invalid }: { f: FormField; id: string; value: string | string[] | undefined; set: (v: string | string[]) => void; cls: string; invalid: boolean }) {
  const v = typeof value === "string" ? value : "";
  const common = { id, required: f.required, "aria-invalid": invalid, className: `${cls} ${invalid ? "border-red-500" : ""}`, placeholder: f.placeholder };
  const options = (f.options ?? []).filter(Boolean);
  let control: React.ReactNode;
  if (f.type === "textarea") control = <textarea {...common} rows={3} value={v} onChange={(e) => set(e.target.value)} maxLength={2000} />;
  else if (f.type === "select")
    control = (
      <select {...common} value={v} onChange={(e) => set(e.target.value)}>
        <option value="">선택해 주세요</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  else if (f.type === "radio" || f.type === "checkbox") {
    const arr = Array.isArray(value) ? value : [];
    control = (
      <div className="flex flex-wrap gap-2" role={f.type === "radio" ? "radiogroup" : "group"} aria-labelledby={`${id}-l`}>
        {options.map((o) => {
          const on = f.type === "radio" ? v === o : arr.includes(o);
          return (
            <label key={o} className={`cursor-pointer rounded-full border px-3.5 py-2 text-sm font-semibold ${on ? "border-[var(--theme)] bg-[var(--theme)] text-white" : "border-gray-300 bg-white text-gray-700"}`}>
              <input type={f.type} name={id} className="sr-only" checked={on} onChange={() => set(f.type === "radio" ? o : on ? arr.filter((x) => x !== o) : [...arr, o])} />
              {o}
            </label>
          );
        })}
      </div>
    );
  } else
    control = (
      <input
        {...common}
        type={f.type === "phone" ? "tel" : f.type === "email" ? "email" : f.type === "date" ? "date" : "text"}
        inputMode={f.type === "phone" ? "numeric" : undefined}
        autoComplete={f.type === "phone" ? "tel" : f.type === "email" ? "email" : f.key === "name" ? "name" : "off"}
        value={v}
        maxLength={200}
        onChange={(e) => set(e.target.value)}
      />
    );
  return (
    <div>
      <label id={`${id}-l`} htmlFor={f.type === "radio" || f.type === "checkbox" ? undefined : id} className="mb-1.5 block text-sm font-bold text-gray-800">
        {f.label} {f.required && <span className="text-red-500" aria-label="필수">*</span>}
      </label>
      {control}
    </div>
  );
}

// ── 블로그 스킨(베이직·네이버형·티스토리형·브런치형) ──────────────
const SKIN: Record<string, { bar: string; barText: string; title: string; accent: string }> = {
  basic: { bar: "bg-white border-b border-gray-200", barText: "text-gray-900", title: "text-2xl font-extrabold", accent: "#111827" },
  naver: { bar: "bg-white border-b border-gray-200", barText: "text-[#03c75a]", title: "text-[22px] font-bold", accent: "#03c75a" },
  tistory: { bar: "bg-[#1a1a1a]", barText: "text-[#ff5544]", title: "text-2xl font-extrabold", accent: "#ff5544" },
  brunch: { bar: "bg-white", barText: "text-gray-900 font-serif italic", title: "text-[26px] font-light font-serif text-center", accent: "#00c6be" },
};

function BlogHeader({ content }: { content: LandingContent }) {
  const b = content.settings.blog;
  const sk = SKIN[b.skin] ?? SKIN.basic;
  return (
    <header>
      <div className={`flex items-center justify-between px-4 py-3 ${sk.bar}`}>
        <span className={`text-base font-extrabold ${sk.barText}`}>{{ naver: "blog", tistory: "TISTORY", brunch: "brunch story", basic: "BLOG" }[b.skin] ?? "BLOG"}</span>
        {/* 블로그 형식이라도 광고임을 방문자가 알 수 있게 항상 표시한다 */}
        <span className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">광고</span>
      </div>
      <div className={`px-5 pb-4 pt-7 ${b.skin === "brunch" ? "text-center" : ""}`}>
        {b.skin === "naver" && <p className="mb-2 text-xs font-semibold" style={{ color: sk.accent }}>일상·생각</p>}
        <h1 className={`${sk.title} leading-snug text-gray-900`}>{content.settings.title}</h1>
        <div className={`mt-4 flex items-center gap-2 text-xs text-gray-500 ${b.skin === "brunch" ? "justify-center" : ""}`}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: sk.accent }}>{b.author.slice(0, 1)}</span>
          <span className="font-semibold text-gray-700">{b.author}</span>
          <span>·</span>
          <span>{b.date}</span>
        </div>
      </div>
      <hr className="mx-5 border-gray-200" />
    </header>
  );
}

function BlogFooter({ content }: { content: LandingContent }) {
  const b = content.settings.blog;
  const sk = SKIN[b.skin] ?? SKIN.basic;
  const [liked, setLiked] = useState(false);
  return (
    <footer className="px-5 py-6">
      <div className="flex items-center gap-4 border-y border-gray-200 py-3 text-sm text-gray-600">
        <button type="button" onClick={() => setLiked((v) => !v)} aria-pressed={liked} className="flex items-center gap-1.5 font-semibold" style={{ color: liked ? sk.accent : undefined }}>
          {liked ? "♥" : "♡"} 공감 {b.likes + (liked ? 1 : 0)}
        </button>
        <span>💬 댓글 {b.comments.length}</span>
      </div>
      <ul className="mt-2 divide-y divide-gray-100">
        {b.comments.map((c, i) => (
          <li key={i} className="py-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-gray-800">{c.name}</span>
              <span className="text-gray-400">{c.date}</span>
            </div>
            <p className="mt-1 text-sm leading-6 text-gray-700">{c.text}</p>
          </li>
        ))}
      </ul>
    </footer>
  );
}
