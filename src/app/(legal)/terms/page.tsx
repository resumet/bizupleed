import { CREDIT_VALID_YEARS, PLAN } from "@/lib/pricing";

export const metadata = { title: "이용약관(초안) — 비즈업리드" };

export default function Terms() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-7 text-gray-700">
      <h1 className="text-2xl font-extrabold text-gray-900">이용약관 (초안)</h1>
      <p className="rounded-lg bg-amber-50 p-3 text-amber-900">이 문서는 제품에 구현된 정책을 요약한 초안입니다. 서비스 공개 전 법률 검토를 거쳐 확정해야 합니다.</p>
      <h2 className="font-bold text-gray-900">무료 체험과 구독</h2>
      <p>가입 시 {PLAN.trialDays}일 무료 체험이 시작되며 카드 등록이 필요하지 않습니다. 체험 종료 후 자동으로 결제되지 않으며, 구독하지 않으면 랜딩페이지의 외부 공개가 중지됩니다. 월 구독료는 {PLAN.monthlyPrice.toLocaleString()}원(VAT 포함)이고, 해지 시 남은 결제 기간까지 이용할 수 있습니다.</p>
      <h2 className="font-bold text-gray-900">크레딧</h2>
      <p>1크레딧은 1원이며 충전 시 VAT가 별도 부과됩니다. 크레딧의 유효기간은 마지막 충전일로부터 {CREDIT_VALID_YEARS}년입니다. 잔액이 부족하면 유료 기능이 실행되지 않고, 발송·생성에 실패하면 차감된 크레딧이 복구됩니다. 충전 시 무상으로 추가된 크레딧은 환불 대상이 아닙니다.</p>
      <h2 className="font-bold text-gray-900">데이터 보관</h2>
      <p>구독 종료 또는 탈퇴 후 리드 데이터는 내려받을 수 있도록 {PLAN.retentionDaysAfterEnd}일간 보관한 뒤 파기하며, 그 전에도 삭제를 요청할 수 있습니다.</p>
      <h2 className="font-bold text-gray-900">이용자의 책임</h2>
      <p>이용자는 랜딩페이지를 통해 수집하는 개인정보의 처리자로서 적법한 동의를 받아야 하며, 광고성 메시지는 별도 수신 동의를 받은 대상에게만 발송해야 합니다. 허위·과장 광고, 꾸며낸 후기·댓글 게시는 금지됩니다.</p>
    </main>
  );
}
