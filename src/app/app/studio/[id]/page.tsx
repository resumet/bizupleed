import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { PlanEditor, StudioWorkspace } from "@/components/Studio";
import { Empty, PageHeader, Section, num } from "@/components/ui";
import { can, getSubscription } from "@/lib/accounts";
import { getWallet } from "@/lib/credits";
import { listLandings } from "@/lib/landings";
import { COST } from "@/lib/pricing";
import { requireCtx } from "@/lib/session";
import { getProject, imagesCost, inputOf, listPages, planCost, planOf, reviewOf } from "@/lib/studio-server";
import { runImagesAction, runPlanAction } from "../../actions";

export default async function StudioDetail({ params }: PageProps<"/app/studio/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  if (!can(ctx, "ai.use")) return <Empty title="접근 권한이 없습니다" />;
  const p = await getProject(ctx, id);
  if (!p) notFound();
  const input = inputOf(p);
  const plan = planOf(p);
  const pages = await listPages(ctx, id);
  const sub = await getSubscription(ctx.workspaceId);
  const wallet = await getWallet(ctx.workspaceId);
  const trial = sub.status === "trialing";
  const pCost = planCost(p.mode), iCost = imagesCost(p.mode);
  const priceText = (cost: number, freeLeft: number) => (cost === 0 ? "무료" : trial && freeLeft > 0 ? `체험 무료 (${freeLeft}회 남음)` : `${num(cost)}크레딧`);
  const planPrice = priceText(pCost, sub.free_plan_left);
  const imgPrice = priceText(iCost, sub.free_gen_left);

  return (
    <>
      <PageHeader title={p.name} desc={`${p.mode === "precise" ? "정밀" : "빠른"} 제작 · 보유 크레딧 ${num(wallet.total)}`}>
        <Link href="/app/studio" className="btn btn-ghost">← 목록</Link>
      </PageHeader>
      {p.status === "failed" && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">마지막 생성이 실패했습니다. 차감된 크레딧은 복구되었습니다. 다시 시도해 주세요.</p>}

      <Section title="① 입력 자료">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-gray-500">설명</dt><dd className="whitespace-pre-wrap">{input.description || "-"}</dd>
          <dt className="text-gray-500">상품 URL</dt><dd className="break-all">{input.productUrl || "-"}</dd>
          <dt className="text-gray-500">참고 URL</dt><dd className="break-all">{input.referenceUrl || "-"}</dd>
          <dt className="text-gray-500">사진</dt>
          <dd className="flex flex-wrap gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {input.photos.length ? input.photos.map((u) => <img key={u} src={u} alt="" className="h-12 w-12 rounded border border-gray-200 object-cover" />) : "-"}
          </dd>
        </dl>
      </Section>

      <Section
        title="② AI 기획서"
        desc={plan.length ? `${plan.length}개 장 · ${p.engine === "claude" ? "Claude 생성" : "규칙 기반 템플릿"} — 내용을 검토·수정한 뒤 이미지를 생성하세요.` : "자료를 바탕으로 장별 제목·본문을 구성합니다."}
        action={
          <form action={runPlanAction}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton className={plan.length ? "btn btn-ghost btn-sm" : "btn btn-primary"} pendingText="기획 중…" confirm={`기획서를 ${plan.length ? "다시 " : ""}생성합니다. 비용: ${planPrice}.${plan.length ? " 현재 기획서는 대체됩니다." : ""} 진행할까요?`}>
              {plan.length ? "다시 생성" : "기획서 생성"} · {planPrice}
            </SubmitButton>
          </form>
        }
      >
        {plan.length ? <PlanEditor key={p.updated_at} projectId={id} initial={plan} flags={reviewOf(p)} /> : <p className="text-sm text-gray-500">아직 기획서가 없습니다.</p>}
      </Section>

      {plan.length > 0 && (
        <Section
          title="③ 장별 이미지"
          desc={pages.length ? `${pages.length}장 · 채팅 수정은 장당 ${num(COST.pageRegenerate)}크레딧, 직접 수정과 이전 버전 복구는 무료입니다.` : "승인한 기획서로 장별 이미지를 만듭니다."}
          action={
            <form action={runImagesAction}>
              <input type="hidden" name="id" value={id} />
              <SubmitButton className={pages.length ? "btn btn-ghost btn-sm" : "btn btn-primary"} pendingText="생성 중…" confirm={`기획서 내용으로 이미지를 ${pages.length ? "처음부터 다시 " : ""}생성합니다. 비용: ${imgPrice}.${pages.length ? " 지금까지의 장별 수정·버전은 삭제됩니다." : ""} 진행할까요?`}>
                {pages.length ? "전체 다시 생성" : "이미지 생성"} · {imgPrice}
              </SubmitButton>
            </form>
          }
        >
          {pages.length ? (
            <StudioWorkspace projectId={id} name={p.name} pages={pages} photos={input.photos} regenCost={COST.pageRegenerate} balance={wallet.total}
              landings={can(ctx, "landing.edit") ? (await listLandings(ctx)).map((l) => ({ id: l.id, name: `${l.campaign_title} · ${l.name}` })) : []} />
          ) : <p className="text-sm text-gray-500">기획서를 저장한 뒤 이미지를 생성하세요.</p>}
        </Section>
      )}
    </>
  );
}
