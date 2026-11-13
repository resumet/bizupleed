import { audit, newId, now, one, parseJson, q, run, tx } from "./db";
import { AppError, Ctx, getSubscription, requireCan } from "./accounts";
import { charge, refund } from "./credits";
import { COST } from "./pricing";
import { generatePlan, PlanInput, reviewChapters, ReviewFlag, reviseSpec } from "./ai";
import { Chapter, PageLayout, PageSpec, specsFromChapters } from "./studio";
import { isHttpUrl } from "./net";

export type Project = {
  id: string; workspace_id: string; campaign_id: string | null; name: string; mode: "quick" | "precise"; input_json: string;
  plan_json: string | null; review_json: string | null; status: "draft" | "planned" | "generating" | "ready" | "failed";
  engine: string | null; last_error: string | null; created_at: string; updated_at: string;
};
export type PageView = { id: string; page_order: number; current_revision: number; spec: PageSpec; revisions: { revision: number; prompt: string | null; created_at: string }[] };

const UPLOAD_RE = /^\/uploads\/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/;
const actor = (ctx: Ctx) => ({ id: ctx.userId, name: ctx.userName });

export const listProjects = async (ctx: Ctx) => await q<Project>("SELECT * FROM ai_projects WHERE workspace_id=? ORDER BY updated_at DESC", ctx.workspaceId);
export const getProject = async (ctx: Ctx, id: string) => await one<Project>("SELECT * FROM ai_projects WHERE id=? AND workspace_id=?", id, ctx.workspaceId);
export const inputOf = (p: Project) => parseJson<PlanInput & { source?: string }>(p.input_json, { productName: p.name, description: "", productUrl: "", referenceUrl: "", photos: [] });
export const planOf = (p: Project) => parseJson<Chapter[]>(p.plan_json, []);
export const reviewOf = (p: Project) => parseJson<ReviewFlag[]>(p.review_json, []);

