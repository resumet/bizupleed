import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * DB 계층 (PostgreSQL 단일 방언).
 * - DATABASE_URL 이 있으면 Supabase 등 외부 Postgres 에 연결한다(postgres.js).
 * - 없으면 로컬 개발·테스트용 내장 Postgres(PGlite)를 data/pglite 에 연다.
 * SQL 은 `?` 자리표시자로 작성하고 실행 직전에 `$n` 으로 바꾼다.
 */
export type Param = string | number | null;
type Result = { rows: object[]; count: number };
type Exec = { query(sql: string, params: Param[]): Promise<Result> };
type Driver = Exec & {
  kind: "postgres" | "pglite";
  tx<T>(fn: (e: Exec) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
};

const g = globalThis as unknown as { __bizupDriver?: Promise<Driver> };
const txStore = new AsyncLocalStorage<Exec>();

export function dataDir(): string {
  const d = process.env.BIZUP_DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export const usingPostgres = () => !!process.env.DATABASE_URL;

async function openPostgres(url: string): Promise<Driver> {
  const { default: postgres } = await import("postgres");
  // COUNT/SUM 결과(int8, numeric)를 문자열이 아닌 숫자로 받는다.
  const num = { from: [20, 1700], to: 20, parse: (x: string) => Number(x), serialize: (x: number) => String(x) };
  const sql = postgres(url, {
    prepare: false, // Supabase 연결 풀러(트랜잭션 모드, 6543 포트)는 prepared statement 를 지원하지 않는다.
    max: Number(process.env.DB_POOL_MAX) || 3, // 서버리스 인스턴스당 연결 수를 작게 유지한다.
    idle_timeout: 20,
    connect_timeout: 15,
    // 로컬 Postgres 가 아니면 TLS 로 연결한다(Supabase).
    ssl: /@(localhost|127\.0\.0\.1)[:/]|sslmode=disable/.test(url) ? false : "require",
    onnotice: () => {},
    types: { num },
  });
  type Q = { unsafe(text: string, params?: Param[]): Promise<object[] & { count: number }> };
  const exec = (c: Q): Exec => ({
    async query(text, params) {
      const r = await c.unsafe(text, params);
      return { rows: Array.from(r), count: r.count ?? 0 };
    },
  });
  return {
    kind: "postgres",
    ...exec(sql as unknown as Q),
    tx: <T>(fn: (e: Exec) => Promise<T>) => sql.begin((t) => fn(exec(t as unknown as Q))) as Promise<T>,
    async exec(text) {
      await sql.unsafe(text);
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

async function openPglite(): Promise<Driver> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const dir = process.env.BIZUP_PGLITE_DIR || path.join(dataDir(), "pglite");
  const toNum = (x: string) => Number(x);
  const pg = new PGlite(dir, { parsers: { [types.NUMERIC]: toNum, [types.INT8]: toNum } });
  await pg.waitReady;
  await pg.exec(SCHEMA_SQL);
  type Q = { query(text: string, params: Param[]): Promise<{ rows: unknown[]; affectedRows?: number }> };
  const exec = (c: Q): Exec => ({
    async query(text, params) {
      const r = await c.query(text, params);
      return { rows: r.rows as object[], count: r.affectedRows ?? 0 };
    },
  });
  return {
    kind: "pglite",
    ...exec(pg as unknown as Q),
    tx: <T>(fn: (e: Exec) => Promise<T>) => pg.transaction((t) => fn(exec(t as unknown as Q))) as Promise<T>,
    async exec(text) {
      await pg.exec(text);
    },
    close: () => pg.close(),
  };
}

export function driver(): Promise<Driver> {
  if (!g.__bizupDriver) {
    const url = process.env.DATABASE_URL;
    if (!url && process.env.VERCEL) throw new Error("DATABASE_URL 이 설정되지 않았습니다. Vercel 환경 변수에 Supabase 연결 문자열을 등록하세요.");
    const p = url ? openPostgres(url) : openPglite();
    g.__bizupDriver = p;
    p.catch(() => {
      if (g.__bizupDriver === p) g.__bizupDriver = undefined;
    });
  }
  return g.__bizupDriver;
}

/** 스키마 적용(멱등). 외부 Postgres 는 `npm run db:migrate` 로 실행한다. PGlite 는 열 때 자동 적용된다. */
export async function migrate() {
  await (await driver()).exec(SCHEMA_SQL);
}

/** 테스트용: 모든 테이블을 비운다. 외부 DB 에서는 실행되지 않는다. */
export async function resetDbForTests() {
  if (usingPostgres() && process.env.BIZUP_ALLOW_RESET !== "1") throw new Error("외부 DB 에서는 실행할 수 없습니다.");
  await (await driver()).exec(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY`);
}

export async function closeDb() {
  const d = g.__bizupDriver;
  g.__bizupDriver = undefined;
  if (d) await (await d).close();
}

const pgSqlCache = new Map<string, string>();
/** `?` 자리표시자를 `$1, $2…` 로 바꾼다(작은따옴표 문자열 안은 건드리지 않음). */
export function toPg(sql: string): string {
  let out = pgSqlCache.get(sql);
  if (out === undefined) {
    let n = 0;
    out = sql.replace(/'(?:[^']|'')*'|\?/g, (m) => (m === "?" ? `$${++n}` : m));
    if (pgSqlCache.size < 2000) pgSqlCache.set(sql, out);
  }
  return out;
}

async function execute(sql: string, params: Param[]): Promise<Result> {
  const e = txStore.getStore() ?? (await driver());
  return e.query(toPg(sql), params);
}

export async function q<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T[]> {
  return (await execute(sql, params)).rows as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T | undefined> {
  return (await execute(sql, params)).rows[0] as T | undefined;
}

/** 변경 쿼리. changes = 영향받은 행 수. */
export async function run(sql: string, ...params: Param[]): Promise<{ changes: number }> {
  return { changes: (await execute(sql, params)).count };
}

/**
 * 중첩 호출에 안전한 트랜잭션. 가장 바깥 호출만 BEGIN/COMMIT 한다.
 * 주의: Postgres 는 트랜잭션 안에서 쿼리가 실패하면 이후 쿼리가 모두 거부된다. 제약 위반은 ON CONFLICT 로 처리한다.
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn();
  return (await driver()).tx((e) => txStore.run(e, fn));
}

export const newId = (prefix = "") => prefix + crypto.randomBytes(9).toString("base64url");
export const now = () => new Date().toISOString();
export const hoursFromNow = (h: number, from = Date.now()) => new Date(from + h * 3600_000).toISOString();

export function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string" || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, phone TEXT, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, auth_provider TEXT NOT NULL DEFAULT 'password',
  status TEXT NOT NULL DEFAULT 'active', terms_agreed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
  role TEXT NOT NULL, client_scope TEXT, can_export INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE(workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id TEXT PRIMARY KEY, status TEXT NOT NULL, trial_end TEXT NOT NULL,
  current_period_end TEXT, cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  free_plan_left INTEGER NOT NULL DEFAULT 2, free_gen_left INTEGER NOT NULL DEFAULT 2,
  ended_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL,
  vat INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, provider TEXT NOT NULL, memo TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, memo TEXT,
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', notify_json TEXT NOT NULL DEFAULT '[]',
  sheet_webhook_url TEXT, pixels_json TEXT NOT NULL DEFAULT '{}',
  automation_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lead_statuses (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, campaign_id TEXT NOT NULL, key TEXT NOT NULL,
  label TEXT NOT NULL, color TEXT NOT NULL, terminal INTEGER NOT NULL DEFAULT 0,
  client_editable INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS landings (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, campaign_id TEXT NOT NULL, name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  content_json TEXT NOT NULL, published_version_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS landing_versions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, landing_id TEXT NOT NULL, content_json TEXT NOT NULL,
  note TEXT, author_id TEXT, author_name TEXT, published_at TEXT NOT NULL,
  seq BIGINT GENERATED BY DEFAULT AS IDENTITY
);
CREATE TABLE IF NOT EXISTS consent_versions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, landing_id TEXT NOT NULL, kind TEXT NOT NULL,
  text TEXT NOT NULL, text_hash TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
  landing_id TEXT NOT NULL, landing_version_id TEXT, visitor_id TEXT, session_id TEXT,
  name TEXT NOT NULL, phone_enc TEXT, phone_hash TEXT, phone_last4 TEXT, email_enc TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}', status_id TEXT NOT NULL, owner_id TEXT,
  source TEXT, medium TEXT, utm_json TEXT NOT NULL DEFAULT '{}', referrer TEXT, device TEXT,
  is_duplicate INTEGER NOT NULL DEFAULT 0, is_invalid INTEGER NOT NULL DEFAULT 0,
  marketing_consent INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT NOT NULL,
  submitted_at TEXT NOT NULL, status_changed_at TEXT NOT NULL, first_contact_at TEXT, last_contact_at TEXT,
  reminded_at TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(landing_id, idempotency_key),
  seq BIGINT GENERATED BY DEFAULT AS IDENTITY
);
CREATE INDEX IF NOT EXISTS idx_leads_ws ON leads(workspace_id, campaign_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(campaign_id, phone_hash);
CREATE TABLE IF NOT EXISTS lead_activities (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, lead_id TEXT NOT NULL, actor_type TEXT NOT NULL,
  actor_id TEXT, actor_name TEXT, event_type TEXT NOT NULL, old_value TEXT, new_value TEXT, created_at TEXT NOT NULL,
  seq BIGINT GENERATED BY DEFAULT AS IDENTITY
);
CREATE INDEX IF NOT EXISTS idx_act_lead ON lead_activities(lead_id, created_at);
CREATE TABLE IF NOT EXISTS lead_consents (
  id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, consent_version_id TEXT NOT NULL, kind TEXT NOT NULL,
  accepted_at TEXT NOT NULL, meta_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, campaign_id TEXT NOT NULL, key TEXT NOT NULL,
  name TEXT NOT NULL, trigger_key TEXT NOT NULL, delay_hours DOUBLE PRECISION NOT NULL, purpose TEXT NOT NULL,
  body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS message_jobs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, campaign_id TEXT NOT NULL, lead_id TEXT NOT NULL,
  rule_id TEXT, kind TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'info', channel TEXT NOT NULL,
  recipient_enc TEXT NOT NULL, recipient_label TEXT, body TEXT NOT NULL, scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  seq BIGINT GENERATED BY DEFAULT AS IDENTITY
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON message_jobs(status, scheduled_at);
CREATE TABLE IF NOT EXISTS message_deliveries (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, job_id TEXT NOT NULL, provider TEXT NOT NULL,
  channel TEXT NOT NULL, provider_message_id TEXT, status TEXT NOT NULL, cost_credits INTEGER NOT NULL DEFAULT 0,
  error TEXT, created_at TEXT NOT NULL,
  seq BIGINT GENERATED BY DEFAULT AS IDENTITY
);
CREATE TABLE IF NOT EXISTS tracking_events (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, campaign_id TEXT NOT NULL, landing_id TEXT NOT NULL,
  landing_version_id TEXT, visitor_id TEXT NOT NULL, session_id TEXT NOT NULL, event_name TEXT NOT NULL,
  event_at TEXT NOT NULL, source TEXT, medium TEXT, utm_campaign TEXT, device TEXT, section_id TEXT,
  value DOUBLE PRECISION, lead_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ev_landing ON tracking_events(landing_id, event_name, event_at);
CREATE INDEX IF NOT EXISTS idx_ev_ws ON tracking_events(workspace_id, event_at);
CREATE TABLE IF NOT EXISTS ai_projects (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, campaign_id TEXT, name TEXT NOT NULL, mode TEXT NOT NULL,
  input_json TEXT NOT NULL, plan_json TEXT, review_json TEXT, status TEXT NOT NULL DEFAULT 'draft',
  engine TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_pages (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, page_order INTEGER NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ai_page_versions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, page_id TEXT NOT NULL, project_id TEXT NOT NULL,
  revision INTEGER NOT NULL, spec_json TEXT NOT NULL, prompt TEXT, cost_credits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, landing_id TEXT NOT NULL, section_id TEXT NOT NULL,
  source_version_id TEXT, analysis_json TEXT NOT NULL, suggestion_json TEXT NOT NULL, engine TEXT,
  status TEXT NOT NULL DEFAULT 'proposed', applied_version_id TEXT, prev_version_id TEXT,
  applied_at TEXT, decided_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_wallets (
  workspace_id TEXT PRIMARY KEY, paid_balance INTEGER NOT NULL DEFAULT 0,
  bonus_balance INTEGER NOT NULL DEFAULT 0, last_topup_at TEXT
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, kind TEXT NOT NULL,
  paid_delta INTEGER NOT NULL, bonus_delta INTEGER NOT NULL, balance_after INTEGER NOT NULL,
  memo TEXT, actor_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(workspace_id, operation_id, kind),
  seq BIGINT GENERATED BY DEFAULT AS IDENTITY
);
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, expires_at TEXT, allow_status_change INTEGER NOT NULL DEFAULT 1,
  allow_export INTEGER NOT NULL DEFAULT 0, mask_phone INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS share_sessions (
  token_hash TEXT PRIMARY KEY, share_link_id TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS share_access_logs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, share_link_id TEXT NOT NULL, ip TEXT, ok INTEGER NOT NULL, created_at TEXT NOT NULL,
  seq BIGINT GENERATED BY DEFAULT AS IDENTITY
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT, actor_name TEXT, action TEXT NOT NULL,
  resource_type TEXT, resource_id TEXT, meta_json TEXT, created_at TEXT NOT NULL,
  seq BIGINT GENERATED BY DEFAULT AS IDENTITY
);
CREATE INDEX IF NOT EXISTS idx_audit_ws ON audit_logs(workspace_id, created_at);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY, window_start BIGINT NOT NULL, count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, created_at TEXT NOT NULL
);
`;

export const TABLES = Array.from(SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g), (m) => m[1]);

/**
 * 실제 적용되는 스키마. 모든 테이블에 RLS 를 켠다 — 정책이 없으므로 Supabase 의 anon/authenticated 키(PostgREST)로는
 * 어떤 행도 읽거나 쓸 수 없고, 앱은 테이블 소유자 권한의 직접 연결로만 접근한다.
 */
export const SCHEMA_SQL = SCHEMA + TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join("\n");


export async function audit(
  workspaceId: string,
  actor: { id?: string | null; name?: string | null },
  action: string,
  resourceType?: string,
  resourceId?: string,
  meta?: unknown,
) {
  await run(
    "INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?,?,?)",
    newId("al_"), workspaceId, actor.id ?? null, actor.name ?? null, action,
    resourceType ?? null, resourceId ?? null, meta ? JSON.stringify(meta) : null, now(),
  );
}

/** 고정 윈도 요청 제한. 허용되면 true. 한 문장(UPSERT)으로 처리해 여러 인스턴스에서 동시에 호출돼도 정확하다. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const t = Math.floor(Date.now() / 1000);
  const row = await one<{ count: number }>(
    `INSERT INTO rate_limits(key,window_start,count) VALUES (?,?,1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END
     RETURNING count`,
    key, t, t - windowSec, t - windowSec,
  );
  return (row?.count ?? 1) <= limit;
}
