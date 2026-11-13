import { SubmitButton } from "@/components/client";
import { Empty, PageHeader, Section, Stat, SUB_LABEL, Tag, num } from "@/components/ui";
import { can, getSubscription } from "@/lib/accounts";
import { getWallet, listLedger } from "@/lib/credits";
import { q } from "@/lib/db";
import { COST_LABELS, CREDIT_VALID_YEARS, PLAN, TOPUP_OPTIONS } from "@/lib/pricing";
import { KST, requireCtx } from "@/lib/session";
import { cancelSubAction, subscribeAction, topupAction } from "../actions";

const KIND: Record<string, [string, "green" | "red" | "blue" | "gray"]> = { topup: ["충전", "green"], charge: ["차감", "red"], refund: ["복구", "blue"], expire: ["소멸", "gray"] };

export default async function BillingPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "billing.manage")) return <Empty title="접근 권한이 없습니다" desc="결제와 크레딧은 관리자만 볼 수 있습니다." />;
  const sub = await getSubscription(ctx.workspaceId);
  const w = await getWallet(ctx.workspaceId);
  const ledger = await listLedger(ctx.workspaceId, 100);
  const payments = await q<{ id: string; kind: string; amount: number; vat: number; memo: string; created_at: string }>("SELECT * FROM payments WHERE workspace_id=? ORDER BY created_at DESC LIMIT 20", ctx.workspaceId);
  return (
    <>
      <PageHeader title="구독·크레딧" desc="월 구독으로 랜딩을 무제한 공개하고, AI·메시지는 사용한 만큼 크레딧으로 차감됩니다." />
      <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">결제는 현재 <b>모의 결제</b>로 동작합니다. 실제 카드 청구는 일어나지 않으며, PG 연동 시 결제 웹훅(<code>/api/webhooks/payment</code>)으로 대체됩니다.</p>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="구독 상태" value={SUB_LABEL[sub.status]} sub={sub.status === "trialing" ? `체험 종료 ${KST(sub.trial_end, false)} · 자동 결제 없음` : sub.current_period_end ? `${sub.cancel_at_period_end ? "이용 종료" : "다음 결제"} ${KST(sub.current_period_end, false)}` : undefined} />
        <Stat label="크레딧 잔액" value={num(w.total)} sub={`유상 ${num(w.paid_balance)} · 무상 ${num(w.bonus_balance)}`} />
        <Stat label="유효기간" value={w.expires_at ? KST(w.expires_at, false) : "–"} sub={`마지막 충전일로부터 ${CREDIT_VALID_YEARS}년`} />
        <Stat label="체험 무료 혜택" value={`기획 ${sub.free_plan_left} · 이미지 ${sub.free_gen_left}`} sub="무료 체험 기간에만 사용" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="월 구독" desc={`월 ${num(PLAN.monthlyPrice)}원 (VAT 포함) · 랜딩 개수 무제한`}>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-gray-600">
            <li>무료 체험 {PLAN.trialDays}일 뒤 자동으로 결제되지 않습니다. 체험이 끝나면 랜딩 외부 공개만 중지됩니다.</li>
            <li>해지해도 남은 결제 기간까지 이용할 수 있습니다.</li>
            <li>구독 종료 후 리드는 {PLAN.retentionDaysAfterEnd}일간 보관되며 내려받을 수 있습니다.</li>
          </ul>
          <div className="flex gap-2">
            {(sub.status !== "active" || !!sub.cancel_at_period_end) && <form action={subscribeAction}><SubmitButton confirm={`월 ${num(PLAN.monthlyPrice)}원 구독을 시작할까요? (모의 결제)`}>{sub.status === "active" ? "구독 유지하기" : "구독 시작"}</SubmitButton></form>}
            {sub.status === "active" && !sub.cancel_at_period_end && <form action={cancelSubAction}><SubmitButton className="btn btn-danger" confirm="구독을 해지할까요? 남은 기간까지는 이용할 수 있습니다.">구독 해지</SubmitButton></form>}
            {sub.status === "active" && !!sub.cancel_at_period_end && <Tag tone="amber">해지 예약됨</Tag>}
          </div>
        </Section>
        <Section title="크레딧 충전" desc="1크레딧 = 1원 · 충전 금액에 VAT 10% 별도 · 무상 추가분은 환불 대상에서 제외">
          <div className="grid grid-cols-2 gap-2">
            {TOPUP_OPTIONS.map((o) => (
              <form key={o.amount} action={topupAction}>
                <input type="hidden" name="amount" value={o.amount} />
                <SubmitButton className="btn btn-ghost w-full flex-col !items-start !gap-0 py-3 text-left" confirm={`${num(o.amount)}크레딧 충전 — 결제 금액 ${num(Math.round(o.amount * 1.1))}원(VAT 포함). 진행할까요? (모의 결제)`}>
                  <span className="text-base font-extrabold">{num(o.amount)} 크레딧</span>
                  <span className="text-xs font-normal text-gray-500">{num(Math.round(o.amount * 1.1))}원{o.bonus ? ` · +${num(o.bonus)} 무상` : ""}</span>
                </SubmitButton>
              </form>
            ))}
          </div>
        </Section>
      </div>

      <Section title="사용 요금표">
        <table className="w-full max-w-md text-sm">
          <tbody className="divide-y divide-gray-100">{COST_LABELS.map(([label, cost]) => <tr key={label}><td className="td">{label}</td><td className="td text-right font-semibold tabular-nums">{num(cost)} 크레딧</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">잔액이 부족하면 실행되지 않으며, 발송·생성에 실패하면 차감된 크레딧이 자동 복구됩니다.</p>
      </Section>

      <Section title="크레딧 원장" desc="충전·차감·복구 내역 (최근 100건)">
        {ledger.length === 0 ? <p className="text-sm text-gray-500">내역이 없습니다.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">일시</th><th className="th">구분</th><th className="th">내용</th><th className="th text-right">유상</th><th className="th text-right">무상</th><th className="th text-right">잔액</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {ledger.map((r) => {
                  const [label, tone] = KIND[r.kind] ?? [r.kind, "gray"];
                  const signed = (n: number) => (n > 0 ? `+${num(n)}` : n ? num(n) : "-");
                  return (<tr key={r.id}><td className="td whitespace-nowrap text-gray-500">{KST(r.created_at)}</td><td className="td"><Tag tone={tone}>{label}</Tag></td><td className="td">{r.memo}</td><td className="td text-right tabular-nums">{signed(r.paid_delta)}</td><td className="td text-right tabular-nums">{signed(r.bonus_delta)}</td><td className="td text-right font-semibold tabular-nums">{num(r.balance_after)}</td></tr>);
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {payments.length > 0 && (
        <Section title="결제 내역">
          <ul className="divide-y divide-gray-100 text-sm">
            {payments.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{KST(p.created_at)} · {p.memo}</span><span className="tabular-nums">{num(p.amount + p.vat)}원</span></li>)}
          </ul>
          <p className="mt-2 text-xs text-gray-500">환불은 고객센터로 요청해 주세요. 사용하지 않은 유상 크레딧이 환불 대상입니다.</p>
        </Section>
      )}
    </>
  );
}