export async function createProject(ctx: Ctx, input: { name: string; mode: string; description: string; productUrl: string; referenceUrl: string; photos: string[] }): Promise<string> {
  requireCan(ctx, "ai.use");
  if (!input.name.trim()) throw new AppError("상품/서비스 이름을 입력해 주세요.");
  for (const u of [input.productUrl, input.referenceUrl]) if (u && !isHttpUrl(u)) throw new AppError("URL은 http(s):// 로 시작해야 합니다.");
  const id = newId("ap_");
  const data: PlanInput = {
    productName: input.name.trim(), description: input.description.trim().slice(0, 3000), productUrl: input.productUrl.trim(),
    referenceUrl: input.referenceUrl.trim(), photos: input.photos.filter((p) => UPLOAD_RE.test(p)).slice(0, 10),
  };
  await run("INSERT INTO ai_projects(id,workspace_id,name,mode,input_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    id, ctx.workspaceId, data.productName, input.mode === "precise" ? "precise" : "quick", JSON.stringify(data), now(), now());
  return id;
}

/** 체험 무료 혜택(I-12) 우선 적용, 없으면 크레딧 차감. 잔액 부족이면 실행하지 않는다(J-03). */
async function pay(ctx: Ctx, kind: "plan" | "gen", opId: string, cost: number, memo: string): Promise<{ free: boolean }> {
  return await tx(async () => {
    const sub = await getSubscription(ctx.workspaceId);
    const col = kind === "plan" ? "free_plan_left" : "free_gen_left";
    if (sub.status === "trialing" && sub[col] > 0) {
      // 조건부 차감: 동시 요청이 무료 횟수를 중복 사용하지 못한다.
      const used = await run(`UPDATE subscriptions SET ${col}=${col}-1 WHERE workspace_id=? AND ${col}>0`, ctx.workspaceId);
      if (used.changes === 1) return { free: true };
    }
    if (cost === 0) return { free: true };
    const r = await charge(ctx.workspaceId, opId, cost, memo, ctx.userId);
    if (!r.ok) throw new AppError(`크레딧이 부족합니다. 필요 ${cost.toLocaleString()} / 보유 ${r.balance.toLocaleString()}`);
    return { free: false };
  });
}

async function unpay(ctx: Ctx, kind: "plan" | "gen", opId: string, paid: { free: boolean }, cost: number) {
  if (paid.free) {
    if (cost > 0) await run(`UPDATE subscriptions SET ${kind === "plan" ? "free_plan_left" : "free_gen_left"}=${kind === "plan" ? "free_plan_left" : "free_gen_left"}+1 WHERE workspace_id=? AND status='trialing'`, ctx.workspaceId);
  } else await refund(ctx.workspaceId, opId, "생성 실패 크레딧 복구");
}

export const planCost = (mode: string) => (mode === "precise" ? COST.planPrecise : COST.planQuick);
export const imagesCost = (mode: string) => (mode === "precise" ? COST.imagesPrecise : 0);

export async function runPlan(ctx: Ctx, id: string) {
  requireCan(ctx, "ai.use");
  const p = await getProject(ctx, id);
  if (!p) throw new AppError("프로젝트를 찾을 수 없습니다.");
  const opId = `plan:${id}:${newId()}`;
  const cost = planCost(p.mode);
  const paid = await pay(ctx, "plan", opId, cost, p.mode === "precise" ? "정밀 상세페이지 기획" : "빠른 상세페이지 기획안");
  try {
    const input = inputOf(p);
    const { chapters, engine, source } = await generatePlan(input, p.mode);
    const basis = `${input.productName}\n${input.description}\n${source}`;
    await run("UPDATE ai_projects SET plan_json=?, review_json=?, input_json=?, status='planned', engine=?, last_error=NULL, updated_at=? WHERE id=?",
      JSON.stringify(chapters), JSON.stringify(reviewChapters(chapters, basis)), JSON.stringify({ ...input, source: source.slice(0, 6000) }), engine, now(), id);
    await audit(ctx.workspaceId, actor(ctx), "ai.plan", "ai_project", id, { engine, cost: paid.free ? 0 : cost, free: paid.free });
  } catch (e) {
    await unpay(ctx, "plan", opId, paid, cost);
    await run("UPDATE ai_projects SET status='failed', last_error=?, updated_at=? WHERE id=?", e instanceof Error ? e.message : "오류", now(), id);
    throw new AppError("기획서 생성에 실패했습니다. 차감된 크레딧은 복구되었습니다.");
  }
}

const LAYOUTS = ["hero", "text", "photo", "list", "cta"];

export async function savePlan(ctx: Ctx, id: string, chapters: Chapter[]) {
  requireCan(ctx, "ai.use");
  const p = await getProject(ctx, id);
  if (!p) throw new AppError("프로젝트를 찾을 수 없습니다.");
  const clean = chapters.slice(0, 12).map((c) => ({
    title: String(c.title ?? "").trim().slice(0, 80), body: String(c.body ?? "").trim().slice(0, 500),
    layout: (LAYOUTS.includes(c.layout) ? c.layout : "text") as PageLayout, visual: String(c.visual ?? "").slice(0, 100),
  })).filter((c) => c.title);
  if (!clean.length) throw new AppError("장이 하나 이상 필요합니다.");
  const input = inputOf(p);
  await run("UPDATE ai_projects SET plan_json=?, review_json=?, updated_at=? WHERE id=?",
    JSON.stringify(clean), JSON.stringify(reviewChapters(clean, `${input.productName}\n${input.description}\n${input.source ?? ""}`)), now(), id);
}

async function addRevision(ws: string, projectId: string, pageId: string, revision: number, spec: PageSpec, prompt: string | null, cost: number) {
  await run("INSERT INTO ai_page_versions VALUES (?,?,?,?,?,?,?,?,?)", newId("pv_"), ws, pageId, projectId, revision, JSON.stringify(spec), prompt, cost, now());
  await run("UPDATE ai_pages SET current_revision=? WHERE id=?", revision, pageId);
}

/** 운영자가 승인한 기획서로 장별 이미지를 생성한다(I-03). */
export async function runImages(ctx: Ctx, id: string) {
  requireCan(ctx, "ai.use");
  const p = await getProject(ctx, id);
  if (!p) throw new AppError("프로젝트를 찾을 수 없습니다.");
  const chapters = planOf(p);
  if (!chapters.length) throw new AppError("먼저 기획서를 생성해 주세요.");
  const opId = `images:${id}:${newId()}`;
  const cost = imagesCost(p.mode);
  const paid = cost > 0 ? await pay(ctx, "gen", opId, cost, "정밀 상세페이지 이미지 제작") : { free: true };
  try {
    await tx(async () => {
      await run("DELETE FROM ai_page_versions WHERE project_id=?", id);
      await run("DELETE FROM ai_pages WHERE project_id=?", id);
      for (const [i, spec] of specsFromChapters(chapters, inputOf(p).photos).entries()) {
        const pageId = newId("pg_");
        await run("INSERT INTO ai_pages VALUES (?,?,?,?,1)", pageId, ctx.workspaceId, id, i + 1);
        await addRevision(ctx.workspaceId, id, pageId, 1, spec, "최초 생성", 0);
      }
      await run("UPDATE ai_projects SET status='ready', last_error=NULL, updated_at=? WHERE id=?", now(), id);
    });
    await audit(ctx.workspaceId, actor(ctx), "ai.images", "ai_project", id, { cost: paid.free ? 0 : cost, free: paid.free, pages: chapters.length });
  } catch (e) {
    if (cost > 0) await unpay(ctx, "gen", opId, paid, cost);
    await run("UPDATE ai_projects SET status='failed', last_error=?, updated_at=? WHERE id=?", e instanceof Error ? e.message : "오류", now(), id);
    throw new AppError("이미지 생성에 실패했습니다. 차감된 크레딧은 복구되었습니다.");
  }
}

export async function listPages(ctx: Ctx, projectId: string): Promise<PageView[]> {
  if (!await getProject(ctx, projectId)) return [];
  const pages = await q<{ id: string; page_order: number; current_revision: number }>("SELECT id, page_order, current_revision FROM ai_pages WHERE project_id=? ORDER BY page_order", projectId);
  const versions = await q<{ page_id: string; revision: number; spec_json: string; prompt: string | null; created_at: string }>(
    "SELECT page_id, revision, spec_json, prompt, created_at FROM ai_page_versions WHERE project_id=? ORDER BY revision DESC", projectId);
  return pages.map((pg) => {
    const vs = versions.filter((v) => v.page_id === pg.id);
    const cur = vs.find((v) => v.revision === pg.current_revision) ?? vs[0];
    return { ...pg, spec: JSON.parse(cur.spec_json) as PageSpec, revisions: vs.map(({ revision, prompt, created_at }) => ({ revision, prompt, created_at })) };
  });
}

/** 지정한 장만 AI 재생성(장당 1,000크레딧). 다른 장에는 영향을 주지 않는다(I-07). */
export async function revisePages(ctx: Ctx, projectId: string, pageNumbers: number[], instruction: string): Promise<{ done: number[]; failed: { page: number; error: string }[] }> {
  requireCan(ctx, "ai.use");
  const pages = await listPages(ctx, projectId);
  if (!pages.length) throw new AppError("생성된 이미지가 없습니다.");
  if (!instruction.trim()) throw new AppError("수정 요청을 입력해 주세요.");
  const done: number[] = [];
  const failed: { page: number; error: string }[] = [];
  for (const n of [...new Set(pageNumbers)]) {
    const pg = pages.find((p) => p.page_order === n);
    if (!pg) continue;
    const opId = `revise:${pg.id}:${newId()}`;
    const c = await charge(ctx.workspaceId, opId, COST.pageRegenerate, `상세페이지 ${n}번 장 AI 재생성`, ctx.userId);
    if (!c.ok) { failed.push({ page: n, error: `크레딧 부족(보유 ${c.balance.toLocaleString()})` }); break; }
    try {
      const { spec } = await reviseSpec(pg.spec, instruction);
      const next = Math.max(...pg.revisions.map((r) => r.revision)) + 1;
      await tx(async () => await addRevision(ctx.workspaceId, projectId, pg.id, next, spec, instruction.slice(0, 500), COST.pageRegenerate));
      done.push(n);
    } catch (e) {
      await refund(ctx.workspaceId, opId, "재생성 실패 크레딧 복구");
      failed.push({ page: n, error: e instanceof Error ? e.message : "오류" });
    }
  }
  await run("UPDATE ai_projects SET updated_at=? WHERE id=?", now(), projectId);
  return { done, failed };
}

async function pageOf(ctx: Ctx, pageId: string) {
  return await one<{ id: string; project_id: string }>("SELECT id, project_id FROM ai_pages WHERE id=? AND workspace_id=?", pageId, ctx.workspaceId);
}

/** 텍스트·사진 직접 수정(I-10): 무료, 새 리비전으로 기록. */
export async function editPageSpec(ctx: Ctx, pageId: string, spec: PageSpec) {
  requireCan(ctx, "ai.use");
  const pg = await pageOf(ctx, pageId);
  if (!pg) throw new AppError("장을 찾을 수 없습니다.");
  const hex = (v: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
  const clean: PageSpec = {
    title: String(spec.title ?? "").slice(0, 80), body: String(spec.body ?? "").slice(0, 500), badge: String(spec.badge ?? "").slice(0, 30),
    highlight: String(spec.highlight ?? "").slice(0, 80), layout: (LAYOUTS.includes(spec.layout) ? spec.layout : "text") as PageLayout,
    bg: hex(spec.bg, "#ffffff"), bg2: hex(spec.bg2, "#f3f4f6"), fg: hex(spec.fg, "#111827"), accent: hex(spec.accent, "#2563eb"),
    photo: UPLOAD_RE.test(spec.photo) ? spec.photo : "", photoPos: spec.photoPos === "bottom" ? "bottom" : "top",
  };
  await tx(async () => {
    const max = (await one<{ m: number }>("SELECT MAX(revision) AS m FROM ai_page_versions WHERE page_id=?", pageId))!.m;
    await addRevision(ctx.workspaceId, pg.project_id, pageId, max + 1, clean, "직접 수정", 0);
  });
}

/** 이전 버전 복구(I-09): 무료. */
export async function restorePageRevision(ctx: Ctx, pageId: string, revision: number) {
  requireCan(ctx, "ai.use");
  const pg = await pageOf(ctx, pageId);
  if (!pg || !await one("SELECT 1 FROM ai_page_versions WHERE page_id=? AND revision=?", pageId, revision)) throw new AppError("버전을 찾을 수 없습니다.");
  await run("UPDATE ai_pages SET current_revision=? WHERE id=?", revision, pageId);
}
