import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoSelect, SubmitButton } from "@/components/client";
import { Badge, JOB_LABEL, PageHeader, Section, Tag } from "@/components/ui";
import { can, listMembers } from "@/lib/accounts";
import { listStatuses } from "@/lib/campaigns";
import { formatPhone } from "@/lib/crypto";
import { q } from "@/lib/db";
import { fieldsOf, getLead, listActivities, scopeOf, utmOf } from "@/lib/leads";
import { listJobs } from "@/lib/messaging";
import { KST, requireCtx } from "@/lib/session";
import { leadDeleteAction, leadFlagAction, leadMemoAction, leadOwnerAction, leadStatusAction } from "../../actions";

const EVENT_LABEL: Record<string, string> = { created: "접수", status: "상태 변경", memo: "메모", owner: "담당자 변경", flag: "표기" };
const KIND_LABEL: Record<string, string> = { customer: "고객", staff: "담당자 통지", reminder: "재알림", sheet: "시트 전달" };

export default async function LeadDetail({ params }: PageProps<"/app/leads/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  const lead = await getLead(scopeOf(ctx), id);
  if (!lead) notFound(); // 다른 고객사·워크스페이스의 리드는 존재하지 않는 것으로 처리
  const editable = can(ctx, "lead.edit");
  const statuses = await listStatuses(lead.campaign_id);
  const activities = await listActivities(id);
  const jobs = await listJobs(ctx.workspaceId, ctx.clientScope, { leadId: id });
  const members = ctx.role === "owner" ? await listMembers(ctx.workspaceId) : [];
  const consents = await q<{ kind: string; accepted_at: string; version: number }>(
    "SELECT lc.kind, lc.accepted_at, cv.version FROM lead_consents lc JOIN consent_versions cv ON cv.id=lc.consent_version_id WHERE lc.lead_id=?", id);
  const fields = Object.entries(fieldsOf(lead));
  const utm = Object.entries(utmOf(lead));
  const back = `/app/leads/${id}`;
  const hidden = (<><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} /></>);

  return (
    <>
      <PageHeader title={lead.name} desc={`${lead.client_name} · ${lead.campaign_title} · ${KST(lead.submitted_at)} 접수`}>
        <Link href="/app/leads" className="btn btn-ghost">← 목록</Link>
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <Section title="신청 정보">
            <dl className="grid grid-cols-[6.5rem_1fr] gap-y-2 text-sm">
              <dt className="text-gray-500">연락처</dt><dd className="font-semibold tabular-nums">{lead.phone ? <a href={`tel:${lead.phone}`} className="text-blue-700 hover:underline">{formatPhone(lead.phone)}</a> : "-"}</dd>
              <dt className="text-gray-500">이메일</dt><dd>{lead.email || "-"}</dd>
              {fields.map(([k, v]) => (<div key={k} className="contents"><dt className="text-gray-500">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>))}
              <dt className="text-gray-500">표기</dt>
              <dd className="flex flex-wrap gap-1.5">
                {lead.overdue && <Tag tone="red">24시간 미처리</Tag>}
                {lead.is_duplicate ? <Tag tone="amber">중복 연락처</Tag> : null}
                {lead.is_invalid ? <Tag>허수(불량 DB)</Tag> : null}
                {!lead.overdue && !lead.is_duplicate && !lead.is_invalid && "-"}
              </dd>
              <dt className="text-gray-500">동의</dt>
              <dd>{consents.map((c) => <span key={c.kind} className="mr-2 inline-block text-xs text-gray-600">{c.kind === "privacy" ? "개인정보 수집·이용" : "광고성 수신"} v{c.version} · {KST(c.accepted_at)}</span>)}{!consents.length && "-"}</dd>
            </dl>
          </Section>
          <Section title="유입 정보">
            <dl className="grid grid-cols-[6.5rem_1fr] gap-y-2 text-sm">
              <dt className="text-gray-500">랜딩</dt><dd>{lead.landing_name}</dd>
              <dt className="text-gray-500">출처 / 매체</dt><dd>{lead.source ?? "unknown"} / {lead.medium ?? "unknown"}</dd>
              <dt className="text-gray-500">기기</dt><dd>{lead.device ?? "-"}</dd>
              {utm.map(([k, v]) => (<div key={k} className="contents"><dt className="text-gray-500">{k}</dt><dd className="break-all">{v}</dd></div>))}
              <dt className="text-gray-500">리퍼러</dt><dd className="break-all text-gray-600">{lead.referrer || "-"}</dd>
            </dl>
          </Section>
          {editable && (
            <Section title="처리">
              <div className="space-y-3 text-sm">
                <form action={leadStatusAction} className="flex items-center gap-2">
                  {hidden}<input type="hidden" name="version" value={lead.version} />
                  <span className="w-16 shrink-0 font-semibold text-gray-600">상태</span>
                  <AutoSelect name="statusId" defaultValue={lead.status_id} ariaLabel="상태">{statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</AutoSelect>
                  <Badge color={lead.status_color}>{lead.status_label}</Badge>
                </form>
                {ctx.role === "owner" && (
                  <form action={leadOwnerAction} className="flex items-center gap-2">
                    {hidden}
                    <span className="w-16 shrink-0 font-semibold text-gray-600">담당자</span>
                    <AutoSelect name="ownerId" defaultValue={lead.owner_id ?? ""} ariaLabel="담당자"><option value="">미지정</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</AutoSelect>
                  </form>
                )}
                <div className="flex flex-wrap gap-2">
                  {(["is_duplicate", "is_invalid"] as const).map((flag) => (
                    <form key={flag} action={leadFlagAction}>
                      {hidden}<input type="hidden" name="flag" value={flag} /><input type="hidden" name="value" value={lead[flag] ? "0" : "1"} />
                      <SubmitButton className="btn btn-ghost btn-sm">{flag === "is_invalid" ? "허수" : "중복"} 표기 {lead[flag] ? "해제" : "설정"}</SubmitButton>
                    </form>
                  ))}
                  {ctx.role === "owner" && (
                    <form action={leadDeleteAction}>{hidden}<SubmitButton className="btn btn-danger btn-sm" confirm="이 리드의 개인정보와 상담 이력·예약 메시지를 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?">개인정보 삭제</SubmitButton></form>
                  )}
                </div>
                <p className="text-xs text-gray-500">허수로 표기하면 리드 수 집계와 자동 발송에서 제외됩니다.</p>
              </div>
            </Section>
          )}
        </div>
        <div>
          <Section title="상담 이력·메모">
            {editable && (
              <form action={leadMemoAction} className="mb-4 flex gap-2">
                {hidden}
                <textarea name="text" rows={2} className="input" placeholder="통화 결과, 다음 연락 일정 등 내부 메모" required aria-label="메모" />
                <SubmitButton className="btn btn-primary shrink-0 self-end">메모 저장</SubmitButton>
              </form>
            )}
            <ol className="space-y-3">
              {activities.map((a) => (
                <li key={a.id} className="border-l-2 border-gray-200 pl-3 text-sm">
                  <p className="text-xs text-gray-500">{KST(a.created_at)} · {a.actor_type === "client" ? "광고주" : a.actor_name ?? "시스템"} · {EVENT_LABEL[a.event_type] ?? a.event_type}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-gray-800">{a.event_type === "status" || a.event_type === "owner" ? `${a.old_value} → ${a.new_value}` : a.new_value}</p>
                </li>
              ))}
            </ol>
          </Section>
          <Section title="메시지 이력" desc="예약·발송·실패·대체 발송·취소 기록">
            {jobs.length === 0 ? <p className="text-sm text-gray-500">메시지 기록이 없습니다.</p> : (
              <ul className="divide-y divide-gray-100 text-sm">
                {jobs.map((j) => {
                  const [label, tone] = JOB_LABEL[j.status];
                  return (
                    <li key={j.id} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tag tone={tone}>{label}</Tag><b>{KIND_LABEL[j.kind]}</b>
                        <span className="text-xs text-gray-500">{j.channel === "alimtalk" ? "알림톡" : j.channel === "email" ? "메일" : "시트"} · {j.recipient_label} · {j.status === "scheduled" ? `${KST(j.scheduled_at)} 예정` : KST(j.updated_at)}{j.cost ? ` · ${j.cost}크레딧` : ""}</span>
                      </div>
                      {j.kind === "customer" && <p className="mt-1 text-xs text-gray-600">{j.body}</p>}
                      {j.last_error && <p className="mt-0.5 text-xs text-gray-500">사유: {j.last_error}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
