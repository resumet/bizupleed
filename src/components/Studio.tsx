"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { appendImagesAction, editSpecAction, restoreRevisionAction, revisePagesAction, savePlanAction } from "@/app/app/actions";
import type { ReviewFlag } from "@/lib/ai";
import { Chapter, PAGE_H, PAGE_W, PageLayout, PageSpec, parseTargets, renderPageSvg } from "@/lib/studio";
import { uploadImage } from "./LandingEditor";

const LAYOUT_LABEL: Record<PageLayout, string> = { hero: "표지(가운데)", text: "글 중심", photo: "사진 + 글", list: "체크 목록", cta: "신청 유도" };

/** 상품 사진 업로드(프로젝트 생성 폼용). 업로드된 경로를 hidden 필드로 전달한다. */
export function PhotoUploader({ name }: { name: string }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div>
      <input type="hidden" name={name} value={urls.join("\n")} />
      <div className="flex flex-wrap items-center gap-2">
        {urls.map((u) => (
          <span key={u} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" className="h-16 w-16 rounded-lg border border-gray-200 object-cover" />
            <button type="button" aria-label="사진 삭제" onClick={() => setUrls((p) => p.filter((x) => x !== u))} className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-gray-900 text-xs text-white">✕</button>
          </span>
        ))}
        <label className="btn btn-ghost btn-sm">
          {busy ? "올리는 중…" : "+ 사진 추가"}
          <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={busy} onChange={async (e) => {
            const files = [...(e.target.files ?? [])].slice(0, 10 - urls.length);
            e.target.value = "";
            setBusy(true); setErr("");
            try { for (const f of files) { const u = await uploadImage(f, f.name); setUrls((p) => [...p, u]); } } catch (x) { setErr(x instanceof Error ? x.message : "업로드 실패"); }
            setBusy(false);
          }} />
        </label>
      </div>
      {err && <p role="alert" className="mt-1 text-xs font-semibold text-red-600">{err}</p>}
    </div>
  );
}

