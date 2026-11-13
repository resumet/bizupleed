"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { publishLandingAction, restoreVersionAction, saveLandingAction } from "@/app/app/actions";
import {
  ANIMATIONS, BLOG_SKINS, FIELD_TYPES, FieldType, LandingContent, LandingMode, SECTION_TYPES, Section, SectionType, newSection, rid, validateForPublish,
} from "@/lib/landing";
import { LandingView } from "./LandingView";

type Props = {
  landing: { id: string; slug: string; status: string; mode: LandingMode; campaignTitle: string; hasPublished: boolean };
  initial: LandingContent;
  versions: { id: string; note: string | null; author_name: string | null; published_at: string }[];
  serving: boolean;
};

export async function uploadImage(file: File | Blob, name = "image.png"): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, name);
  const res = await fetch("/api/uploads", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "업로드 실패");
  return data.url as string;
}

const L = ({ children }: { children: React.ReactNode }) => <span className="label">{children}</span>;

function Text({ label, value, onChange, area, placeholder }: { label: string; value: string; onChange: (v: string) => void; area?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <L>{label}</L>
      {area ? <textarea className="input" rows={4} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <input className="input" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function ImageField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div>
      <L>{label}</L>
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value && <img src={value} alt="" className="h-10 w-10 shrink-0 rounded border border-gray-200 object-cover" />}
        <input className="input" value={value ?? ""} placeholder="이미지 URL 또는 업로드" onChange={(e) => onChange(e.target.value)} aria-label={`${label} URL`} />
        <label className="btn btn-ghost btn-sm shrink-0">
          {busy ? "올리는 중…" : "업로드"}
          <input
            type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true); setErr("");
              try { onChange(await uploadImage(f, f.name)); } catch (x) { setErr(x instanceof Error ? x.message : "업로드 실패"); }
              setBusy(false);
            }}
          />
        </label>
      </div>
      {err && <p role="alert" className="mt-1 text-xs font-semibold text-red-600">{err}</p>}
    </div>
  );
}

