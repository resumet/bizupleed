import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { PhotoUploader } from "@/components/Studio";
import { Empty, PageHeader, Section, Tag, num } from "@/components/ui";
import { can, getSubscription } from "@/lib/accounts";
import { aiEngine } from "@/lib/ai";
import { COST } from "@/lib/pricing";
import { KST, requireCtx } from "@/lib/session";
import { listProjects } from "@/lib/studio-server";
import { createProjectAction } from "../actions";

const STATUS: Record<string, [string, "gray" | "blue" | "green" | "red" | "amber"]> = { draft: ["자료 입력", "gray"], planned: ["기획 완료", "blue"], generating: ["생성 중", "amber"], ready: ["이미지 완료", "green"], failed: ["실패", "red"] };

export default async function StudioList() {
  const ctx = await requireCtx();
  if (!can(ctx, "ai.use")) return <Empty title="접근 권한이 없습니다" />;
  const projects = await listProjects(ctx);
  const sub = await getSubscription(ctx.workspaceId);
  return (
    <>
      <PageHeader title="AI 상세페이지 작업실" desc="자료 입력 → AI 기획서 → 검토·수정 → 장별 이미지 → 채팅 수정 → PNG 내보내기·랜딩 삽입" />
      <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        AI 엔진: <b>{aiEngine() === "claude" ? "Claude (연결됨)" : "규칙 기반 템플릿"}</b>
        {aiEngine() !== "claude" && " — 서버에 ANTHROPIC_API_KEY를 설정하면 Claude가 기획·수정·개선 제안을 생성합니다."}
        {" "}장 이미지는 사진 생성 모델이 아닌 디자인 템플릿(벡터)으로 만들어집니다.
        {sub.status === "trialing" && <> · 체험 무료 혜택: 기획 <b>{sub.free_plan_left}</b>회, 이미지 생성 <b>{sub.free_gen_left}</b>회 남음</>}
      </p>
      <Section title="새 상세페이지">
        <form action={createProjectAction} className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="p-name">상품/서비스 이름</label><input id="p-name" name="name" className="input" required /></div>
          <div>
            <label className="label" htmlFor="p-mode">제작 방식</label>
            <select id="p-mode" name="mode" className="input" defaultValue="quick">
              <option value="quick">빠른 제작 — 기획 {num(COST.planQuick)}크레딧 · 템플릿 이미지 포함</option>
              <option value="precise">정밀 제작 — 기획 {num(COST.planPrecise)} · 이미지 {num(COST.imagesPrecise)}크레딧 (상품 URL 분석)</option>
            </select>
          </div>
          <div className="sm:col-span-2"><label className="label" htmlFor="p-desc">상품 설명·강조할 내용 (AI가 이 자료를 우선합니다)</label><textarea id="p-desc" name="description" rows={3} className="input" placeholder="특징, 대상 고객, 실제 가격·혜택 등 확인된 사실을 적어 주세요." /></div>
          <div><label className="label" htmlFor="p-url">상품 URL (선택)</label><input id="p-url" name="productUrl" type="url" className="input" placeholder="https://" /></div>
          <div><label className="label" htmlFor="p-ref">참고 상세페이지 URL (선택)</label><input id="p-ref" name="referenceUrl" type="url" className="input" placeholder="https://" /></div>
          <div className="sm:col-span-2"><span className="label">상품 사진 (최대 10장, 없으면 템플릿 그래픽으로 구성)</span><PhotoUploader name="photos" /></div>
          <div><SubmitButton>프로젝트 만들기</SubmitButton></div>
        </form>
      </Section>
      {projects.length > 0 && (
        <div className="card divide-y divide-gray-100">
          {projects.map((p) => {
            const [label, tone] = STATUS[p.status];
            return (
              <Link key={p.id} href={`/app/studio/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-gray-50">
                <span><b>{p.name}</b> <span className="text-gray-500">· {p.mode === "precise" ? "정밀" : "빠른"} 제작</span></span>
                <span className="flex items-center gap-3"><Tag tone={tone}>{label}</Tag><span className="text-gray-500">{KST(p.updated_at)}</span></span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
