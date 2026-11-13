import Link from "next/link";
import { Suspense } from "react";
import { Flash, NavLink } from "@/components/client";
import { SUB_LABEL, num } from "@/components/ui";
import { can, getSubscription } from "@/lib/accounts";
import { getWallet } from "@/lib/credits";
import { requireCtx } from "@/lib/session";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";
// AI 기획·이미지 생성 서버 액션이 Claude 응답을 기다릴 수 있도록 실행 시간 한도를 늘린다(Vercel).
export const maxDuration = 60;

const ROLE_LABEL = { owner: "관리자", marketer: "마케터", agent: "상담 담당자" };

export default async function ConsoleLayout({ children }: LayoutProps<"/app">) {
  const ctx = await requireCtx();
  const sub = await getSubscription(ctx.workspaceId);
  const wallet = await getWallet(ctx.workspaceId);
  // eslint-disable-next-line react-hooks/purity -- 요청 시점마다 렌더링되는 서버 컴포넌트
  const daysLeft = Math.max(0, Math.ceil((new Date(sub.trial_end).getTime() - Date.now()) / 86400_000));
  const nav: [string, string, boolean][] = [
    ["/app", "대시보드", true],
    ["/app/clients", "고객사·공유", can(ctx, "client.manage")],
    ["/app/campaigns", "캠페인", can(ctx, "campaign.create")],
    ["/app/landings", "랜딩페이지", can(ctx, "landing.edit")],
    ["/app/studio", "AI 상세페이지", can(ctx, "ai.use")],
    ["/app/leads", "리드(DB)", can(ctx, "lead.view")],
    ["/app/automation", "알림·자동화", can(ctx, "automation.edit")],
    ["/app/analytics", "추적·분석", can(ctx, "analytics.view")],
    ["/app/billing", "구독·크레딧", can(ctx, "billing.manage")],
    ["/app/settings", "설정", can(ctx, "member.manage")],
  ];
  const stopped = sub.status !== "trialing" && sub.status !== "active";
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="shrink-0 border-b border-gray-200 bg-white md:sticky md:top-0 md:h-screen md:w-56 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3 md:block md:py-5">
          <Link href="/app" className="text-lg font-extrabold tracking-tight text-gray-900">비즈업<span className="text-blue-600">리드</span></Link>
          <p className="truncate text-xs text-gray-500 md:mt-1">{ctx.workspaceName}</p>
        </div>
        <nav aria-label="주 메뉴" className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:space-y-0.5 md:overflow-visible">
          {nav.filter(([, , show]) => show).map(([href, label]) => <NavLink key={href} href={href} exact={href === "/app"}>{label}</NavLink>)}
        </nav>
        <div className="hidden border-t border-gray-100 p-4 text-xs text-gray-500 md:absolute md:bottom-0 md:block md:w-full">
          <p className="font-semibold text-gray-800">{ctx.userName} <span className="font-normal text-gray-500">· {ROLE_LABEL[ctx.role]}</span></p>
          <p className="mt-1">{SUB_LABEL[sub.status]}{sub.status === "trialing" && ` · ${daysLeft}일 남음`}</p>
          {can(ctx, "billing.manage") && <p>크레딧 {num(wallet.total)}</p>}
          <form action={logoutAction} className="mt-2"><button className="font-semibold text-gray-600 underline">로그아웃</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-7">
        <form action={logoutAction} className="mb-3 flex justify-end text-xs md:hidden"><button className="font-semibold text-gray-600 underline">로그아웃</button></form>
        {stopped && (
          <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <b>{SUB_LABEL[sub.status]}</b> — 랜딩 외부 공개가 중지되었습니다. 리드 데이터는 종료 후 30일간 보관되며 내려받을 수 있습니다.{" "}
            {can(ctx, "billing.manage") && <Link href="/app/billing" className="font-bold underline">구독하고 다시 공개하기</Link>}
          </div>
        )}
        <Suspense><Flash /></Suspense>
        {children}
      </main>
    </div>
  );
}
