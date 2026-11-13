import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { PageHeader, Section, Tag } from "@/components/ui";
import { can } from "@/lib/accounts";
import { getCampaign, listRules, listStatuses, parsePixels, parseRecipients } from "@/lib/campaigns";
import { formatPhone } from "@/lib/crypto";
import { COST } from "@/lib/pricing";
import { requireCtx } from "@/lib/session";
import { saveCampaignAction, saveRuleAction, saveStatusAction } from "../../actions";

const delayLabel = (h: number) => (h === 0 ? "즉시" : h % 24 === 0 ? `${h / 24}일 후` : `${h}시간 후`);

export default async function CampaignDetail({ params }: PageProps<"/app/campaigns/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  const c = await getCampaign(ctx, id);
  if (!c) notFound();
  const editable = can(ctx, "automation.edit");
  const recipients = parseRecipients(c);
  const px = parsePixels(c);
  const statuses = await listStatuses(id);
  const rules = await listRules(id);
  const back = `/app/campaigns/${id}`;
  const statusLabel = (key: string) => (key === "submitted" ? "신청 접수" : statuses.find((s) => s.key === key)?.label ?? key);

  return (
    <>
      <PageHeader title={c.title} desc={`고객사: ${c.client_name}`}>
        <Link href={`/app/leads?campaign=${id}`} className="btn btn-ghost">리드 보기</Link>
        <Link href={`/app/analytics?campaign=${id}`} className="btn btn-ghost">성과 보기</Link>
      </PageHeader>
      <fieldset disabled={!editable} className="contents">
        <form action={saveCampaignAction}>
          <input type="hidden" name="id" value={id} />
          <Section title="기본 설정">
            <label className="label" htmlFor="title">캠페인 이름</label>
            <input id="title" name="title" defaultValue={c.title} className="input max-w-md" required />
          </Section>
          <Section title="신규 DB 알림 수신자 (최대 3명)" desc={`리드가 접수되면 알림톡(건당 ${COST.alimtalk}크레딧)과 메일(무료)로 통지합니다. 24시간 미처리 시 한 번 더 알립니다.`}>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-3">
                  <input name={`r${i}_name`} defaultValue={recipients[i]?.name ?? ""} className="input" placeholder={`담당자 ${i + 1} 이름`} aria-label={`담당자 ${i + 1} 이름`} />
                  <input name={`r${i}_phone`} defaultValue={recipients[i]?.phone ? formatPhone(recipients[i].phone) : ""} className="input" placeholder="휴대폰 번호" inputMode="numeric" aria-label={`담당자 ${i + 1} 휴대폰`} />
                  <input name={`r${i}_email`} defaultValue={recipients[i]?.email ?? ""} className="input" placeholder="이메일" type="email" aria-label={`담당자 ${i + 1} 이메일`} />
                </div>
              ))}
            </div>
            <div className="mt-4">
              <label className="label" htmlFor="sheetUrl">구글 시트 전달 (Apps Script 웹앱 URL)</label>
              <input id="sheetUrl" name="sheetUrl" defaultValue={c.sheet_webhook_url ?? ""} className="input" placeholder="https://script.google.com/macros/s/.../exec" />
              <p className="mt-1 text-xs text-gray-500">신규 리드가 JSON(POST)으로 전달됩니다. 시트의 Apps Script에서 doPost로 받아 행을 추가하세요.</p>
            </div>
          </Section>
          <Section title="광고 추적 ID" desc="발행된 랜딩에 픽셀이 연결되어 페이지 보기·콘텐츠 보기·신청 완료 이벤트를 전송합니다(플랫폼별 지원 범위 다름).">
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className="label" htmlFor="meta">메타 픽셀 ID</label><input id="meta" name="meta" defaultValue={px.meta ?? ""} className="input" placeholder="숫자 15~16자리" inputMode="numeric" /></div>
              <div><label className="label" htmlFor="ga4">GA4 측정 ID</label><input id="ga4" name="ga4" defaultValue={px.ga4 ?? ""} className="input" placeholder="G-XXXXXXXXXX" /></div>
              <div><label className="label" htmlFor="daangn">당근 추적 ID</label><input id="daangn" name="daangn" defaultValue={px.daangn ?? ""} className="input" /></div>
            </div>
          </Section>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="automationEnabled" defaultChecked={!!c.automation_enabled} className="h-4 w-4" /> 이 캠페인의 고객 메시지 자동화 사용</label>
            {editable && <SubmitButton>설정 저장</SubmitButton>}
          </div>
        </form>

        <Section title="리드 처리 상태" desc="상태 이름과 색상을 캠페인에 맞게 바꿀 수 있습니다. '광고주 변경 허용'을 끄면 광고주 화면에서 해당 상태로 바꿀 수 없습니다.">
          <ul className="space-y-2">
            {statuses.map((st) => (
              <li key={st.id}>
                <form action={saveStatusAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={st.id} /><input type="hidden" name="back" value={back} />
                  <input type="color" name="color" defaultValue={st.color} className="h-9 w-10 cursor-pointer rounded border border-gray-300 bg-white p-0.5" aria-label={`${st.label} 색상`} />
                  <input name="label" defaultValue={st.label} className="input !w-40" required aria-label="상태 이름" />
                  <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" name="clientEditable" defaultChecked={!!st.client_editable} /> 광고주 변경 허용</label>
                  {!!st.terminal && <Tag>종료 상태 · 자동화 중단</Tag>}
                  {editable && <SubmitButton className="btn btn-ghost btn-sm">저장</SubmitButton>}
                </form>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="후속 메시지 시나리오" desc={`상태와 경과 시간을 조건으로 고객에게 알림톡을 보냅니다(건당 ${COST.alimtalk}크레딧, 카카오톡 수신 불가 시 문자 대체). 상태가 바뀌면 미발송 예약은 자동 취소됩니다.`}>
          <ul className="space-y-3">
            {rules.map((r) => (
              <li key={r.id} className="rounded-lg border border-gray-200 p-3">
                <form action={saveRuleAction}>
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} />
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <b>{r.name}</b>
                      {r.purpose === "ad" ? <Tag tone="amber">광고성 · 수신 동의자만 · 야간 발송 제한</Tag> : <Tag tone="blue">정보성</Tag>}
                    </div>
                    <label className="flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" name="enabled" defaultChecked={!!r.enabled} className="h-4 w-4" /> 사용</label>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span>조건: <b>{statusLabel(r.trigger_key)}</b> 상태가 된 뒤</span>
                    {r.trigger_key === "submitted" ? <b>즉시</b> : (
                      <><input name="delayHours" type="number" min={0} max={8760} defaultValue={r.delay_hours} className="input !w-24 !py-1" aria-label="지연 시간(시간)" /><span>시간 후 ({delayLabel(r.delay_hours)})</span></>
                    )}
                  </div>
                  <textarea name="body" defaultValue={r.body} rows={2} className="input" required aria-label="메시지 내용" />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-gray-500">치환 변수: {"{이름}"}, {"{캠페인}"}</p>
                    {editable && <SubmitButton className="btn btn-ghost btn-sm">저장</SubmitButton>}
                  </div>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      </fieldset>
    </>
  );
}
