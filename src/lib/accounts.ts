import { audit, hoursFromNow, newId, now, one, parseJson, q, run, tx } from "./db";
import { hashPassword, isValidEmail, isValidPhone, normalizePhone, randomToken, sha256, verifyPassword } from "./crypto";
import { PLAN } from "./pricing";

export type Role = "owner" | "marketer" | "agent";
export type SubStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";

export type Ctx = {
  userId: string;
  userName: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  /** null = 전체 고객사 접근 */
  clientScope: string[] | null;
  canExport: boolean;
};

export type Subscription = {
  workspace_id: string; status: SubStatus; trial_end: string; current_period_end: string | null;
  cancel_at_period_end: number; free_plan_left: number; free_gen_left: number; ended_at: string | null;
};

export class AppError extends Error {}

export async function signup(input: { name: string; phone: string; email: string; password: string; agree: boolean }) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = normalizePhone(input.phone);
  if (name.length < 2) throw new AppError("이름을 정확히 입력해 주세요.");
  if (!isValidPhone(phone)) throw new AppError("휴대폰 번호를 정확히 입력해 주세요.");
  if (!isValidEmail(email)) throw new AppError("이메일 형식이 올바르지 않습니다.");
  if (input.password.length < 8) throw new AppError("비밀번호는 8자 이상이어야 합니다.");
  if (!input.agree) throw new AppError("이용약관 및 개인정보처리방침에 동의해 주세요.");
  return await tx(async () => {
    if (await one("SELECT 1 FROM users WHERE email=?", email)) throw new AppError("이미 가입된 이메일입니다.");
    const userId = newId("u_");
    const wsId = newId("ws_");
    const t = now();
    await run("INSERT INTO users(id,email,phone,name,password_hash,terms_agreed_at,created_at) VALUES (?,?,?,?,?,?,?)", userId, email, phone, name, hashPassword(input.password), t, t);
    await run("INSERT INTO workspaces VALUES (?,?,?,?)", wsId, userId, `${name}의 워크스페이스`, t);
    await run("INSERT INTO memberships VALUES (?,?,?,?,?,?,?)", newId("m_"), wsId, userId, "owner", null, 1, t);
    await run(
      "INSERT INTO subscriptions(workspace_id,status,trial_end,updated_at) VALUES (?,?,?,?)",
      wsId, "trialing", hoursFromNow(24 * PLAN.trialDays), t,
    );
    await run("INSERT INTO credit_wallets(workspace_id) VALUES (?)", wsId);
    await audit(wsId, { id: userId, name }, "account.signup", "user", userId);
    return { userId, workspaceId: wsId };
  });
}

export async function login(emailRaw: string, password: string): Promise<{ token: string }> {
  const email = emailRaw.trim().toLowerCase();
  const u = await one<{ id: string; password_hash: string; status: string }>("SELECT * FROM users WHERE email=?", email);
  if (!u || u.status !== "active" || !verifyPassword(password, u.password_hash)) throw new AppError("이메일 또는 비밀번호가 올바르지 않습니다.");
  const m = await one<{ workspace_id: string }>("SELECT workspace_id FROM memberships WHERE user_id=? ORDER BY created_at LIMIT 1", u.id);
  if (!m) throw new AppError("소속된 워크스페이스가 없습니다.");
  return { token: await createSession(u.id, m.workspace_id) };
}

export async function createSession(userId: string, workspaceId: string): Promise<string> {
  const token = randomToken();
  await run("INSERT INTO sessions VALUES (?,?,?,?,?)", sha256(token), userId, workspaceId, hoursFromNow(24 * 14), now());
  return token;
}

export async function destroySession(token: string) {
  await run("DELETE FROM sessions WHERE token_hash=?", sha256(token));
}

