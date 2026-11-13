"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  activateSubscription, actorOf, addMember, AppError, cancelSubscription, Ctx, destroySession, removeMember, requireCan, Role,
} from "@/lib/accounts";
import { autoBuild } from "@/lib/ai";
import {
  createCampaign, createClient, createShareLink, revokeShareLink, rotateSharePassword, updateCampaignSettings, updateRule, updateStatus,
} from "@/lib/campaigns";
import { topup } from "@/lib/credits";
import { audit, newId, now, run } from "@/lib/db";
import { applySuggestion, createSuggestion, rejectSuggestion, revertSuggestion } from "@/lib/improve";
import { LandingContent, LandingMode, newSection } from "@/lib/landing";
import { contentOf, createLanding, duplicateLanding, getLanding, publishLanding, restoreVersionToDraft, saveLanding, setLandingStatus } from "@/lib/landings";
import { addMemo, assignOwner, changeLeadStatus, deleteLead, scopeOf, setLeadFlag } from "@/lib/leads";
import { tick } from "@/lib/messaging";
import { PLAN, TOPUP_OPTIONS } from "@/lib/pricing";
import { requireCtx, SESSION_COOKIE } from "@/lib/session";
import { Chapter, PageSpec } from "@/lib/studio";
import { createProject, editPageSpec, restorePageRevision, revisePages, runImages, runPlan, savePlan } from "@/lib/studio-server";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const on = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "1";

