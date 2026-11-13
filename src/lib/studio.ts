// AI 상세페이지 장(이미지) 스펙과 SVG 렌더러 — 서버·클라이언트 공용(순수 함수)

export type PageLayout = "hero" | "text" | "photo" | "list" | "cta";
export type PageSpec = {
  title: string; body: string; badge: string; highlight: string; layout: PageLayout;
  bg: string; bg2: string; fg: string; accent: string; photo: string; photoPos: "top" | "bottom";
};
export type Chapter = { title: string; body: string; layout: PageLayout; visual: string };

export const PAGE_W = 720;
export const PAGE_H = 960;

export const PALETTES: Pick<PageSpec, "bg" | "bg2" | "fg" | "accent">[] = [
  { bg: "#0f172a", bg2: "#1e3a8a", fg: "#ffffff", accent: "#fbbf24" },
  { bg: "#ffffff", bg2: "#eff6ff", fg: "#0f172a", accent: "#2563eb" },
  { bg: "#fff7ed", bg2: "#ffedd5", fg: "#431407", accent: "#ea580c" },
  { bg: "#f0fdf4", bg2: "#dcfce7", fg: "#052e16", accent: "#16a34a" },
  { bg: "#faf5ff", bg2: "#ede9fe", fg: "#2e1065", accent: "#7c3aed" },
  { bg: "#111827", bg2: "#030712", fg: "#f9fafb", accent: "#f43f5e" },
];

export const COLOR_WORDS: Record<string, [string, string, string]> = {
  // 키워드 → [bg, bg2, fg]
  검정: ["#0b0b0f", "#1f2937", "#ffffff"], 검은: ["#0b0b0f", "#1f2937", "#ffffff"], 블랙: ["#0b0b0f", "#1f2937", "#ffffff"], 어둡: ["#0f172a", "#1e293b", "#ffffff"],
  흰: ["#ffffff", "#f3f4f6", "#111827"], 하얀: ["#ffffff", "#f3f4f6", "#111827"], 화이트: ["#ffffff", "#f3f4f6", "#111827"], 밝: ["#ffffff", "#f8fafc", "#111827"],
  파랑: ["#1d4ed8", "#1e3a8a", "#ffffff"], 파란: ["#1d4ed8", "#1e3a8a", "#ffffff"], 블루: ["#1d4ed8", "#1e3a8a", "#ffffff"], 남색: ["#1e1b4b", "#312e81", "#ffffff"],
  빨강: ["#b91c1c", "#7f1d1d", "#ffffff"], 빨간: ["#b91c1c", "#7f1d1d", "#ffffff"], 레드: ["#b91c1c", "#7f1d1d", "#ffffff"],
  초록: ["#15803d", "#14532d", "#ffffff"], 녹색: ["#15803d", "#14532d", "#ffffff"], 그린: ["#15803d", "#14532d", "#ffffff"],
  노랑: ["#fde047", "#facc15", "#1c1917"], 노란: ["#fde047", "#facc15", "#1c1917"], 옐로: ["#fde047", "#facc15", "#1c1917"],
  보라: ["#6d28d9", "#4c1d95", "#ffffff"], 퍼플: ["#6d28d9", "#4c1d95", "#ffffff"],
  분홍: ["#fce7f3", "#fbcfe8", "#831843"], 핑크: ["#fce7f3", "#fbcfe8", "#831843"],
  주황: ["#ea580c", "#c2410c", "#ffffff"], 오렌지: ["#ea580c", "#c2410c", "#ffffff"],
  베이지: ["#f5f0e6", "#ede4d3", "#3f2f1c"], 회색: ["#e5e7eb", "#d1d5db", "#111827"], 그레이: ["#e5e7eb", "#d1d5db", "#111827"],
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeColor = (c: string, d: string) => (/^#[0-9a-fA-F]{3,8}$/.test(c) ? c : d);
const unit = (ch: string) => (ch.charCodeAt(0) > 0x2e7f ? 1 : ch === " " ? 0.32 : 0.56);

/** 글자 폭 추정 기반 줄바꿈(한글 1, 영문·숫자 0.56). */
export function wrap(text: string, maxUnits: number, maxLines: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "", w = 0;
    for (const word of para.split(/(\s+)/)) {
      const ww = [...word].reduce((a, c) => a + unit(c), 0);
      if (w + ww > maxUnits && line.trim()) {
        out.push(line.trim());
        line = ""; w = 0;
        if (!word.trim()) continue;
      }
      if (ww > maxUnits) {
        for (const ch of word) {
          if (w + unit(ch) > maxUnits) { out.push(line); line = ""; w = 0; }
          line += ch; w += unit(ch);
        }
      } else { line += word; w += ww; }
    }
    if (line.trim() || !para) out.push(line.trim());
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/.$/, "…");
    return cut;
  }
  return out;
}

