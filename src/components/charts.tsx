import { num, pct } from "./ui";

// 차트 원칙: 단일 계열은 한 가지 색(범례 없음, 제목이 계열을 설명), 축은 하나,
// 얇은 막대 + 2px 간격 + 데이터 쪽 끝만 둥글게, 값 텍스트는 본문 잉크색, 막대별 hover 툴팁(<title>).
const HUE = "#2563eb";

/** 5단계 퍼널: 가로 막대 + 단계 전환율. */
export function FunnelChart({ steps }: { steps: { label: string; count: number }[] }) {
  const max = Math.max(1, steps[0]?.count ?? 0, ...steps.map((s) => s.count));
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].count : null;
        return (
          <li key={s.label} className="grid grid-cols-[5.5rem_1fr_7.5rem] items-center gap-3 text-sm">
            <span className="font-semibold text-gray-700">{i + 1}. {s.label}</span>
            <div className="h-5 rounded-r bg-gray-100" title={`${s.label}: ${num(s.count)} 세션`}>
              <div className="h-5 rounded-r" style={{ width: `${(s.count / max) * 100}%`, background: HUE, minWidth: s.count ? 3 : 0 }} />
            </div>
            <span className="text-right tabular-nums text-gray-900">
              <b>{num(s.count)}</b>
              <span className="ml-1.5 text-xs text-gray-500">{prev === null ? "" : prev ? `↓ ${pct(s.count / prev, 0)}` : "–"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** 날짜별 단일 계열 막대(방문자·신청은 척도가 달라 이중축 대신 각각 그린다). */
export function DailyBars({ title, data, color = HUE }: { title: string; data: { day: string; value: number }[]; color?: string }) {
  const W = 640, H = 120, padL = 30, padB = 18, padT = 6;
  const max = Math.max(1, ...data.map((d) => d.value));
  const top = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const bw = (W - padL) / Math.max(1, data.length);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const total = data.reduce((a, d) => a + d.value, 0);
  const labelEvery = Math.ceil(data.length / 7);
  return (
    <figure>
      <figcaption className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold text-gray-700">{title}</span>
        <span className="tabular-nums text-gray-500">기간 합계 {num(total)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${title} 날짜별 막대 차트, 합계 ${total}`}>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padL - 5} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#6b7280">{Number.isInteger(v) ? v : v.toFixed(1)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = y(0) - y(d.value);
          const w = Math.max(2, Math.min(22, bw - 2));
          const x = padL + i * bw + (bw - w) / 2;
          const r = Math.min(3, h, w / 2);
          return (
            <g key={d.day}>
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent"><title>{`${d.day} · ${title} ${num(d.value)}`}</title></rect>
              {d.value > 0 && <path d={`M${x} ${y(0)} V${y(d.value) + r} Q${x} ${y(d.value)} ${x + r} ${y(d.value)} H${x + w - r} Q${x + w} ${y(d.value)} ${x + w} ${y(d.value) + r} V${y(0)} Z`} fill={color} pointerEvents="none" />}
              {i % labelEvery === 0 && <text x={padL + i * bw + bw / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="#6b7280">{d.day.slice(5).replace("-", "/")}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** 비율 막대 목록(채널·기기·섹션 도달). */
export function BarList({ rows, unit = "" }: { rows: { label: string; value: number; sub?: string; mark?: boolean }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm" title={`${r.label}: ${num(Math.round(r.value * 10) / 10)}${unit}`}>
          <span className={`truncate ${r.mark ? "font-bold text-red-600" : "text-gray-700"}`}>{r.mark && "⚠ "}{r.label}</span>
          <div className="h-3.5 rounded-r bg-gray-100"><div className="h-3.5 rounded-r" style={{ width: `${(r.value / max) * 100}%`, background: HUE, minWidth: r.value ? 3 : 0 }} /></div>
          <span className="tabular-nums text-gray-900">{num(Math.round(r.value * 10) / 10)}{unit}{r.sub && <span className="ml-1.5 text-xs text-gray-500">{r.sub}</span>}</span>
        </li>
      ))}
    </ul>
  );
}