function withFlash(path: string, key: "ok" | "error", msg: string): string {
  const u = new URL(path, "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("error");
  u.searchParams.set(key, msg);
  return u.pathname + u.search;
}

/** 폼 액션 공통 처리: 인증 → 실행 → 결과 메시지와 함께 되돌아간다. 권한·범위 검증은 각 도메인 함수가 수행한다. */
async function go(fd: FormData, fallback: string, fn: (ctx: Ctx) => Promise<string | void> | string | void, okMsg = "저장되었습니다."): Promise<never> {
  const ctx = await requireCtx();
  const raw = s(fd, "back");
  const back = raw.startsWith("/app") && !raw.startsWith("//") ? raw : fallback;
  let dest: string;
  try {
    const r = await fn(ctx);
    dest = typeof r === "string" ? r : withFlash(back, "ok", okMsg);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    dest = withFlash(back, "error", e.message);
  }
  redirect(dest);
}

export async function logoutAction() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await destroySession(t);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

// ── 고객사·캠페인 ─────────────────────────────────────────
export async function createClientAction(fd: FormData) {
  await go(fd, "/app/clients", (ctx) => void createClient(ctx, s(fd, "name"), s(fd, "memo")), "고객사가 추가되었습니다.");
}

export async function createCampaignAction(fd: FormData) {
  await go(fd, "/app/campaigns", async (ctx) => `/app/campaigns/${await createCampaign(ctx, s(fd, "clientId"), s(fd, "title"))}`);
}

export async function saveCampaignAction(fd: FormData) {
  const id = s(fd, "id");
  await go(fd, `/app/campaigns/${id}`, async (ctx) =>
    await updateCampaignSettings(ctx, id, {
      title: s(fd, "title"),
      recipients: [0, 1, 2].map((i) => ({ name: s(fd, `r${i}_name`), phone: s(fd, `r${i}_phone`), email: s(fd, `r${i}_email`) })),
      sheetUrl: s(fd, "sheetUrl"),
      pixels: { meta: s(fd, "meta"), ga4: s(fd, "ga4"), daangn: s(fd, "daangn") },
      automationEnabled: on(fd, "automationEnabled"),
    }));
}

export async function saveStatusAction(fd: FormData) {
  await go(fd, "/app/campaigns", async (ctx) => await updateStatus(ctx, s(fd, "id"), s(fd, "label"), s(fd, "color"), on(fd, "clientEditable")));
}

export async function saveRuleAction(fd: FormData) {
  await go(fd, "/app/campaigns", async (ctx) => await updateRule(ctx, s(fd, "id"), { enabled: on(fd, "enabled"), body: s(fd, "body"), delayHours: Number(s(fd, "delayHours")) }));
}

export async function createShareAction(fd: FormData) {
  await go(fd, "/app/clients", (ctx) =>
    void createShareLink(ctx, s(fd, "clientId"), s(fd, "password"), {
      expiresDays: Number(s(fd, "expiresDays")) || 0, allowStatusChange: on(fd, "allowStatusChange"), allowExport: on(fd, "allowExport"), maskPhone: on(fd, "maskPhone"),
    }), "공유 링크가 만들어졌습니다.");
}

export async function revokeShareAction(fd: FormData) {
  await go(fd, "/app/clients", async (ctx) => await revokeShareLink(ctx, s(fd, "id")), "공유가 해지되었습니다.");
}

export async function rotateShareAction(fd: FormData) {
  await go(fd, "/app/clients", async (ctx) => await rotateSharePassword(ctx, s(fd, "id"), s(fd, "password")), "비밀번호가 교체되었습니다. 기존 접속은 모두 만료됩니다.");
}

// ── 랜딩 ────────────────────────────────────────────────
export async function createLandingAction(fd: FormData) {
  await go(fd, "/app/landings", async (ctx) => {
    const name = s(fd, "name");
    const mode = (s(fd, "mode") || "auto") as LandingMode;
    const points = [s(fd, "point1"), s(fd, "point2"), s(fd, "point3")];
    const auto = s(fd, "benefit") || points.some(Boolean);
    const id = await createLanding(ctx, s(fd, "campaignId"), name, mode, auto && name ? autoBuild(name, { benefit: s(fd, "benefit"), points, mode }) : undefined);
    return `/app/landings/${id}`;
  });
}

export async function duplicateLandingAction(fd: FormData) {
  await go(fd, "/app/landings", async (ctx) => `/app/landings/${await duplicateLanding(ctx, s(fd, "id"))}`);
}

export async function landingStatusAction(fd: FormData) {
  await go(fd, "/app/landings", async (ctx) => await setLandingStatus(ctx, s(fd, "id"), s(fd, "status") as "paused" | "archived" | "published"), "상태가 변경되었습니다.");
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function call<T extends object>(fn: (ctx: Ctx) => Promise<T | void> | T | void): Promise<Result<T>> {
  const ctx = await requireCtx();
  try {
    return { ok: true, ...((await fn(ctx)) as T) };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function saveLandingAction(id: string, content: LandingContent, mode: LandingMode) {
  return call(async (ctx) => await saveLanding(ctx, id, content, mode));
}

export async function publishLandingAction(id: string, content: LandingContent, mode: LandingMode) {
  return call(async (ctx) => {
    await saveLanding(ctx, id, content, mode);
    return await publishLanding(ctx, id);
  });
}

export async function restoreVersionAction(id: string, versionId: string) {
  return call(async (ctx) => {
    await restoreVersionToDraft(ctx, id, versionId);
    return { content: contentOf((await getLanding(ctx, id))!) };
  });
}

/** AI 작업실 결과 이미지를 랜딩 초안의 신청 폼 앞에 삽입한다(I-11). */
export async function appendImagesAction(landingId: string, urls: string[]) {
  return call(async (ctx) => {
    const l = await getLanding(ctx, landingId);
    if (!l) throw new AppError("랜딩을 찾을 수 없습니다.");
    const c = contentOf(l);
    const imgs = urls.filter((u) => /^\/uploads\/[\w.-]+$/.test(u)).slice(0, 20).map((src) => newSection("image", { src }, "fade"));
    const at = c.sections.findIndex((x) => x.type === "form");
    c.sections.splice(at < 0 ? c.sections.length : at, 0, ...imgs);
    await saveLanding(ctx, landingId, c);
    return { count: imgs.length };
  });
}

// ── 리드 ────────────────────────────────────────────────
export async function leadStatusAction(fd: FormData) {
  await go(fd, "/app/leads", async (ctx) => {
    requireCan(ctx, "lead.edit");
    await changeLeadStatus(scopeOf(ctx), actorOf(ctx), s(fd, "id"), s(fd, "statusId"), { expectedVersion: Number(s(fd, "version")) || undefined });
  }, "상태가 변경되었습니다.");
}

export async function leadMemoAction(fd: FormData) {
  await go(fd, "/app/leads", async (ctx) => {
    requireCan(ctx, "lead.edit");
    await addMemo(scopeOf(ctx), actorOf(ctx), s(fd, "id"), s(fd, "text"));
  }, "메모가 저장되었습니다.");
}

export async function leadOwnerAction(fd: FormData) {
  await go(fd, "/app/leads", async (ctx) => {
    requireCan(ctx, "lead.edit");
    await assignOwner(scopeOf(ctx), actorOf(ctx), s(fd, "id"), s(fd, "ownerId") || null);
  }, "담당자가 변경되었습니다.");
}

export async function leadFlagAction(fd: FormData) {
  await go(fd, "/app/leads", async (ctx) => {
    requireCan(ctx, "lead.edit");
    await setLeadFlag(scopeOf(ctx), actorOf(ctx), s(fd, "id"), s(fd, "flag") === "is_invalid" ? "is_invalid" : "is_duplicate", on(fd, "value"));
  });
}

export async function leadDeleteAction(fd: FormData) {
  await go(fd, "/app/leads", async (ctx) => {
    await deleteLead(ctx, s(fd, "id"));
    return "/app/leads?ok=" + encodeURIComponent("리드와 관련 기록이 삭제되었습니다.");
  });
}

export async function runTickAction(fd: FormData) {
  await go(fd, "/app/automation", async (ctx) => {
    requireCan(ctx, "automation.edit");
    await tick();
  }, "예약된 발송을 처리했습니다.");
}

// ── 설정·결제 ────────────────────────────────────────────
export async function memberAddAction(fd: FormData) {
  await go(fd, "/app/settings", async (ctx) =>
    await addMember(ctx, { name: s(fd, "name"), email: s(fd, "email"), password: s(fd, "password"), role: s(fd, "role") as Role, clientIds: fd.getAll("clientIds").map(String), canExport: on(fd, "canExport") }),
    "구성원이 추가되었습니다.");
}

export async function memberRemoveAction(fd: FormData) {
  await go(fd, "/app/settings", async (ctx) => await removeMember(ctx, s(fd, "id")), "구성원이 삭제되었습니다.");
}

// 결제는 PG 연동 전까지 모의 결제로 동작한다. 실제 연동 시 /api/webhooks/payment 로 대체한다.
function assertMockPayment() {
  if ((process.env.PAYMENT_PROVIDER ?? "mock") !== "mock") throw new AppError("결제 연동이 아직 구성되지 않았습니다.");
}

export async function subscribeAction(fd: FormData) {
  await go(fd, "/app/billing", async (ctx) => {
    requireCan(ctx, "billing.manage");
    assertMockPayment();
    await activateSubscription(ctx.workspaceId, newId("pay_"));
    await audit(ctx.workspaceId, { id: ctx.userId, name: ctx.userName }, "billing.subscribe", "subscription", ctx.workspaceId, { amount: PLAN.monthlyPrice, provider: "mock" });
  }, "구독이 활성화되었습니다(모의 결제).");
}

export async function cancelSubAction(fd: FormData) {
  await go(fd, "/app/billing", async (ctx) => {
    requireCan(ctx, "billing.manage");
    await cancelSubscription(ctx.workspaceId);
    await audit(ctx.workspaceId, { id: ctx.userId, name: ctx.userName }, "billing.cancel", "subscription", ctx.workspaceId);
  }, "해지 예약되었습니다. 남은 결제 기간까지 이용할 수 있습니다.");
}

export async function topupAction(fd: FormData) {
  await go(fd, "/app/billing", async (ctx) => {
    requireCan(ctx, "billing.manage");
    assertMockPayment();
    const opt = TOPUP_OPTIONS.find((o) => o.amount === Number(s(fd, "amount")));
    if (!opt) throw new AppError("충전 금액을 선택해 주세요.");
    const payId = newId("pay_");
    await run("INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?)", payId, ctx.workspaceId, "topup", opt.amount, Math.round(opt.amount * 0.1), "paid", "mock", "크레딧 충전", now());
    await topup(ctx.workspaceId, `pay:${payId}`, opt.amount, opt.bonus, ctx.userId);
  }, "크레딧이 충전되었습니다(모의 결제).");
}

// ── AI 개선 제안 ──────────────────────────────────────────
export async function createSuggestionAction(fd: FormData) {
  await go(fd, "/app/analytics", async (ctx) => void (await createSuggestion(ctx, s(fd, "landingId"), s(fd, "sectionId"))), "개선 제안이 생성되었습니다. 검토 후 승인하면 적용됩니다.");
}
export async function applySuggestionAction(fd: FormData) {
  await go(fd, "/app/analytics", async (ctx) => await applySuggestion(ctx, s(fd, "id")), "개선안이 적용되어 새 버전으로 발행되었습니다.");
}
export async function revertSuggestionAction(fd: FormData) {
  await go(fd, "/app/analytics", async (ctx) => await revertSuggestion(ctx, s(fd, "id")), "이전 상태로 되돌렸습니다.");
}
export async function rejectSuggestionAction(fd: FormData) {
  await go(fd, "/app/analytics", async (ctx) => await rejectSuggestion(ctx, s(fd, "id")), "제안을 거절했습니다.");
}

// ── AI 상세페이지 작업실 ───────────────────────────────────
export async function createProjectAction(fd: FormData) {
  await go(fd, "/app/studio", async (ctx) =>
    `/app/studio/${await createProject(ctx, {
      name: s(fd, "name"), mode: s(fd, "mode"), description: s(fd, "description"), productUrl: s(fd, "productUrl"), referenceUrl: s(fd, "referenceUrl"),
      photos: s(fd, "photos").split("\n").map((x) => x.trim()).filter(Boolean),
    })}`);
}

export async function runPlanAction(fd: FormData) {
  const id = s(fd, "id");
  await go(fd, `/app/studio/${id}`, async (ctx) => await runPlan(ctx, id), "기획서가 생성되었습니다. 내용을 검토·수정한 뒤 이미지를 생성하세요.");
}

export async function runImagesAction(fd: FormData) {
  const id = s(fd, "id");
  await go(fd, `/app/studio/${id}`, async (ctx) => await runImages(ctx, id), "장별 이미지가 생성되었습니다.");
}

export async function savePlanAction(id: string, chapters: Chapter[]) {
  return call(async (ctx) => await savePlan(ctx, id, chapters));
}
export async function revisePagesAction(id: string, pages: number[], instruction: string) {
  return call(async (ctx) => await revisePages(ctx, id, pages, instruction));
}
export async function editSpecAction(pageId: string, spec: PageSpec) {
  return call(async (ctx) => await editPageSpec(ctx, pageId, spec));
}
export async function restoreRevisionAction(pageId: string, revision: number) {
  return call(async (ctx) => await restorePageRevision(ctx, pageId, revision));
}
