import { SubmitButton } from "@/components/client";
import { Empty, PageHeader, Section, Tag } from "@/components/ui";
import { can, listMembers } from "@/lib/accounts";
import { listClients } from "@/lib/campaigns";
import { parseJson, q } from "@/lib/db";
import { KST, requireCtx } from "@/lib/session";
import { memberAddAction, memberRemoveAction } from "../actions";

const ROLE: Record<string, string> = { owner: "관리자", marketer: "마케터", agent: "상담 담당자" };
const ACTION: Record<string, string> = {
  "account.signup": "가입", "client.create": "고객사 생성", "campaign.create": "캠페인 생성", "campaign.settings": "캠페인 설정 변경", "landing.create": "랜딩 생성",
  "landing.publish": "랜딩 발행", "landing.paused": "랜딩 비공개", "landing.published": "랜딩 공개", "landing.archived": "랜딩 보관", "landing.restore_draft": "버전 불러오기",
  "lead.export": "리드 엑셀 내보내기", "lead.delete": "리드 개인정보 삭제", "member.add": "구성원 추가", "member.remove": "구성원 삭제",
  "share.create": "공유 링크 생성", "share.revoke": "공유 해지", "share.rotate_password": "공유 비밀번호 교체", "share.export": "광고주 엑셀 내려받기",
  "automation.rule.update": "시나리오 변경", "billing.subscribe": "구독 시작", "billing.cancel": "구독 해지", "improvement.apply": "AI 개선안 적용",
  "improvement.revert": "AI 개선안 되돌리기", "ai.plan": "AI 기획 생성", "ai.images": "AI 이미지 생성",
};

export default async function SettingsPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "member.manage")) return <Empty title="접근 권한이 없습니다" />;
  const members = await listMembers(ctx.workspaceId);
  const clients = await listClients(ctx);
  const logs = await q<{ id: string; actor_name: string | null; action: string; resource_id: string | null; meta_json: string | null; created_at: string }>(
    "SELECT * FROM audit_logs WHERE workspace_id=? ORDER BY created_at DESC, seq DESC LIMIT 80", ctx.workspaceId);
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  return (
    <>
      <PageHeader title="설정" desc={`${ctx.workspaceName} · ${ctx.email}`} />
      <Section title="구성원·권한" desc="직원 계정을 발급하고 고객사 단위로 접근 범위를 정합니다. 범위 밖 데이터는 서버에서 차단됩니다.">
        <ul className="mb-4 divide-y divide-gray-100 text-sm">
          {members.map((m) => {
            const scope = parseJson<string[] | null>(m.client_scope, null);
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{m.name}</b><span className="text-gray-500">{m.email}</span><Tag tone="blue">{ROLE[m.role]}</Tag>
                  {m.role !== "owner" && <span className="text-xs text-gray-500">{scope ? scope.map(clientName).join(", ") : "전체 고객사"}{m.can_export ? " · 엑셀 허용" : ""}</span>}
                </div>
                {m.role !== "owner" && <form action={memberRemoveAction}><input type="hidden" name="id" value={m.id} /><SubmitButton className="btn btn-danger btn-sm" confirm={`${m.name} 계정을 삭제할까요?`}>삭제</SubmitButton></form>}
              </li>
            );
          })}
        </ul>
        <form action={memberAddAction} className="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><label className="label" htmlFor="m-name">이름</label><input id="m-name" name="name" className="input" required /></div>
          <div><label className="label" htmlFor="m-email">이메일(로그인 ID)</label><input id="m-email" name="email" type="email" className="input" required autoComplete="off" /></div>
          <div><label className="label" htmlFor="m-pw">임시 비밀번호(8자 이상)</label><input id="m-pw" name="password" className="input" required minLength={8} autoComplete="off" /></div>
          <div><label className="label" htmlFor="m-role">역할</label><select id="m-role" name="role" className="input"><option value="marketer">마케터 — 랜딩 편집·리드·분석</option><option value="agent">상담 담당자 — 리드 조회·상태·메모</option></select></div>
          <fieldset className="sm:col-span-2 lg:col-span-3">
            <legend className="label">접근 가능한 고객사 (선택하지 않으면 전체)</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {clients.map((c) => <label key={c.id} className="flex items-center gap-1.5"><input type="checkbox" name="clientIds" value={c.id} /> {c.name}</label>)}
              {clients.length === 0 && <span className="text-gray-500">등록된 고객사가 없습니다.</span>}
            </div>
            <label className="mt-2 flex items-center gap-1.5 text-sm"><input type="checkbox" name="canExport" /> 마케터에게 리드 엑셀 내보내기 허용</label>
          </fieldset>
          <div className="flex items-end"><SubmitButton>구성원 추가</SubmitButton></div>
        </form>
      </Section>

      <Section title="개인정보 보호" desc="운영 정책 요약">
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>리드 연락처는 암호화해 저장하고, 검색·중복 판정에는 복원할 수 없는 해시만 사용합니다.</li>
          <li>동의 문구는 발행 시점마다 버전으로 보관되며 리드별 동의 시각·버전이 기록됩니다.</li>
          <li>리드 상세에서 개인정보 삭제 요청을 처리할 수 있습니다(관리자).</li>
          <li>엑셀 내보내기·공유·권한 변경은 아래 감사 기록에 남습니다.</li>
        </ul>
      </Section>

      <Section title="감사 기록" desc="최근 80건">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">일시</th><th className="th">수행자</th><th className="th">작업</th><th className="th">상세</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((l) => (<tr key={l.id}><td className="td whitespace-nowrap text-gray-500">{KST(l.created_at)}</td><td className="td">{l.actor_name ?? "-"}</td><td className="td">{ACTION[l.action] ?? l.action}</td><td className="td max-w-md truncate text-xs text-gray-500">{l.meta_json ?? ""}</td></tr>))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