/** 기획서 편집(I-03): 장별 제목·본문을 고친 뒤 저장하면 사실 검토가 다시 수행된다. */
export function PlanEditor({ projectId, initial, flags }: { projectId: string; initial: Chapter[]; flags: ReviewFlag[] }) {
  const router = useRouter();
  const [chapters, setChapters] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState("");
  const set = (i: number, patch: Partial<Chapter>) => { setState("idle"); setChapters((p) => p.map((c, k) => (k === i ? { ...c, ...patch } : c))); };
  const dirty = JSON.stringify(chapters) !== JSON.stringify(initial);
  return (
    <div>
      {flags.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-bold">사실 검토가 필요한 표현 {flags.length}건</p>
          <ul className="mt-1 list-disc pl-5">{flags.map((f, i) => <li key={i}>{f.chapter}장 &lsquo;{f.text}&rsquo; — {f.reason}</li>)}</ul>
          <p className="mt-1 text-xs">자료에 없는 효능·가격·성과 수치는 과장 광고가 될 수 있습니다. 직접 확인한 내용만 남겨 주세요.</p>
        </div>
      )}
      <ol className="space-y-2">
        {chapters.map((c, i) => (
          <li key={i} className="grid gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-[2rem_1fr_9rem_auto]">
            <span className="pt-2 text-sm font-extrabold text-gray-400">{i + 1}</span>
            <div className="space-y-1.5">
              <input className="input font-semibold" value={c.title} aria-label={`${i + 1}장 제목`} onChange={(e) => set(i, { title: e.target.value })} />
              <textarea className="input" rows={2} value={c.body} aria-label={`${i + 1}장 본문`} onChange={(e) => set(i, { body: e.target.value })} />
            </div>
            <select className="input self-start" value={c.layout} aria-label={`${i + 1}장 구성`} onChange={(e) => set(i, { layout: e.target.value as PageLayout })}>
              {Object.entries(LAYOUT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button type="button" aria-label={`${i + 1}장 삭제`} className="self-start px-1 pt-2 text-red-500" onClick={() => { setState("idle"); setChapters((p) => p.filter((_, k) => k !== i)); }}>✕</button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setState("idle"); setChapters((p) => [...p, { title: "새 장", body: "", layout: "text", visual: "" }]); }}>+ 장 추가</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || state === "saving"} onClick={async () => {
          setState("saving"); setErr("");
          const r = await savePlanAction(projectId, chapters);
          if (r.ok) { setState("saved"); router.refresh(); } else { setErr(r.error); setState("idle"); }
        }}>{state === "saving" ? "저장 중…" : "기획서 저장"}</button>
        {dirty && <span className="text-xs text-amber-700">저장하지 않은 수정이 있습니다. 저장 후 이미지를 생성하세요.</span>}
        {state === "saved" && !dirty && <span className="text-xs text-green-700" role="status">저장됨</span>}
        {err && <span role="alert" className="text-xs font-semibold text-red-600">{err}</span>}
      </div>
    </div>
  );
}

type Page = { id: string; page_order: number; current_revision: number; spec: PageSpec; revisions: { revision: number; prompt: string | null; created_at: string }[] };

async function toDataUri(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
}

/** 장 스펙을 PNG(2배 해상도)로 변환한다. 사진은 data URI 로 내장해야 캔버스에 그려진다. */
async function pageToPng(spec: PageSpec): Promise<Blob> {
  const svg = renderPageSvg(spec, spec.photo ? await toDataUri(spec.photo) : undefined);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("이미지 변환 실패")); img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_W * 2; canvas.height = PAGE_H * 2;
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("이미지 변환 실패"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function StudioWorkspace({ projectId, name, pages, photos, landings, regenCost, balance }: {
  projectId: string; name: string; pages: Page[]; photos: string[]; landings: { id: string; name: string }[]; regenCost: number; balance: number;
}) {
  const router = useRouter();
  const [cur, setCur] = useState(pages[0]?.id ?? "");
  const page = pages.find((p) => p.id === cur) ?? pages[0];
  const [draft, setDraft] = useState<{ id: string; spec: PageSpec } | null>(null);
  const spec = draft && draft.id === page.id ? draft.spec : page.spec;
  const [instruction, setInstruction] = useState("");
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState("");
  const [landingId, setLandingId] = useState(landings[0]?.id ?? "");
  const svg = useMemo(() => renderPageSvg(spec, spec.photo || undefined), [spec]);
  const say = (ok: boolean, text: string) => setLog((p) => [...p.slice(-5), { ok, text }]);
  const edit = (patch: Partial<PageSpec>) => setDraft({ id: page.id, spec: { ...spec, ...patch } });

  async function sendChat() {
    const text = instruction.trim();
    if (!text || busy) return;
    const t = parseTargets(text, pages.length);
    const targets = t.pages.length ? t.pages : [page.page_order];
    const cost = targets.length * regenCost;
    // 전체 변경은 대상 장을 제안하고 확인 후 실행(I-08). 실행 전 예상 비용 표시.
    const question = t.all
      ? `전체 ${targets.length}장을 모두 수정합니다. 예상 비용 ${cost.toLocaleString()}크레딧 (보유 ${balance.toLocaleString()}). 진행할까요?`
      : `${targets.join(", ")}번 장을 AI로 재생성합니다. 예상 비용 ${cost.toLocaleString()}크레딧 (보유 ${balance.toLocaleString()}). 진행할까요?`;
    if (!confirm(question)) return;
    setBusy("chat");
    const r = await revisePagesAction(projectId, targets, text);
    setBusy("");
    if (!r.ok) return say(false, r.error);
    if (r.done.length) { say(true, `${r.done.join(", ")}번 장을 수정했습니다. (${(r.done.length * regenCost).toLocaleString()}크레딧)`); setInstruction(""); setDraft(null); }
    for (const f of r.failed) say(false, `${f.page}번 장 실패 — 크레딧 복구됨: ${f.error}`);
    router.refresh();
  }

  async function saveDirect() {
    if (!draft) return;
    setBusy("save");
    const r = await editSpecAction(page.id, draft.spec);
    setBusy("");
    if (!r.ok) return say(false, r.error);
    setDraft(null); say(true, `${page.page_order}번 장 직접 수정을 저장했습니다. (무료)`);
    router.refresh();
  }

  async function downloadAll(only?: Page) {
    setBusy("png");
    try {
      for (const p of only ? [only] : pages) {
        download(await pageToPng(p.id === page.id ? spec : p.spec), `${name}_${String(p.page_order).padStart(2, "0")}.png`);
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e) { say(false, e instanceof Error ? e.message : "다운로드 실패"); }
    setBusy("");
  }

  async function insertToLanding() {
    if (!landingId || !confirm(`전체 ${pages.length}장을 선택한 랜딩의 신청 폼 앞에 이미지로 삽입할까요? (랜딩은 다시 발행해야 공개 페이지에 반영됩니다)`)) return;
    setBusy("insert");
    try {
      const urls: string[] = [];
      for (const p of pages) urls.push(await uploadImage(await pageToPng(p.spec), `page_${p.page_order}.png`));
      const r = await appendImagesAction(landingId, urls);
      say(r.ok, r.ok ? `랜딩에 ${r.count}장을 삽입했습니다. 랜딩 편집기에서 확인 후 발행하세요.` : r.error);
    } catch (e) { say(false, e instanceof Error ? e.message : "삽입 실패"); }
    setBusy("");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[7.5rem_minmax(0,1fr)_22rem]">
      {/* 왼쪽: 장 목록 */}
      <ol className="flex gap-2 overflow-x-auto lg:max-h-[720px] lg:flex-col lg:overflow-y-auto" aria-label="장 목록">
        {pages.map((p) => (
          <li key={p.id} className="shrink-0">
            <button type="button" onClick={() => { setCur(p.id); setDraft(null); }} aria-current={p.id === page.id} className={`block w-24 overflow-hidden rounded-lg border-2 lg:w-full ${p.id === page.id ? "border-blue-600" : "border-transparent ring-1 ring-gray-200"}`}>
              <div className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: renderPageSvg(p.spec, p.spec.photo || undefined) }} />
              <span className="block bg-white py-0.5 text-center text-[11px] font-bold text-gray-600">{p.page_order}장 · v{p.current_revision}</span>
            </button>
          </li>
        ))}
      </ol>

      {/* 가운데: 이미지 */}
      <div>
        <div className="mx-auto max-w-[460px] overflow-hidden rounded-xl shadow ring-1 ring-gray-200 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" role="img" aria-label={`${page.page_order}장 미리보기: ${spec.title}`} dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => downloadAll(page)}>이 장 PNG</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => downloadAll()}>{busy === "png" ? "변환 중…" : `전체 ${pages.length}장 PNG 내려받기`}</button>
        </div>
        {landings.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <select className="input !w-56" value={landingId} onChange={(e) => setLandingId(e.target.value)} aria-label="삽입할 랜딩">{landings.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={insertToLanding}>{busy === "insert" ? "삽입 중…" : "랜딩에 삽입"}</button>
          </div>
        )}
      </div>

      {/* 오른쪽: 채팅 수정 · 직접 수정 · 버전 */}
      <div className="space-y-4">
        <div className="card p-3">
          <p className="mb-1 text-sm font-bold">채팅으로 수정 <span className="font-normal text-gray-500">· 장당 {regenCost.toLocaleString()}크레딧</span></p>
          <p className="mb-2 text-xs text-gray-500">예: &ldquo;3번째 장 배경을 파란색으로&rdquo;, &ldquo;2번 장 제목을 &lsquo;첫 상담 무료&rsquo;로&rdquo;. 장을 지정하지 않으면 지금 보는 {page.page_order}번 장에만 적용됩니다.</p>
          <textarea className="input" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="수정 요청을 입력하세요" aria-label="수정 요청" />
          <button type="button" className="btn btn-primary mt-2 w-full" disabled={!!busy || !instruction.trim()} onClick={sendChat}>{busy === "chat" ? "수정 중…" : "수정 요청"}</button>
          {log.length > 0 && <ul className="mt-2 space-y-1" aria-live="polite">{log.map((l, i) => <li key={i} className={`rounded px-2 py-1 text-xs ${l.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{l.text}</li>)}</ul>}
        </div>

        <div className="card space-y-2 p-3">
          <p className="text-sm font-bold">직접 수정 <span className="font-normal text-gray-500">· 무료</span></p>
          <input className="input" value={spec.title} aria-label="제목" onChange={(e) => edit({ title: e.target.value })} />
          <textarea className="input" rows={3} value={spec.body} aria-label="본문" onChange={(e) => edit({ body: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" value={spec.badge} placeholder="배지" aria-label="배지" onChange={(e) => edit({ badge: e.target.value })} />
            <input className="input" value={spec.highlight} placeholder="강조 문구" aria-label="강조 문구" onChange={(e) => edit({ highlight: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select className="input" value={spec.layout} aria-label="구성" onChange={(e) => edit({ layout: e.target.value as PageLayout })}>{Object.entries(LAYOUT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select className="input" value={spec.photoPos} aria-label="사진 위치" onChange={(e) => edit({ photoPos: e.target.value as "top" | "bottom" })}><option value="top">사진 위쪽</option><option value="bottom">사진 아래쪽</option></select>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            {(["bg", "bg2", "fg", "accent"] as const).map((k) => <label key={k} className="flex items-center gap-1">{{ bg: "배경", bg2: "배경2", fg: "글자", accent: "강조" }[k]}<input type="color" value={spec[k]} onChange={(e) => edit({ [k]: e.target.value })} /></label>)}
          </div>
          <div>
            <p className="label">사진 (표지·사진 구성에서 표시)</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => edit({ photo: "" })} aria-pressed={!spec.photo} className={`h-12 w-12 rounded border text-[10px] ${!spec.photo ? "border-blue-600 text-blue-700" : "border-gray-300 text-gray-500"}`}>없음</button>
              {photos.map((u) => (
                <button key={u} type="button" onClick={() => edit({ photo: u, layout: spec.layout === "hero" ? "hero" : "photo" })} aria-pressed={spec.photo === u} className={`overflow-hidden rounded border-2 ${spec.photo === u ? "border-blue-600" : "border-transparent"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="h-12 w-12 object-cover" />
                </button>
              ))}
              <label className="btn btn-ghost btn-sm">+ 추가<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = "";
                if (!f) return;
                try { edit({ photo: await uploadImage(f, f.name), layout: spec.layout === "hero" ? "hero" : "photo" }); } catch (x) { say(false, x instanceof Error ? x.message : "업로드 실패"); }
              }} /></label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm flex-1" disabled={!draft || !!busy} onClick={saveDirect}>{busy === "save" ? "저장 중…" : "수정 저장"}</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!draft} onClick={() => setDraft(null)}>취소</button>
          </div>
        </div>

        <div className="card p-3">
          <p className="mb-2 text-sm font-bold">{page.page_order}장 버전 <span className="font-normal text-gray-500">· 복구 무료</span></p>
          <ul className="max-h-44 space-y-1 overflow-y-auto text-xs">
            {page.revisions.map((r) => (
              <li key={r.revision} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate"><b>v{r.revision}</b> {r.prompt}</span>
                {r.revision === page.current_revision ? <span className="shrink-0 font-semibold text-blue-700">현재</span> : (
                  <button type="button" className="shrink-0 font-semibold text-gray-600 underline" disabled={!!busy} onClick={async () => {
                    const x = await restoreRevisionAction(page.id, r.revision);
                    if (x.ok) { setDraft(null); say(true, `${page.page_order}장을 v${r.revision}으로 복구했습니다.`); router.refresh(); } else say(false, x.error);
                  }}>복구</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
