export const metadata = { title: "개인정보처리방침(초안) — 비즈업리드" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-7 text-gray-700">
      <h1 className="text-2xl font-extrabold text-gray-900">개인정보처리방침 (초안)</h1>
      <p className="rounded-lg bg-amber-50 p-3 text-amber-900">이 문서는 제품이 실제로 처리하는 항목을 요약한 초안입니다. 수탁자·국외 이전 고지를 포함해 서비스 공개 전 법률 검토가 필요합니다.</p>
      <h2 className="font-bold text-gray-900">회원 정보</h2>
      <p>가입 시 이름, 휴대폰 번호, 이메일, 비밀번호(복원할 수 없는 해시로 저장)를 수집하며 계정 운영과 알림 발송에 사용합니다.</p>
      <h2 className="font-bold text-gray-900">랜딩 방문자·신청자 정보</h2>
      <p>이용자(광고주·대행사)가 만든 신청 폼에 입력된 정보는 이용자의 위탁을 받아 처리합니다. 연락처는 암호화해 저장하고, 동의 문구의 버전과 동의 시각을 함께 기록합니다. 방문 분석에는 익명 방문자 식별자, 유입 출처, 기기 종류, 스크롤·클릭 이벤트만 사용하며 이름·연락처는 포함하지 않습니다. IP 주소는 방문 분석에 저장하지 않으며, 요청 제한을 위한 일시적 집계, 동의 증적(복원할 수 없는 해시), 광고주 공유 화면 접속 기록에만 사용합니다.</p>
      <h2 className="font-bold text-gray-900">외부 전송</h2>
      <p>이용자가 설정한 경우에 한해 알림 메시지 발송 업체, 구글 시트 웹훅, 광고 플랫폼 픽셀(메타·GA4·당근)로 정보가 전송됩니다. AI 기능을 사용하면 입력한 상품 자료와 랜딩 문구가 AI 모델 제공사(Anthropic)로 전송될 수 있으며, 신청자의 개인정보는 전송하지 않습니다.</p>
      <h2 className="font-bold text-gray-900">보관과 삭제</h2>
      <p>리드 정보는 이용자가 삭제하거나 구독 종료 후 보관 기간이 지나면 파기합니다. 신청자는 해당 랜딩 운영자에게 열람·삭제를 요청할 수 있습니다.</p>
    </main>
  );
}
