import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-gray-900">{title}</h1>
        {desc && <p className="mt-1 text-sm text-gray-500">{desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Badge({ children, color = "#6b7280" }: { children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color, background: `color-mix(in srgb, ${color} 12%, white)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function Tag({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "red" | "amber" | "green" | "blue" }) {
  const cls = { gray: "bg-gray-100 text-gray-600", red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-700", green: "bg-green-50 text-green-700", blue: "bg-blue-50 text-blue-700" }[tone];
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

export function Empty({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <p className="text-sm font-bold text-gray-800">{title}</p>
      {desc && <p className="mt-1 max-w-md text-sm text-gray-500">{desc}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <div className="card h-full p-4">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block transition hover:opacity-80">{body}</Link> : body;
}

export function Section({ title, desc, children, action }: { title: string; desc?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          {desc && <p className="mt-0.5 text-xs text-gray-500">{desc}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export const num = (n: number) => n.toLocaleString("ko-KR");
export const pct = (v: number | null, digits = 1) => (v === null ? "–" : `${(v * 100).toFixed(digits)}%`);

export const SUB_LABEL: Record<string, string> = { trialing: "무료 체험", active: "구독 중", past_due: "결제 실패", suspended: "체험 만료(공개 중지)", cancelled: "구독 종료" };
export const JOB_LABEL: Record<string, [string, "gray" | "red" | "amber" | "green" | "blue"]> = {
  scheduled: ["예약", "blue"], queued: ["처리 중", "amber"], sent: ["발송", "green"], delivered: ["수신 확인", "green"], failed: ["실패", "red"], cancelled: ["취소", "gray"],
};
export const LANDING_LABEL: Record<string, [string, "gray" | "red" | "amber" | "green" | "blue"]> = {
  draft: ["초안", "gray"], published: ["공개 중", "green"], paused: ["비공개", "amber"], archived: ["보관", "gray"],
};
export const MODE_LABEL: Record<string, string> = { card: "카드뉴스형", blog: "블로그형", auto: "자동 빌더" };