export async function ctxFromToken(token: string | undefined): Promise<Ctx | null> {
  if (!token) return null;
  const r = await one<{
    user_id: string; workspace_id: string; expires_at: string; name: string; email: string; status: string;
    ws_name: string; role: Role; client_scope: string | null; can_export: number;
  }>(
    `SELECT s.user_id, s.workspace_id, s.expires_at, u.name, u.email, u.status, w.name AS ws_name,
            m.role, m.client_scope, m.can_export
       FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=s.workspace_id
       JOIN memberships m ON m.workspace_id=s.workspace_id AND m.user_id=s.user_id
      WHERE s.token_hash=?`,
    sha256(token),
  );
  if (!r || r.status !== "active" || r.expires_at < now()) return null;
  return {
    userId: r.user_id, userName: r.name, email: r.email, workspaceId: r.workspace_id, workspaceName: r.ws_name,
    role: r.role, clientScope: r.role === "owner" ? null : parseJson<string[] | null>(r.client_scope, null),
    canExport: r.role === "owner" || !!r.can_export,
  };
}

/** 구독 상태를 시각 기준으로 재평가한다. 체험 만료 시 자동 결제하지 않고 공개만 중지한다(A-03). */
export async function getSubscription(ws: string): Promise<Subscription> {
  const s = (await one<Subscription>("SELECT * FROM subscriptions WHERE workspace_id=?", ws))!;
  const t = now();
  let next: SubStatus | null = null;
  if (s.status === "trialing" && s.trial_end < t) next = "suspended";
  else if (s.status === "active" && s.current_period_end && s.current_period_end < t)
    next = s.cancel_at_period_end ? "cancelled" : "past_due";
  if (next) {
    await run("UPDATE subscriptions SET status=?, ended_at=COALESCE(ended_at,?), updated_at=? WHERE workspace_id=?", next, t, t, ws);
    return { ...s, status: next, ended_at: s.ended_at ?? t };
  }
  return s;
}

/** 랜딩 외부 공개 가능 여부: 체험 중이거나 유료 구독 활성 상태. */
export async function isServing(ws: string): Promise<boolean> {
  const s = (await getSubscription(ws)).status;
  return s === "trialing" || s === "active";
}

/** 구독 결제 성공 처리(결제 웹훅/모의 결제에서 호출). */
export async function activateSubscription(ws: string, paymentId: string) {
  await tx(async () => {
    if (await one("SELECT 1 FROM payments WHERE id=?", paymentId)) return;
    const s = await getSubscription(ws);
    const base = s.status === "active" && s.current_period_end && s.current_period_end > now() ? new Date(s.current_period_end).getTime() : Date.now();
    await run("INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?)", paymentId, ws, "subscription", PLAN.monthlyPrice, 0, "paid", "mock", "월 구독", now());
    await run(
      "UPDATE subscriptions SET status='active', current_period_end=?, cancel_at_period_end=0, ended_at=NULL, updated_at=? WHERE workspace_id=?",
      hoursFromNow(24 * 30, base), now(), ws,
    );
  });
}

export async function cancelSubscription(ws: string) {
  await run("UPDATE subscriptions SET cancel_at_period_end=1, updated_at=? WHERE workspace_id=? AND status='active'", now(), ws);
}

export async function markPaymentFailed(ws: string) {
  await run("UPDATE subscriptions SET status='past_due', ended_at=COALESCE(ended_at,?), updated_at=? WHERE workspace_id=?", now(), now(), ws);
}

export type Member = { id: string; user_id: string; name: string; email: string; role: Role; client_scope: string | null; can_export: number };

export async function listMembers(ws: string): Promise<Member[]> {
  return await q<Member>(
    "SELECT m.id, m.user_id, u.name, u.email, m.role, m.client_scope, m.can_export FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at",
    ws,
  );
}