export function LandingEditor({ landing, initial, versions, serving }: Props) {
  const [content, setContent] = useState(initial);
  const [mode, setMode] = useState<LandingMode>(landing.mode);
  const [sel, setSel] = useState<string | null>(initial.sections[0]?.id ?? null);
  const [tab, setTab] = useState<"sections" | "form" | "page" | "publish">("sections");
  const [save, setSave] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [status, setStatus] = useState(landing.status);
  const [published, setPublished] = useState(landing.hasPublished);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  const latest = useRef({ content, mode });
  useEffect(() => { latest.current = { content, mode }; }, [content, mode]);

  const update = (fn: (d: LandingContent) => void) => setContent((c) => { const d = structuredClone(c); fn(d); return d; });
  const issues = useMemo(() => validateForPublish(content), [content]);
  const errors = issues.filter((i) => i.level === "error");

  // 자동 저장(1.5초 디바운스)
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSave("dirty");
    const t = setTimeout(() => void (async () => {
      setSave("saving");
      const r = await saveLandingAction(landing.id, latest.current.content, latest.current.mode).catch(() => ({ ok: false as const, error: "" }));
      setSave(r.ok ? "saved" : "error");
      if (!r.ok && r.error) setMsg({ ok: false, text: r.error });
    })(), 1500);
    return () => clearTimeout(t);
  }, [content, mode, landing.id]);

  // 저장되지 않은 수정이 있으면 이탈 경고
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (save !== "saved") e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [save]);

  async function publish() {
    if (errors.length) { setTab("publish"); return; }
    setBusy(true); setMsg(null);
    const r = await publishLandingAction(landing.id, content, mode);
    setBusy(false);
    if (r.ok) { setSave("saved"); setStatus("published"); setPublished(true); setMsg({ ok: true, text: "발행되었습니다. 공개 URL에서 확인하세요." }); }
    else setMsg({ ok: false, text: r.error });
  }

  const section = content.sections.find((s) => s.id === sel) ?? null;
  const setProp = (k: string, v: unknown) => update((d) => { const s = d.sections.find((x) => x.id === sel); if (s) s.props[k] = v; });
  const move = (id: string, dir: -1 | 1) => update((d) => {
    const i = d.sections.findIndex((s) => s.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= d.sections.length) return;
    [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]];
  });
  const add = (type: SectionType) => {
    const s = newSection(type);
    update((d) => { const i = d.sections.findIndex((x) => x.id === sel); d.sections.splice(i < 0 ? d.sections.length : i + 1, 0, s); });
    setSel(s.id);
  };
  const publicPath = `/p/${landing.slug}`;
  const saveLabel = { saved: "저장됨", dirty: "수정됨…", saving: "저장 중…", error: "저장 실패" }[save];

  return (
    <div className="-m-4 flex h-[calc(100vh-1px)] flex-col md:-m-7">
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <Link href="/app/landings" className="text-sm font-semibold text-gray-500 hover:text-gray-900">← 목록</Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-gray-900">{content.settings.title || "제목 없음"}</p>
          <p className="truncate text-xs text-gray-500">{landing.campaignTitle} · <span className={save === "error" ? "font-semibold text-red-600" : ""} aria-live="polite">{saveLabel}</span></p>
        </div>
        {published && status === "published" && serving && <a href={publicPath} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">공개 페이지 열기 ↗</a>}
        {published && save !== "saved" && <span className="text-xs text-amber-700">발행본과 다른 수정이 있습니다</span>}
        <button type="button" onClick={publish} disabled={busy} className="btn btn-primary">{busy ? "발행 중…" : published ? "다시 발행" : "발행"}</button>
      </header>
      {msg && (
        <div role={msg.ok ? "status" : "alert"} className={`flex items-center justify-between px-4 py-2 text-sm font-semibold ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          <span>{msg.text} {msg.ok && <a href={publicPath} target="_blank" rel="noopener noreferrer" className="underline">{publicPath}</a>}</span>
          <button type="button" onClick={() => setMsg(null)} aria-label="닫기">✕</button>
        </div>
      )}
      {!serving && <div role="alert" className="bg-amber-50 px-4 py-2 text-sm text-amber-900">체험·구독이 종료되어 발행해도 외부에 공개되지 않습니다.</div>}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 왼쪽: 설정 */}
        <div className="flex min-h-0 w-full flex-col border-r border-gray-200 bg-white lg:w-[400px]">
          <div role="tablist" className="flex border-b border-gray-200 text-sm font-semibold">
            {([["sections", "섹션"], ["form", "신청 폼"], ["page", "페이지"], ["publish", `발행 점검${errors.length ? ` (${errors.length})` : ""}`]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`flex-1 px-2 py-2.5 ${tab === k ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-500 hover:text-gray-800"} ${k === "publish" && errors.length ? "!text-red-600" : ""}`}>{label}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {tab === "sections" && (
              <>
                <ul className="space-y-1">
                  {content.sections.map((s, i) => (
                    <li key={s.id} className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-sm ${sel === s.id ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}>
                      <button type="button" onClick={() => setSel(s.id)} className="min-w-0 flex-1 truncate text-left">
                        <b>{SECTION_TYPES.find((t) => t.type === s.type)?.label}</b>
                        <span className="ml-1.5 text-xs text-gray-500">{String(s.props.title || s.props.text || s.props.label || "").slice(0, 18)}</span>
                      </button>
                      <button type="button" onClick={() => move(s.id, -1)} disabled={i === 0} aria-label="위로" className="px-1 text-gray-500 disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => move(s.id, 1)} disabled={i === content.sections.length - 1} aria-label="아래로" className="px-1 text-gray-500 disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => { update((d) => { d.sections = d.sections.filter((x) => x.id !== s.id); }); if (sel === s.id) setSel(null); }} aria-label="삭제" className="px-1 text-red-500">✕</button>
                    </li>
                  ))}
                </ul>
                <div>
                  <L>섹션 추가 {sel ? "(선택한 섹션 아래)" : ""}</L>
                  <div className="flex flex-wrap gap-1.5">
                    {SECTION_TYPES.map((t) => <button key={t.type} type="button" onClick={() => add(t.type)} className="btn btn-ghost btn-sm">+ {t.label}</button>)}
                  </div>
                </div>
                {section && <SectionEditor s={section} setProp={setProp} setAnim={(a) => update((d) => { const x = d.sections.find((y) => y.id === sel); if (x) x.anim = a; })} />}
              </>
            )}

            {tab === "form" && (
              <>
                <p className="text-xs text-gray-500">입력 항목 8종을 조합하고 필수 여부를 정합니다. 이름은 키 <code>name</code>, 연락처는 전화번호·이메일 유형으로 저장됩니다.</p>
                {content.form.fields.map((f, i) => (
                  <div key={f.id} className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center gap-2">
                      <input className="input" value={f.label} aria-label="항목 이름" onChange={(e) => update((d) => { d.form.fields[i].label = e.target.value; })} />
                      <button type="button" aria-label="위로" disabled={i === 0} className="px-1 text-gray-500 disabled:opacity-30" onClick={() => update((d) => { const a = d.form.fields; [a[i - 1], a[i]] = [a[i], a[i - 1]]; })}>↑</button>
                      <button type="button" aria-label="삭제" className="px-1 text-red-500" onClick={() => update((d) => { d.form.fields.splice(i, 1); })}>✕</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select className="input" value={f.type} aria-label="입력 유형" onChange={(e) => update((d) => { d.form.fields[i].type = e.target.value as FieldType; })}>
                        {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                      </select>
                      <input className="input" value={f.key} aria-label="항목 키" onChange={(e) => update((d) => { d.form.fields[i].key = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""); })} />
                    </div>
                    {["select", "radio", "checkbox"].includes(f.type) && (
                      <textarea className="input" rows={3} placeholder={"선택지를 한 줄에 하나씩"} aria-label="선택지" value={(f.options ?? []).join("\n")} onChange={(e) => update((d) => { d.form.fields[i].options = e.target.value.split("\n"); })} />
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <input className="input" placeholder="입력 안내(placeholder)" aria-label="입력 안내" value={f.placeholder ?? ""} onChange={(e) => update((d) => { d.form.fields[i].placeholder = e.target.value; })} />
                      <label className="flex shrink-0 items-center gap-1.5 text-sm"><input type="checkbox" checked={f.required} onChange={(e) => update((d) => { d.form.fields[i].required = e.target.checked; })} /> 필수</label>
                    </div>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((d) => { d.form.fields.push({ id: rid(), key: `field_${d.form.fields.length + 1}`, label: "새 항목", type: "text", required: false }); })}>+ 입력 항목 추가</button>
                <Text label="제출 버튼 문구" value={content.form.submitText} onChange={(v) => update((d) => { d.form.submitText = v; })} />
                <Text label="신청 완료 메시지" value={content.settings.successMessage} onChange={(v) => update((d) => { d.settings.successMessage = v; })} />
                <Text area label="개인정보 수집·이용 동의 문구 (필수 · 발행 시 버전으로 보관)" value={content.form.consentText} onChange={(v) => update((d) => { d.form.consentText = v; })} />
                <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={content.form.marketingEnabled} onChange={(e) => update((d) => { d.form.marketingEnabled = e.target.checked; })} /> 광고성 정보 수신 동의(선택) 받기</label>
                {content.form.marketingEnabled && <Text area label="광고성 정보 수신 동의 문구" value={content.form.marketingText} onChange={(v) => update((d) => { d.form.marketingText = v; })} />}
                <p className="text-xs text-gray-500">광고성 후속 메시지는 이 동의를 한 고객에게만 발송됩니다.</p>
              </>
            )}

            {tab === "page" && (
              <>
                <Text label="페이지 제목" value={content.settings.title} onChange={(v) => update((d) => { d.settings.title = v; })} />
                <div>
                  <L>랜딩 형식</L>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([["card", "카드뉴스형"], ["blog", "블로그형"], ["auto", "기본형"]] as const).map(([m, label]) => (
                      <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={`btn btn-sm ${mode === m ? "btn-primary" : "btn-ghost"}`}>{label}</button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-3"><L>테마 색상</L><input type="color" value={content.settings.themeColor} onChange={(e) => update((d) => { d.settings.themeColor = e.target.value; })} className="h-9 w-12 cursor-pointer rounded border border-gray-300 bg-white p-0.5" /></label>

                {mode === "blog" && (
                  <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <legend className="px-1 text-xs font-bold text-gray-700">블로그 스킨</legend>
                    <div className="grid grid-cols-4 gap-1.5">
                      {BLOG_SKINS.map(([k, label]) => <button key={k} type="button" aria-pressed={content.settings.blog.skin === k} onClick={() => update((d) => { d.settings.blog.skin = k; })} className={`btn btn-sm ${content.settings.blog.skin === k ? "btn-primary" : "btn-ghost"}`}>{label}</button>)}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Text label="작성자" value={content.settings.blog.author} onChange={(v) => update((d) => { d.settings.blog.author = v; })} />
                      <Text label="작성일" value={content.settings.blog.date} onChange={(v) => update((d) => { d.settings.blog.date = v; })} />
                    </div>
                    <label className="block"><L>공감 수</L><input type="number" min={0} className="input" value={content.settings.blog.likes} onChange={(e) => update((d) => { d.settings.blog.likes = Math.max(0, Number(e.target.value) || 0); })} /></label>
                    <L>댓글</L>
                    <p className="text-xs text-amber-700">실제 고객이 남긴 반응만 등록하세요. 꾸며낸 후기·댓글은 표시광고법 위반 소지가 있습니다. 블로그형 페이지에는 &lsquo;광고&rsquo; 표시가 항상 노출됩니다.</p>
                    {content.settings.blog.comments.map((c, i) => (
                      <div key={i} className="flex gap-1.5">
                        <input className="input !w-24" value={c.name} aria-label="댓글 작성자" onChange={(e) => update((d) => { d.settings.blog.comments[i].name = e.target.value; })} />
                        <input className="input" value={c.text} aria-label="댓글 내용" onChange={(e) => update((d) => { d.settings.blog.comments[i].text = e.target.value; })} />
                        <button type="button" aria-label="댓글 삭제" className="px-1 text-red-500" onClick={() => update((d) => { d.settings.blog.comments.splice(i, 1); })}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((d) => { d.settings.blog.comments.push({ name: "", text: "", date: "방금 전" }); })}>+ 댓글 추가</button>
                  </fieldset>
                )}

                <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
                  <legend className="px-1 text-xs font-bold text-gray-700">하단 고정 신청 바</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={content.settings.stickyBar.enabled} onChange={(e) => update((d) => { d.settings.stickyBar.enabled = e.target.checked; })} /> 사용</label>
                  <Text label="문구" value={content.settings.stickyBar.text} onChange={(v) => update((d) => { d.settings.stickyBar.text = v; })} />
                  <Text label="버튼" value={content.settings.stickyBar.button} onChange={(v) => update((d) => { d.settings.stickyBar.button = v; })} />
                </fieldset>
                <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
                  <legend className="px-1 text-xs font-bold text-gray-700">SNS 버튼 (https:// 주소)</legend>
                  {(["kakao", "instagram", "youtube", "blog"] as const).map((k) => (
                    <Text key={k} label={{ kakao: "카카오톡 채널", instagram: "인스타그램", youtube: "유튜브", blog: "블로그" }[k]} value={content.settings.sns[k]} onChange={(v) => update((d) => { d.settings.sns[k] = v; })} />
                  ))}
                </fieldset>
                <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
                  <legend className="px-1 text-xs font-bold text-gray-700">스크롤 추종 이미지/영상</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={content.settings.floating.enabled} onChange={(e) => update((d) => { d.settings.floating.enabled = e.target.checked; })} /> 사용</label>
                  <select className="input" value={content.settings.floating.kind} aria-label="미디어 종류" onChange={(e) => update((d) => { d.settings.floating.kind = e.target.value as "image" | "video"; })}><option value="image">이미지</option><option value="video">영상(mp4 URL)</option></select>
                  {content.settings.floating.kind === "image"
                    ? <ImageField label="이미지" value={content.settings.floating.src} onChange={(v) => update((d) => { d.settings.floating.src = v; })} />
                    : <Text label="영상 URL" value={content.settings.floating.src} onChange={(v) => update((d) => { d.settings.floating.src = v; })} />}
                </fieldset>
              </>
            )}

            {tab === "publish" && (
              <>
                {issues.length === 0 ? <p className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">발행 준비가 완료되었습니다.</p> : (
                  <ul className="space-y-1.5">
                    {issues.map((i, k) => (
                      <li key={k} className={`rounded-lg px-3 py-2 text-sm ${i.level === "error" ? "bg-red-50 font-semibold text-red-700" : "bg-amber-50 text-amber-800"}`}>{i.level === "error" ? "⛔ " : "⚠ "}{i.message}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-gray-500">⛔ 항목을 해결해야 발행할 수 있습니다. 발행하면 현재 내용이 버전으로 저장되고 공개 페이지에 반영됩니다.</p>
                <div>
                  <L>발행 버전 기록</L>
                  {versions.length === 0 ? <p className="text-sm text-gray-500">아직 발행한 적이 없습니다.</p> : (
                    <ul className="divide-y divide-gray-100 text-sm">
                      {versions.map((v) => (
                        <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                          <span>{new Date(v.published_at).toLocaleString("ko-KR")} <span className="text-xs text-gray-500">· {v.note} · {v.author_name ?? "-"}</span></span>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                            if (!confirm("이 버전의 내용을 편집본으로 불러올까요? 현재 편집 중인 내용은 대체됩니다(다시 발행하기 전까지 공개 페이지는 그대로입니다).")) return;
                            const r = await restoreVersionAction(landing.id, v.id);
                            if (r.ok) { first.current = true; setContent(r.content); setSave("saved"); setMsg({ ok: true, text: "편집본으로 불러왔습니다. 확인 후 다시 발행하세요." }); } else setMsg({ ok: false, text: r.error });
                          }}>불러오기</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 오른쪽: 모바일 미리보기(설정 변경 즉시 반영) */}
        <div className="flex min-h-[640px] flex-1 items-start justify-center overflow-y-auto bg-gray-200 p-4">
          <div className="h-[760px] w-[390px] max-w-full overflow-y-auto rounded-[28px] border-[6px] border-gray-900 bg-white shadow-xl" aria-label="모바일 미리보기">
            <LandingView content={content} mode={mode} preview selectedId={sel} onSelect={(id) => { setSel(id); setTab("sections"); }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionEditor({ s, setProp, setAnim }: { s: Section; setProp: (k: string, v: unknown) => void; setAnim: (a: string) => void }) {
  const p = s.props;
  return (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
      <p className="text-xs font-bold text-blue-800">{SECTION_TYPES.find((t) => t.type === s.type)?.label} 편집</p>
      {s.type === "notice" && (
        <>
          <Text label="문구" value={p.text} onChange={(v) => setProp("text", v)} />
          <div className="flex gap-4">
            <label className="flex items-center gap-2"><L>배경</L><input type="color" value={p.bg} onChange={(e) => setProp("bg", e.target.value)} /></label>
            <label className="flex items-center gap-2"><L>글자</L><input type="color" value={p.color} onChange={(e) => setProp("color", e.target.value)} /></label>
          </div>
        </>
      )}
      {s.type === "text" && (
        <>
          <Text label="제목" value={p.title} onChange={(v) => setProp("title", v)} />
          <Text area label="본문" value={p.body} onChange={(v) => setProp("body", v)} />
          <label className="block"><L>정렬</L><select className="input" value={p.align} onChange={(e) => setProp("align", e.target.value)}><option value="left">왼쪽</option><option value="center">가운데</option></select></label>
        </>
      )}
      {s.type === "image" && (
        <>
          <ImageField label="이미지" value={p.src} onChange={(v) => setProp("src", v)} />
          <Text label="대체 텍스트(접근성)" value={p.alt} onChange={(v) => setProp("alt", v)} />
        </>
      )}
      {s.type === "gallery" && (
        <>
          {((p.images as string[]) ?? []).map((src, i) => (
            <div key={i} className="flex items-end gap-1.5">
              <div className="flex-1"><ImageField label={`사진 ${i + 1}`} value={src} onChange={(v) => setProp("images", (p.images as string[]).map((x, k) => (k === i ? v : x)))} /></div>
              <button type="button" aria-label="사진 삭제" className="pb-2 text-red-500" onClick={() => setProp("images", (p.images as string[]).filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProp("images", [...((p.images as string[]) ?? []), ""])}>+ 사진 추가</button>
          <label className="block"><L>배치</L><select className="input" value={p.layout} onChange={(e) => setProp("layout", e.target.value)}><option value="slide">옆으로 넘기기</option><option value="grid">2열 격자</option></select></label>
        </>
      )}
      {s.type === "countdown" && (
        <>
          <Text label="제목" value={p.title} onChange={(v) => setProp("title", v)} />
          <label className="block"><L>마감 시각</L><input type="datetime-local" className="input" value={p.deadline} onChange={(e) => setProp("deadline", e.target.value)} /></label>
          <Text label="마감 후 문구" value={p.endText} onChange={(v) => setProp("endText", v)} />
        </>
      )}
      {s.type === "cta" && (
        <>
          <Text label="버튼 문구" value={p.text} onChange={(v) => setProp("text", v)} />
          <Text label="보조 문구" value={p.sub} onChange={(v) => setProp("sub", v)} />
        </>
      )}
      {s.type === "form" && (
        <>
          <Text label="폼 제목" value={p.title} onChange={(v) => setProp("title", v)} />
          <Text label="안내 문구" value={p.subtitle} onChange={(v) => setProp("subtitle", v)} />
          <p className="text-xs text-gray-500">입력 항목과 동의 문구는 &lsquo;신청 폼&rsquo; 탭에서 설정합니다.</p>
        </>
      )}
      {s.type === "reviews" && (
        <>
          <Text label="제목" value={p.title} onChange={(v) => setProp("title", v)} />
          <p className="text-xs text-amber-700">실제 고객 후기만 등록하세요.</p>
          {((p.items as { name: string; text: string; rating: number }[]) ?? []).map((r, i) => {
            const items = p.items as { name: string; text: string; rating: number }[];
            const set = (patch: object) => setProp("items", items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="space-y-1.5 rounded border border-gray-200 bg-white p-2">
                <div className="flex gap-1.5">
                  <input className="input" value={r.name} aria-label="작성자" onChange={(e) => set({ name: e.target.value })} />
                  <select className="input !w-20" value={r.rating} aria-label="별점" onChange={(e) => set({ rating: Number(e.target.value) })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>★{n}</option>)}</select>
                  <button type="button" aria-label="후기 삭제" className="px-1 text-red-500" onClick={() => setProp("items", items.filter((_, k) => k !== i))}>✕</button>
                </div>
                <textarea className="input" rows={2} value={r.text} aria-label="후기 내용" onChange={(e) => set({ text: e.target.value })} />
              </div>
            );
          })}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProp("items", [...((p.items as object[]) ?? []), { name: "", text: "", rating: 5 }])}>+ 후기 추가</button>
        </>
      )}
      {s.type === "chat" && (
        <>
          <Text label="버튼 문구" value={p.label} onChange={(v) => setProp("label", v)} />
          <Text label="연결 URL (카카오톡 채널 등)" value={p.url} onChange={(v) => setProp("url", v)} placeholder="https://pf.kakao.com/..." />
        </>
      )}
      {s.type !== "chat" && (
        <label className="block"><L>등장 효과</L><select className="input" value={s.anim} onChange={(e) => setAnim(e.target.value)}>{ANIMATIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
      )}
    </div>
  );
}
