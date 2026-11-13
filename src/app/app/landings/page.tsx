import Link from "next/link";
import { CopyButton, SubmitButton } from "@/components/client";
import { Empty, LANDING_LABEL, MODE_LABEL, PageHeader, Section, Tag } from "@/components/ui";
import { can } from "@/lib/accounts";
import { listCampaigns } from "@/lib/campaigns";
import { listLandings } from "@/lib/landings";
import { KST, requireCtx } from "@/lib/session";
import { createLandingAction, duplicateLandingAction, landingStatusAction } from "../actions";

export default async function LandingsPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "landing.edit")) return <Empty title="접근 권한이 없습니다" />;
  const campaigns = await listCampaigns(ctx);
  const landings = await listLandings(ctx);
  return (
    <>
      <PageHeader title="랜딩페이지" desc="개수 제한 없이 만들고 발행할 수 있습니다." />
      {campaigns.length === 0 ? (
        <Empty title="먼저 캠페인을 만들어 주세요"><Link href="/app/campaigns" className="btn btn-primary">캠페인 만들기</Link></Empty>
      ) : (
        <Section title="랜딩 만들기" desc="이름만 입력하면 초안과 편집 화면이 만들어집니다.">
          <form action={createLandingAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className="label" htmlFor="l-name">페이지 이름</label><input id="l-name" name="name" className="input" required placeholder="예: 임플란트 무료 상담" /></div>
              <div><label className="label" htmlFor="l-camp">캠페인</label><select id="l-camp" name="campaignId" className="input">{campaigns.map((c) => <option key={c.id} value={c.id}>{c.client_name} · {c.title}</option>)}</select></div>
              <div><label className="label" htmlFor="l-mode">형식</label><select id="l-mode" name="mode" className="input" defaultValue="auto"><option value="auto">자동 빌더(기본형)</option><option value="card">카드뉴스형</option><option value="blog">블로그형</option></select></div>
            </div>
            <details className="rounded-lg bg-gray-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700">자동 빌더 입력(선택) — 핵심 내용을 적으면 섹션 구성을 자동으로 채웁니다</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input name="benefit" className="input sm:col-span-2" placeholder="한 줄 핵심 혜택 (예: 첫 상담 무료, 당일 예약 가능)" aria-label="핵심 혜택" />
                <input name="point1" className="input" placeholder="특징 1" aria-label="특징 1" />
                <input name="point2" className="input" placeholder="특징 2" aria-label="특징 2" />
                <input name="point3" className="input" placeholder="특징 3" aria-label="특징 3" />
              </div>
            </details>
            <SubmitButton>만들고 편집하기</SubmitButton>
          </form>
        </Section>
      )}
      {landings.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-100"><tr><th className="th">페이지</th><th className="th">캠페인</th><th className="th">형식</th><th className="th">상태</th><th className="th text-right">리드</th><th className="th">수정일</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {landings.map((l) => {
                const [label, tone] = LANDING_LABEL[l.status];
                return (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="td font-semibold"><Link href={`/app/landings/${l.id}`} className="hover:underline">{l.name}</Link></td>
                    <td className="td text-gray-600">{l.client_name} · {l.campaign_title}</td>
                    <td className="td text-gray-600">{MODE_LABEL[l.mode]}</td>
                    <td className="td"><Tag tone={tone}>{label}</Tag></td>
                    <td className="td text-right tabular-nums">{l.lead_count}</td>
                    <td className="td whitespace-nowrap text-gray-500">{KST(l.updated_at)}</td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1.5">
                        {l.status === "published" && <CopyButton text={`/p/${l.slug}`} label="URL 복사" />}
                        <Link href={`/app/landings/${l.id}`} className="btn btn-ghost btn-sm">편집</Link>
                        <form action={duplicateLandingAction}><input type="hidden" name="id" value={l.id} /><SubmitButton className="btn btn-ghost btn-sm">복제</SubmitButton></form>
                        {l.published_version_id && (
                          <form action={landingStatusAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value={l.status === "published" ? "paused" : "published"} /><SubmitButton className="btn btn-ghost btn-sm">{l.status === "published" ? "비공개" : "공개"}</SubmitButton></form>
                        )}
                        <form action={landingStatusAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="archived" /><SubmitButton className="btn btn-danger btn-sm" confirm="이 랜딩을 보관할까요? 공개가 중지됩니다. 리드는 유지됩니다.">보관</SubmitButton></form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
