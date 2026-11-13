// 랜딩 콘텐츠 모델(서버·클라이언트 공용, Node 전용 모듈 import 금지)

export type LandingMode = "card" | "blog" | "auto";
export type FieldType = "text" | "phone" | "email" | "select" | "radio" | "checkbox" | "textarea" | "date";
export type SectionType = "notice" | "gallery" | "text" | "image" | "countdown" | "cta" | "form" | "reviews" | "chat";

export const FIELD_TYPES: { type: FieldType; label: string }[] = [
  { type: "text", label: "한 줄 글" },
  { type: "phone", label: "전화번호" },
  { type: "email", label: "이메일" },
  { type: "select", label: "선택(드롭다운)" },
  { type: "radio", label: "단일 선택" },
  { type: "checkbox", label: "복수 선택" },
  { type: "textarea", label: "긴 글" },
  { type: "date", label: "날짜" },
];

export const SECTION_TYPES: { type: SectionType; label: string }[] = [
  { type: "notice", label: "알림 띠" },
  { type: "gallery", label: "사진 모음" },
  { type: "text", label: "본문" },
  { type: "image", label: "이미지" },
  { type: "countdown", label: "카운트다운" },
  { type: "cta", label: "신청 버튼" },
  { type: "form", label: "신청 폼" },
  { type: "reviews", label: "후기" },
  { type: "chat", label: "채팅 버튼" },
];

export const ANIMATIONS = [
  ["none", "없음"], ["fade", "페이드"], ["up", "아래에서 위로"], ["down", "위에서 아래로"],
  ["left", "왼쪽에서"], ["right", "오른쪽에서"], ["zoom", "확대"], ["zoomout", "축소"],
  ["flip", "뒤집기"], ["bounce", "바운스"], ["blur", "흐림에서 선명"],
] as const;

export const BLOG_SKINS = [
  ["basic", "베이직"], ["naver", "네이버형"], ["tistory", "티스토리형"], ["brunch", "브런치형"],
] as const;

export type FormField = {
  id: string; key: string; label: string; type: FieldType; required: boolean;
  options?: string[]; placeholder?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Section = { id: string; type: SectionType; anim: string; props: Record<string, any> };

export type LandingContent = {
  settings: {
    title: string;
    themeColor: string;
    successMessage: string;
    blog: { skin: string; author: string; date: string; likes: number; comments: { name: string; text: string; date: string }[] };
    stickyBar: { enabled: boolean; text: string; button: string };
    sns: { kakao: string; instagram: string; youtube: string; blog: string };
    floating: { enabled: boolean; kind: "image" | "video"; src: string };
  };
  sections: Section[];
  form: {
    fields: FormField[];
    submitText: string;
    consentText: string;
    marketingEnabled: boolean;
    marketingText: string;
  };
};

export const rid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_CONSENT = `[개인정보 수집·이용 동의]
1. 수집 항목: 이름, 연락처 및 신청서에 입력한 정보
2. 수집·이용 목적: 상담 신청 접수 및 상담 안내
3. 보유 기간: 상담 완료 후 1년 또는 동의 철회 시까지
※ 동의를 거부할 권리가 있으며, 거부 시 상담 신청이 제한됩니다.`;

export const DEFAULT_MARKETING = "(선택) 이벤트·혜택 등 광고성 정보 수신(문자/카카오톡)에 동의합니다.";

export function defaultSectionProps(type: SectionType): Section["props"] {
  switch (type) {
    case "notice": return { text: "🔥 이번 주 한정! 무료 상담 신청 시 특별 혜택", bg: "#111827", color: "#ffffff" };
    case "gallery": return { images: [], layout: "slide" };
    case "text": return { title: "제목을 입력하세요", body: "본문 내용을 입력하세요.", align: "left" };
    case "image": return { src: "", alt: "" };
    case "countdown": return { title: "혜택 마감까지", deadline: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 16), endText: "마감되었습니다" };
    case "cta": return { text: "무료 상담 신청하기", sub: "30초면 신청 완료" };
    case "form": return { title: "무료 상담 신청", subtitle: "신청을 남겨주시면 담당자가 빠르게 연락드립니다." };
    case "reviews": return { title: "먼저 경험한 분들의 후기", items: [{ name: "김*영", text: "상담이 친절하고 빨라서 만족했어요.", rating: 5 }] };
    case "chat": return { label: "카카오톡 문의", url: "" };
  }
}

export const newSection = (type: SectionType, props?: Section["props"], anim = "up"): Section =>
  ({ id: rid(), type, anim: type === "notice" || type === "chat" ? "none" : anim, props: { ...defaultSectionProps(type), ...props } });

