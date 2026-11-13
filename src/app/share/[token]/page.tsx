import { AutoSelect, SubmitButton } from "@/components/client";
import { FunnelChart } from "@/components/charts";
import { Badge, Stat, Tag, num, pct } from "@/components/ui";
import { funnel, overview, parseRange } from "@/lib/analytics";
import { listStatuses } from "@/lib/campaigns";
import { formatPhone, maskPhone } from "@/lib/crypto";
import { one } from "@/lib/db";
import { listLeads } from "@/lib/leads";
import { KST } from "@/lib/session";
import { shareAccess } from "@/lib/share-session";
import { shareLoginAction, shareStatusAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "광고주 전용 화면 — 비즈업리드", robots: { index: false } };

export default async function SharePage({ params, searchParams }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const error = (await searchParams).error;
  const { link, authed } = await shareAccess(token);
  if (!link)
    return <Shell><p className="text-center text-sm text-gray-600">만료되었거나 해지된 공유 링크입니다. 담당 대행사에 문의해 주세요.</p></Shell>;
  if (!authed)
    return (
      <Shell>
        <h1 className="mb-1 text-lg font-extrabold">광고주 전용 화면</h1>
        <p className="mb-4 text-sm text-gray-500">전달받은 비밀번호를 입력해 주세요.</p>
        <form action={shareLoginAction} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input name="password" type="password" className="input" required autoFocus aria-label="비밀번호" autoComplete="off" />
          {typeof error === "string" && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
          <SubmitButton className="btn btn-primary w-full">확인</SubmitButton>
        </form>
      </Shell>
    );

  // 이 링크의 고객사 범위로만 조회한다.
  const scope = { workspaceId: link.workspace_id, clientIds: [link.client_id] };
  const client = (await one<{ name: string }>("SELECT name FROM clients WHERE id=?", link.client_id))!;
  // eslint-disable-next-line react-hooks/purity -- 요청 시점마다 렌더링되는 서버 컴포넌트
  const range = parseRange(new Date(Date.now() - 29 * 86400_000 + 9 * 3600_000).toISOString().slice(0, 10));
  const f = { scope, from: range.from, to: range.to };
  const o = await overview(f);
  const leads = await listLeads(scope, { limit: 300 });
  const statuses = new Map<string, Awaited<ReturnType<typeof listStatuses>>>();
  for (const l of leads) if (!statuses.has(l.campaign_id)) statuses.set(l.campaign_id, await listStatuses(l.campaign_id));

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div><p className="text-xs font-semibold text-blue-600">비즈업리드 · 광고주 전용</p><h1 className="text-xl font-extrabold">{client.name}</h1></div>
        {!!link.allow_export && <a href={`/api/share/${encodeURIComponent(token)}/export`} className="btn btn-ghost">엑셀 내려받기</a>}
      </header>
      {typeof error === "string" && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
      <p className="mb-2 text-xs text-gray-500">최근 30일 ({range.fromDay} ~ {range.toDay})</p>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="방문자" value={num(o.visitors)} />
        <Stat label="신규 DB" value={num(o.leads)} />
        <Stat label="전환율" value={pct(o.conversion)} sub="신청 세션 ÷ 방문 세션" />
        <Stat label="처리 대기" value={num(o.pending)} />
      </div>
      <section className="card mb-5 p-4"><h2 className="mb-3 text-sm font-bold">신청 퍼널</h2><FunnelChart steps={await funnel(f)} /></section>
      <section className="card overflow-x-auto">
        <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-bold">DB 목록 <span className="font-normal text-gray-500">· {leads.length}건{link.allow_status_change ? " · 상태를 바꾸면 대행사 화면에도 바로 반영됩니다" : " · 읽기 전용"}</span></h2>
        {leads.length === 0 ? <p className="p-4 text-sm text-gray-500">아직 접수된 DB가 없습니다.</p> : (
          <table className="w-full">
            <thead><tr><th className="th">신청일시</th><th className="th">이름</th><th className="th">연락처</th><th className="th">캠페인</th><th className="th">유입</th><th className="th">상태</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {leads.map((l) => (
                <tr key={l.id}>
                  <td className="td whitespace-nowrap text-gray-500">{KST(l.submitted_at)}</td>
                  <td className="td font-semibold">{l.name} {!!l.is_duplicate && <Tag tone="amber">중복</Tag>}</td>
                  <td className="td whitespace-nowrap tabular-nums">{l.phone ? (link.mask_phone ? maskPhone(l.phone) : formatPhone(l.phone)) : "-"}</td>
                  <td className="td text-gray-600">{l.campaign_title}</td>
                  <td className="td text-gray-600">{l.source ?? "unknown"}</td>
                  <td className="td">
                    {link.allow_status_change ? (
                      <form action={shareStatusAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="token" value={token} /><input type="hidden" name="id" value={l.id} />
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.status_color }} />
                        <AutoSelect name="statusId" defaultValue={l.status_id} className="input !w-32 !py-1" ariaLabel={`${l.name} 상태`}>
                          {(statuses.get(l.campaign_id) ?? []).filter((s) => s.client_editable || s.id === l.status_id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </AutoSelect>
                      </form>
                    ) : <Badge color={l.status_color}>{l.status_label}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center p-4"><div className="card w-full max-w-sm p-6">{children}</div></main>;
}
