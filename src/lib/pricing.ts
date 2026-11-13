/** 요금·크레딧 정책 상수. 1크레딧 = 1원(충전 시 VAT 별도). */
export const PLAN = {
  monthlyPrice: 9900, // VAT 포함
  trialDays: 14,
  retentionDaysAfterEnd: 30, // 구독 종료/탈퇴 후 리드 보관 기간
};

export const COST = {
  planPrecise: 5000,
  imagesPrecise: 25000,
  pageRegenerate: 1000,
  planQuick: 500,
  aiPhoto: 300,
  alimtalk: 30,
  sms: 30, // 대체 발송 단가(원본 PRD 미공개 → 알림톡과 동일하게 가정)
  improvement: 300,
} as const;

export const COST_LABELS: [string, number][] = [
  ["정밀 상세페이지 기획", COST.planPrecise],
  ["정밀 상세페이지 이미지 제작", COST.imagesPrecise],
  ["상세페이지 1장 AI 재생성", COST.pageRegenerate],
  ["빠른 상세페이지 기획안", COST.planQuick],
  ["카카오 알림톡 1건", COST.alimtalk],
  ["문자 대체 발송 1건", COST.sms],
  ["AI 이탈 개선 제안 1건", COST.improvement],
];

export const TOPUP_OPTIONS = [
  { amount: 10000, bonus: 0 },
  { amount: 30000, bonus: 1500 },
  { amount: 50000, bonus: 4000 },
  { amount: 100000, bonus: 10000 },
];

/** 크레딧 유효기간: 약관 기준(마지막 충전일로부터 5년)을 단일 정책으로 채택. */
export const CREDIT_VALID_YEARS = 5;

export const MAX_NOTIFY_RECIPIENTS = 3;
export const IMPROVEMENT_MIN_VISITORS = 50;