export function defaultContent(mode: LandingMode, name: string): LandingContent {
  const base: LandingContent = {
    settings: {
      title: name,
      themeColor: "#2563eb",
      successMessage: "신청이 접수되었습니다. 담당자가 곧 연락드리겠습니다.",
      blog: {
        // 댓글·공감 수는 실제 고객 반응만 등록하도록 기본값을 비워 둔다(허위 후기 방지).
        skin: "naver", author: "운영자", date: new Date().toISOString().slice(0, 10), likes: 0, comments: [],
      },
      stickyBar: { enabled: true, text: "지금 신청하면 무료 상담", button: "신청하기" },
      sns: { kakao: "", instagram: "", youtube: "", blog: "" },
      floating: { enabled: false, kind: "image", src: "" },
    },
    sections: [],
    form: {
      fields: [
        { id: rid(), key: "name", label: "이름", type: "text", required: true, placeholder: "홍길동" },
        { id: rid(), key: "phone", label: "연락처", type: "phone", required: true, placeholder: "010-0000-0000" },
      ],
      submitText: "무료 상담 신청하기",
      consentText: DEFAULT_CONSENT,
      marketingEnabled: false,
      marketingText: DEFAULT_MARKETING,
    },
  };
  if (mode === "card") {
    base.sections = [
      newSection("notice"),
      newSection("text", { title: name, body: "카드 이미지를 올려 한 장씩 넘겨 보는 랜딩을 만들어 보세요.", align: "center" }),
      newSection("gallery"),
      newSection("cta"),
      newSection("form"),
    ];
  } else if (mode === "blog") {
    base.sections = [
      newSection("text", { title: "", body: "안녕하세요. 오늘은 많은 분들이 궁금해하시는 내용을 정리해 보았습니다.\n\n직접 경험한 내용을 바탕으로 솔직하게 적어볼게요.", align: "left" }, "none"),
      newSection("image", {}, "fade"),
      newSection("text", { title: "이런 분들께 추천해요", body: "✔ 처음이라 어디서부터 알아봐야 할지 막막한 분\n✔ 비용이 걱정되는 분\n✔ 믿을 수 있는 곳을 찾는 분", align: "left" }, "none"),
      newSection("form"),
    ];
  } else {
    base.sections = [
      newSection("notice"),
      newSection("text", { title: name, body: "핵심 혜택을 한 문장으로 소개하세요.", align: "center" }),
      newSection("image"),
      newSection("reviews"),
      newSection("countdown"),
      newSection("form"),
    ];
  }
  return base;
}

export type PublishIssue = { level: "error" | "warning"; message: string };

/** 발행 전 검증(B-11). error 가 있으면 발행 불가. */
export function validateForPublish(c: LandingContent): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warning", message });
  if (!c.settings.title.trim()) err("페이지 제목이 비어 있습니다.");
  if (!c.sections.some((s) => s.type === "form")) err("신청 폼 섹션이 없습니다. 폼 섹션을 추가하세요.");
  if (!c.form.fields.length) err("신청 폼 입력 항목이 없습니다.");
  if (!c.form.fields.some((f) => (f.type === "phone" || f.type === "email") && f.required))
    err("연락 가능한 필수 항목(전화번호 또는 이메일)이 하나 이상 필요합니다.");
  if (!c.form.consentText.trim()) err("개인정보 수집·이용 동의 문구가 비어 있습니다.");
  if (c.form.marketingEnabled && !c.form.marketingText.trim()) err("광고성 정보 수신 동의 문구가 비어 있습니다.");
  const keys = new Set<string>();
  for (const f of c.form.fields) {
    if (!f.label.trim()) err("이름(라벨)이 비어 있는 입력 항목이 있습니다.");
    if (keys.has(f.key)) err(`입력 항목 키가 중복됩니다: ${f.key}`);
    keys.add(f.key);
    if (["select", "radio", "checkbox"].includes(f.type) && !(f.options ?? []).filter(Boolean).length)
      err(`'${f.label}' 항목에 선택지가 없습니다.`);
  }
  for (const s of c.sections) {
    if (s.type === "image" && !s.props.src) err("이미지가 지정되지 않은 이미지 섹션이 있습니다.");
    if (s.type === "gallery" && !(s.props.images ?? []).length) err("사진이 없는 사진 모음 섹션이 있습니다.");
    if (s.type === "chat" && !s.props.url) warn("채팅 버튼에 연결 URL이 없습니다.");
    if (s.type === "countdown" && new Date(s.props.deadline).getTime() < Date.now()) warn("카운트다운 마감 시각이 이미 지났습니다.");
    if (s.type === "text" && String(s.props.title ?? "").length > 40) warn("모바일에서 제목이 길게 줄바꿈될 수 있습니다(40자 초과).");
  }
  if (c.settings.floating.enabled && !c.settings.floating.src) warn("스크롤 추종 미디어의 주소가 비어 있습니다.");
  if (!c.form.fields.some((f) => f.key === "name")) warn("이름 항목(key: name)이 없어 리드 이름이 '이름 없음'으로 저장됩니다.");
  return issues;
}

export function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  return `${base || "page"}-${rid().slice(0, 6)}`;
}
