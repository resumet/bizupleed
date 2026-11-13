import Link from "next/link";
import { COST_LABELS, PLAN } from "@/lib/pricing";

const FEATURES: [string, string][] = [
  ["랜딩 빌더", "블로그형·카드뉴스형·자동 빌더로 모바일 랜딩을 코드 없이 만들고 개수 제한 없이 발행합니다."],
  ["신청 DB 수집", "필수 동의가 포함된 신청 폼으로 리드를 받고, 유입 매체·UTM과 함께 안전하게 저장합니다."],
  ["알림·후속 자동화", "접수 즉시 고객과 담당자에게 알리고, 상담 단계에 맞춰 후속 메시지를 예약합니다."],
  ["상담·DB 관리", "캠페인별 상태·메모·검색·엑셀 내보내기. 24시간 미처리 건은 따로 표시합니다."],
  ["광고주 전용 화면", "고객사별로 데이터를 분리하고, 비밀번호가 걸린 전용 화면으로 공유합니다."],
  ["퍼널 분석 · AI 개선", "5단계 전환 퍼널과 섹션 도달률을 추적하고, 이탈 구간의 개선안을 승인 후 적용합니다."],
  ["AI 상세페이지 작업실", "자료를 넣으면 기획서와 장별 이미지를 만들고, 채팅으로 원하는 장만 고칩니다."],
];

export default function Home() {
  return (
    <div className="bg-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
        <span className="text-lg font-extrabold tracking-tight">비즈업<span className="text-blue-600">리드</span></span>
        <nav className="flex items-center gap-2"><Link href="/login" className="btn btn-ghost">로그인</Link><Link href="/signup" className="btn btn-primary">무료 체험</Link></nav>
      </header>
      <main>
        <section className="mx-auto max-w-5xl px-5 pb-16 pt-12 text-center md:pt-20">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-gray-900 md:text-5xl">광고 클릭부터 상담·계약까지,<br />리드 운영을 한 곳에서</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-gray-600 md:text-lg">랜딩페이지 제작 → 상담 신청 DB → 자동 알림 → 상담 관리 → 성과 분석 → AI 개선. 흩어진 도구 대신 하나의 워크스페이스로 운영하세요.</p>
          <div className="mt-8 flex flex-col items-center gap-2">
            <Link href="/signup" className="btn btn-primary px-7 py-3.5 text-base">{PLAN.trialDays}일 무료로 시작하기</Link>
            <p className="text-sm text-gray-500">카드 등록 없이 시작 · 체험 후 자동 결제 없음</p>
          </div>
        </section>
        <section className="bg-gray-50 py-14">
          <div className="mx-auto grid max-w-5xl gap-4 px-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([t, d]) => (<div key={t} className="card p-5"><h2 className="font-bold text-gray-900">{t}</h2><p className="mt-2 text-sm leading-6 text-gray-600">{d}</p></div>))}
          </div>
        </section>
        <section className="mx-auto max-w-3xl px-5 py-14">
          <h2 className="text-center text-2xl font-extrabold">요금</h2>
          <div className="card mt-6 p-6">
            <p className="text-sm font-semibold text-gray-500">월 구독</p>
            <p className="mt-1 text-3xl font-extrabold">월 {PLAN.monthlyPrice.toLocaleString()}원 <span className="text-sm font-normal text-gray-500">VAT 포함 · 랜딩 무제한</span></p>
            <p className="mt-4 text-sm font-semibold text-gray-500">사용한 만큼 차감되는 크레딧 (1크레딧 = 1원, 충전 시 VAT 별도)</p>
            <table className="mt-2 w-full text-sm"><tbody className="divide-y divide-gray-100">{COST_LABELS.map(([l, c]) => <tr key={l}><td className="py-2">{l}</td><td className="py-2 text-right font-semibold tabular-nums">{c.toLocaleString()} 크레딧</td></tr>)}</tbody></table>
          </div>
        </section>
      </main>
      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-500">
        <Link href="/terms" className="underline">이용약관</Link> · <Link href="/privacy" className="underline">개인정보처리방침</Link>
      </footer>
    </div>
  );
}
