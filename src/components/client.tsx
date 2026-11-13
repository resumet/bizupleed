"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

/** 액션 결과 메시지(?ok= / ?error=) 표시 후 주소에서 제거한다. */
export function Flash() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ok = sp.get("ok");
  const error = sp.get("error");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (!ok && !error) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL 의 일회성 메시지를 상태로 옮긴 뒤 주소에서 제거한다
    setMsg(error ? { kind: "error", text: error } : { kind: "ok", text: ok! });
    const p = new URLSearchParams(sp.toString());
    p.delete("ok");
    p.delete("error");
    router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
  }, [ok, error, sp, router, pathname]);
  useEffect(() => {
    if (msg?.kind !== "ok") return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div role={msg.kind === "error" ? "alert" : "status"} className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-semibold ${msg.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-800"}`}>
      <span>{msg.text}</span>
      <button type="button" onClick={() => setMsg(null)} aria-label="닫기" className="opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

export function SubmitButton({ children, className = "btn btn-primary", confirm: confirmMsg, pendingText }: { children: React.ReactNode; className?: string; confirm?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} onClick={(e) => { if (confirmMsg && !window.confirm(confirmMsg)) e.preventDefault(); }}>
      {pending ? (pendingText ?? "처리 중…") : children}
    </button>
  );
}

export function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        const value = text.startsWith("/") ? location.origin + text : text;
        await navigator.clipboard?.writeText(value).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "복사됨 ✓" : label}
    </button>
  );
}

export function NavLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"}`}>
      {children}
    </Link>
  );
}

/** 값이 바뀌면 곧바로 폼을 제출하는 select (필터·상태 변경용). */
export function AutoSelect({ name, defaultValue, children, className = "input", ariaLabel }: { name: string; defaultValue?: string; children: React.ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <select name={name} defaultValue={defaultValue} aria-label={ariaLabel} className={className} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {children}
    </select>
  );
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(fd), agree: fd.get("agree") === "on" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청에 실패했습니다.");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      {mode === "signup" && (
        <>
          <div><label className="label" htmlFor="name">이름(실명)</label><input id="name" name="name" className="input" required minLength={2} autoComplete="name" /></div>
          <div><label className="label" htmlFor="phone">휴대폰 번호</label><input id="phone" name="phone" className="input" required inputMode="numeric" placeholder="010-0000-0000" autoComplete="tel" /></div>
        </>
      )}
      <div><label className="label" htmlFor="email">이메일</label><input id="email" name="email" type="email" className="input" required autoComplete="email" /></div>
      <div>
        <label className="label" htmlFor="password">비밀번호{mode === "signup" && " (8자 이상)"}</label>
        <input id="password" name="password" type="password" className="input" required minLength={mode === "signup" ? 8 : 1} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
      </div>
      {mode === "signup" && (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" name="agree" required className="mt-0.5 h-4 w-4" />
          <span><Link href="/terms" target="_blank" className="font-semibold underline">이용약관</Link> 및 <Link href="/privacy" target="_blank" className="font-semibold underline">개인정보처리방침</Link>에 동의합니다. (필수)</span>
        </label>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary w-full py-3 text-base">
        {busy ? "처리 중…" : mode === "signup" ? "14일 무료 체험 시작" : "로그인"}
      </button>
    </form>
  );
}