const tspans = (lines: string[], x: number, lh: number) =>
  lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${esc(l) || " "}</tspan>`).join("");

/** 장 스펙을 720×960 SVG 문자열로 렌더링한다. photoHref 는 data: URI 또는 같은 출처 URL. */
export function renderPageSvg(spec: PageSpec, photoHref?: string): string {
  const bg = safeColor(spec.bg, "#ffffff"), bg2 = safeColor(spec.bg2, bg), fg = safeColor(spec.fg, "#111827"), accent = safeColor(spec.accent, "#2563eb");
  const W = PAGE_W, H = PAGE_H, P = 56;
  const font = `font-family="'Pretendard','Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif"`;
  const photo = photoHref && (spec.layout === "photo" || spec.layout === "hero") ? photoHref : "";
  const center = spec.layout === "hero" || spec.layout === "cta";
  const x = center ? W / 2 : P;
  const anchor = center ? "middle" : "start";
  const parts: string[] = [];
  parts.push(`<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg2}"/></linearGradient><clipPath id="pc"><rect x="${P}" y="0" width="${W - P * 2}" height="400" rx="28"/></clipPath></defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#g)"/>`);
  parts.push(`<circle cx="${W - 40}" cy="60" r="150" fill="${accent}" opacity="0.10"/><circle cx="30" cy="${H - 30}" r="110" fill="${accent}" opacity="0.08"/>`);

  let y = 110;
  const photoH = 400;
  if (photo && spec.photoPos === "top") {
    parts.push(`<g transform="translate(0,${P})"><image href="${esc(photo)}" x="${P}" y="0" width="${W - P * 2}" height="${photoH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pc)"/></g>`);
    y = P + photoH + 80;
  } else if (spec.layout === "hero" && !photo) y = 300;
  else if (spec.layout === "cta") y = 280;

  if (spec.badge) {
    const bw = Math.min(W - P * 2, [...spec.badge].reduce((a, c) => a + unit(c), 0) * 24 + 44);
    const bx = center ? (W - bw) / 2 : P;
    parts.push(`<rect x="${bx}" y="${y - 34}" width="${bw}" height="46" rx="23" fill="${accent}"/><text x="${bx + bw / 2}" y="${y - 3}" text-anchor="middle" ${font} font-size="22" font-weight="700" fill="${bg}">${esc(spec.badge)}</text>`);
    y += 62;
  }

  const titleSize = spec.layout === "hero" ? 58 : 46;
  const tl = wrap(spec.title, ((W - P * 2) / titleSize) * 0.98, 4);
  parts.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" ${font} font-size="${titleSize}" font-weight="800" fill="${fg}">${tspans(tl, x, titleSize * 1.28)}</text>`);
  y += tl.length * titleSize * 1.28 + 4;

  if (spec.highlight) {
    const hl = wrap(spec.highlight, ((W - P * 2 - 40) / 28) * 0.98, 2);
    const hh = hl.length * 38 + 26;
    const hw = Math.min(W - P * 2, Math.max(...hl.map((l) => [...l].reduce((a, c) => a + unit(c), 0))) * 28 + 48);
    const hx = center ? (W - hw) / 2 : P;
    parts.push(`<rect x="${hx}" y="${y - 14}" width="${hw}" height="${hh}" rx="14" fill="${accent}" opacity="0.18"/><rect x="${hx}" y="${y - 14}" width="8" height="${hh}" rx="4" fill="${accent}"/>`);
    parts.push(`<text x="${center ? W / 2 : hx + 26}" y="${y + 24}" text-anchor="${anchor}" ${font} font-size="28" font-weight="700" fill="${fg}">${tspans(hl, center ? W / 2 : hx + 26, 38)}</text>`);
    y += hh + 22;
  }

  y += 22;
  const bottomLimit = photo && spec.photoPos === "bottom" ? H - photoH - P - 30 : spec.layout === "cta" ? H - 200 : H - 50;
  if (spec.layout === "list") {
    const items = spec.body.split(/\n+/).map((s) => s.replace(/^[-•✔✓\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 5);
    for (const it of items) {
      const il = wrap(it, ((W - P * 2 - 110) / 26) * 0.98, 2);
      const ih = il.length * 36 + 36;
      if (y + ih > bottomLimit) break;
      parts.push(`<rect x="${P}" y="${y}" width="${W - P * 2}" height="${ih}" rx="18" fill="${fg}" opacity="0.07"/><circle cx="${P + 38}" cy="${y + ih / 2}" r="15" fill="${accent}"/><path d="M${P + 31} ${y + ih / 2} l5 6 l9 -11" stroke="${bg}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(`<text x="${P + 72}" y="${y + 43}" ${font} font-size="26" font-weight="600" fill="${fg}">${tspans(il, P + 72, 36)}</text>`);
      y += ih + 16;
    }
  } else {
    const maxLines = Math.max(1, Math.floor((bottomLimit - y) / 42));
    const bl = wrap(spec.body, ((W - P * 2) / 27) * 0.98, maxLines);
    parts.push(`<text x="${x}" y="${y + 20}" text-anchor="${anchor}" ${font} font-size="27" fill="${fg}" opacity="0.86">${tspans(bl, x, 42)}</text>`);
    y += bl.length * 42 + 30;
  }

  if (spec.layout === "cta") {
    parts.push(`<rect x="${P + 40}" y="${H - 170}" width="${W - P * 2 - 80}" height="84" rx="42" fill="${accent}"/><text x="${W / 2}" y="${H - 117}" text-anchor="middle" ${font} font-size="30" font-weight="800" fill="${bg}">지금 무료 상담 신청하기 →</text>`);
  }
  if (photo && spec.photoPos === "bottom") {
    parts.push(`<g transform="translate(0,${H - photoH - P})"><image href="${esc(photo)}" x="${P}" y="0" width="${W - P * 2}" height="${photoH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pc)"/></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join("")}</svg>`;
}

export function specsFromChapters(chapters: Chapter[], photos: string[]): PageSpec[] {
  let pi = 0;
  return chapters.map((c, i) => {
    const pal = PALETTES[i === 0 ? 0 : i === chapters.length - 1 ? 5 : 1 + ((i - 1) % 4)];
    const usePhoto = (c.layout === "photo" || (c.layout === "hero" && i === 0)) && pi < photos.length;
    return {
      title: c.title, body: c.body, badge: i === 0 ? "" : `POINT ${String(i).padStart(2, "0")}`, highlight: "",
      layout: c.layout === "photo" && !usePhoto ? "text" : c.layout, ...pal, photo: usePhoto ? photos[pi++] : "", photoPos: "top",
    };
  });
}

/** 채팅 명령에서 대상 장 번호를 추출한다. "전체/모든" 이면 all=true (사용자 확인 필요). */
export function parseTargets(instruction: string, count: number): { pages: number[]; all: boolean } {
  if (/(전체|모든|모두|전부|다\s*바꿔)/.test(instruction)) return { pages: Array.from({ length: count }, (_, i) => i + 1), all: true };
  const pages = new Set<number>();
  for (const m of instruction.matchAll(/(\d+)\s*(?:번째\s*장|번\s*장|번째|번|장|페이지)/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= count) pages.add(n);
  }
  const ord = ["첫", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
  ord.forEach((w, i) => { if (new RegExp(`${w}\\s*번째`).test(instruction) && i < count) pages.add(i + 1); });
  if (/마지막/.test(instruction)) pages.add(count);
  return { pages: [...pages].sort((a, b) => a - b), all: false };
}
