import { CopyButton, SubmitButton } from "@/components/client";
import { Empty, PageHeader, Section, Tag } from "@/components/ui";
import { can } from "@/lib/accounts";
import { listCampaigns, listClients, listShareLinks } from "@/lib/campaigns";
import { KST, requireCtx } from "@/lib/session";
import { createClientAction, createShareAction, revokeShareAction, rotateShareAction } from "../actions";

export default async function ClientsPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "client.manage")) return <Empty title="접근 권한이 없습니다" />;
  const clients = await listClients(ctx);
  const campaigns = await listCampaigns(ctx);
  const shares = await listShareLinks(ctx);
  return (
    <>
      <PageHeader title="고객사·공유" desc="광고주(고객사)별로 캠페인·리드·통계가 분리됩니다." />
      <Section title="고객사 추가">
        <form action={createClientAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1"><label className="label" htmlFor="c-name">고객사 이름</label><input id="c-name" name="name" className="input" required placeholder="예: OO치과" /></div>
          <div className="min-w-48 flex-[2]"><label className="label" htmlFor="c-memo">메모(선택)</label><input id="c-memo" name="memo" className="input" /></div>
          <SubmitButton>추가</SubmitButton>
        </form>
      </Section>

      {clients.length === 0 ? (
        <Empty title="등록된 고객사가 없습니다" desc="직접 운영하는 사업자라면 본인 사업체를 고객사로 한 곳 등록하면 됩니다." />
      ) : (
        <Section title={`고객사 ${clients.length}곳`}>
          <ul className="divide-y divide-gray-100">
            {clients.map((c) => {
              const cs = campaigns.filter((x) => x.client_id === c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div><b>{c.name}</b>{c.memo && <span className="ml-2 text-gray-500">{c.memo}</span>}</div>
                  <span className="text-gray-500">캠페인 {cs.length} · 리드 {cs.reduce((a, x) => a + x.lead_count, 0)}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {clients.length > 0 && (
        <Section title="광고주 전용 화면 공유" desc="전용 URL + 비밀번호로 해당 고객사의 리드와 성과만 볼 수 있습니다. 비밀번호 교체·만료·접속 기록을 지원합니다.">
          <form action={createShareAction} className="mb-5 grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="label" htmlFor="s-client">고객사</label><select id="s-client" name="clientId" className="input">{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label" htmlFor="s-pw">접속 비밀번호(6자 이상)</label><input id="s-pw" name="password" className="input" required minLength={6} autoComplete="off" /></div>
            <div><label className="label" htmlFor="s-exp">유효 기간</label><select id="s-exp" name="expiresDays" className="input" defaultValue="90"><option value="30">30일</option><option value="90">90일</option><option value="365">1년</option><option value="0">만료 없음</option></select></div>
            <div className="flex items-end"><SubmitButton>공유 링크 만들기</SubmitButton></div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm sm:col-span-2 lg:col-span-4">
              <label className="flex items-center gap-1.5"><input type="checkbox" name="allowStatusChange" defaultChecked /> 상태 변경 허용</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="allowExport" /> 엑셀 내려받기 허용</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="maskPhone" /> 연락처 일부 가리기</label>
            </div>
          </form>
          {shares.length === 0 ? <p className="text-sm text-gray-500">활성화된 공유 링크가 없습니다.</p> : (
            <ul className="space-y-3">
              {shares.map((sh) => (
                <li key={sh.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{sh.client_name}</b>
                      {sh.allow_status_change ? <Tag tone="blue">상태 변경</Tag> : <Tag>읽기 전용</Tag>}
                      {!!sh.allow_export && <Tag tone="blue">엑셀</Tag>}
                      {!!sh.mask_phone && <Tag>연락처 가림</Tag>}
                      {sh.expires_at && sh.expires_at < new Date().toISOString() ? <Tag tone="red">만료됨</Tag> : <span className="text-xs text-gray-500">만료 {sh.expires_at ? KST(sh.expires_at, false) : "없음"}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <CopyButton text={`/share/${sh.token}`} label="URL 복사" />
                      <form action={revokeShareAction}><input type="hidden" name="id" value={sh.id} /><SubmitButton className="btn btn-danger btn-sm" confirm="공유를 해지할까요? 광고주가 더 이상 접속할 수 없습니다.">해지</SubmitButton></form>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                    <span>접속 {sh.access_count}회 · 최근 {KST(sh.last_access)}</span>
                    <form action={rotateShareAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={sh.id} />
                      <input name="password" className="input !w-40 !py-1 text-xs" placeholder="새 비밀번호" minLength={6} required aria-label="새 비밀번호" autoComplete="off" />
                      <SubmitButton className="btn btn-ghost btn-sm">비밀번호 교체</SubmitButton>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}