/** 소유자가 직원 계정을 발급한다(임시 비밀번호). */
export async function addMember(ctx: Ctx, input: { name: string; email: string; password: string; role: Role; clientIds: string[]; canExport: boolean }) {
  if (ctx.role !== "owner") throw new AppError("권한이 없습니다.");
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) throw new AppError("이메일 형식이 올바르지 않습니다.");
  if (input.password.length < 8) throw new AppError("비밀번호는 8자 이상이어야 합니다.");
  if (!["marketer", "agent"].includes(input.role)) throw new AppError("역할이 올바르지 않습니다.");
  const valid = (await q<{ id: string }>("SELECT id FROM clients WHERE workspace_id=?", ctx.workspaceId)).map((c) => c.id);
  const scope = input.clientIds.filter((c) => valid.includes(c));
  await tx(async () => {
    if (await one("SELECT 1 FROM users WHERE email=?", email)) throw new AppError("이미 가입된 이메일입니다.");
    const uid = newId("u_");
    await run("INSERT INTO users(id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)", uid, email, input.name.trim() || email, hashPassword(input.password), now());
    await run("INSERT INTO memberships VALUES (?,?,?,?,?,?,?)", newId("m_"), ctx.workspaceId, uid, input.role, scope.length ? JSON.stringify(scope) : null, input.canExport && input.role === "marketer" ? 1 : 0, now());
    await audit(ctx.workspaceId, { id: ctx.userId, name: ctx.userName }, "member.add", "user", uid, { role: input.role, scope });
  });
}

export async function removeMember(ctx: Ctx, membershipId: string) {
  if (ctx.role !== "owner") throw new AppError("권한이 없습니다.");
  const m = await one<{ user_id: string; role: string }>("SELECT user_id, role FROM memberships WHERE id=? AND workspace_id=?", membershipId, ctx.workspaceId);
  if (!m || m.role === "owner") throw new AppError("삭제할 수 없는 구성원입니다.");
  await tx(async () => {
    await run("DELETE FROM memberships WHERE id=?", membershipId);
    await run("DELETE FROM sessions WHERE user_id=? AND workspace_id=?", m.user_id, ctx.workspaceId);
    await run("UPDATE users SET status='withdrawn' WHERE id=?", m.user_id);
    await audit(ctx.workspaceId, { id: ctx.userId, name: ctx.userName }, "member.remove", "user", m.user_id);
  });
}

// ── 권한(8장 권한 설계) ─────────────────────────────────────────
export type Capability =
  | "client.manage" | "campaign.create" | "landing.edit" | "lead.view" | "lead.edit" | "lead.export"
  | "automation.edit" | "analytics.view" | "billing.manage" | "member.manage" | "ai.use";

export function can(ctx: Ctx, cap: Capability): boolean {
  if (ctx.role === "owner") return true;
  if (ctx.role === "marketer")
    return ["campaign.create", "landing.edit", "lead.view", "lead.edit", "automation.edit", "analytics.view", "ai.use"].includes(cap)
      || (cap === "lead.export" && ctx.canExport);
  return cap === "lead.view" || cap === "lead.edit";
}

export function requireCan(ctx: Ctx, cap: Capability) {
  if (!can(ctx, cap)) throw new AppError("이 작업을 수행할 권한이 없습니다.");
}

/** 테넌트·고객사 범위 SQL 조각. 모든 조회에 반드시 결합한다. */
export function scopeSql(ctx: Ctx, clientCol = "client_id", wsCol = "workspace_id"): { sql: string; params: string[] } {
  if (!ctx.clientScope) return { sql: `${wsCol}=?`, params: [ctx.workspaceId] };
  if (!ctx.clientScope.length) return { sql: `${wsCol}=? AND 1=0`, params: [ctx.workspaceId] };
  return {
    sql: `${wsCol}=? AND ${clientCol} IN (${ctx.clientScope.map(() => "?").join(",")})`,
    params: [ctx.workspaceId, ...ctx.clientScope],
  };
}

export const actorOf = (ctx: Ctx) => ({ type: "user" as const, id: ctx.userId, name: ctx.userName });
