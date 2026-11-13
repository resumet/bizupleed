import { newId, now, one, q, run, tx } from "./db";
import { CREDIT_VALID_YEARS } from "./pricing";

export type Wallet = { workspace_id: string; paid_balance: number; bonus_balance: number; last_topup_at: string | null };
export type WalletView = Wallet & { total: number; expires_at: string | null };
export type LedgerRow = {
  id: string; operation_id: string; kind: string; paid_delta: number; bonus_delta: number;
  balance_after: number; memo: string | null; created_at: string;
};

async function ledger(ws: string, opId: string, kind: string, paid: number, bonus: number, memo: string, actorId?: string | null) {
  const w = (await one<Wallet>("SELECT * FROM credit_wallets WHERE workspace_id=?", ws))!;
  await run(
    "INSERT INTO credit_ledger VALUES (?,?,?,?,?,?,?,?,?,?)",
    newId("cl_"), ws, opId, kind, paid, bonus, w.paid_balance + w.bonus_balance, memo, actorId ?? null, now(),
  );
}

function expiryOf(w: Wallet): Date | null {
  if (!w.last_topup_at) return null;
  const d = new Date(w.last_topup_at);
  d.setFullYear(d.getFullYear() + CREDIT_VALID_YEARS);
  return d;
}

const view = (w: Wallet): WalletView => ({ ...w, total: w.paid_balance + w.bonus_balance, expires_at: expiryOf(w)?.toISOString() ?? null });

/**
 * 지갑 행을 잠그고(FOR UPDATE) 읽는다. 반드시 트랜잭션 안에서 호출한다.
 * 같은 워크스페이스의 충전·차감·환급이 여러 서버 인스턴스에서 동시에 실행돼도 순서대로 처리된다.
 */
async function lockWallet(ws: string): Promise<WalletView> {
  await run("INSERT INTO credit_wallets(workspace_id) VALUES (?) ON CONFLICT (workspace_id) DO NOTHING", ws);
  let w = (await one<Wallet>("SELECT * FROM credit_wallets WHERE workspace_id=? FOR UPDATE", ws))!;
  const exp = expiryOf(w);
  if (exp && exp.getTime() < Date.now() && w.paid_balance + w.bonus_balance > 0) {
    const { paid_balance: p, bonus_balance: b } = w;
    await run("UPDATE credit_wallets SET paid_balance=0, bonus_balance=0 WHERE workspace_id=?", ws);
    await ledger(ws, `expire:${w.last_topup_at}`, "expire", -p, -b, "유효기간 만료 소멸");
    w = { ...w, paid_balance: 0, bonus_balance: 0 };
  }
  return view(w);
}

/** 잔액 조회. 지갑이 없거나 유효기간이 지난 잔액이 남아 있을 때만 쓰기 트랜잭션을 연다. */
export async function getWallet(ws: string): Promise<WalletView> {
  const w = await one<Wallet>("SELECT * FROM credit_wallets WHERE workspace_id=?", ws);
  const exp = w && expiryOf(w);
  if (w && !(exp && exp.getTime() < Date.now() && w.paid_balance + w.bonus_balance > 0)) return view(w);
  return tx(() => lockWallet(ws));
}

/** 충전(유상) + 보너스(무상). operation_id 기준 멱등. */
export async function topup(ws: string, opId: string, amount: number, bonus: number, actorId?: string | null): Promise<boolean> {
  return tx(async () => {
    await lockWallet(ws);
    if (await one("SELECT 1 FROM credit_ledger WHERE workspace_id=? AND operation_id=? AND kind='topup'", ws, opId)) return false;
    await run("UPDATE credit_wallets SET paid_balance=paid_balance+?, bonus_balance=bonus_balance+?, last_topup_at=? WHERE workspace_id=?", amount, bonus, now(), ws);
    await ledger(ws, opId, "topup", amount, bonus, bonus ? `크레딧 충전 (+보너스 ${bonus.toLocaleString()})` : "크레딧 충전", actorId);
    return true;
  });
}

export type ChargeResult = { ok: true; already: boolean } | { ok: false; reason: "insufficient"; balance: number };

/** 차감. 같은 operation_id 는 한 번만 차감된다. 무상 크레딧을 먼저 사용한다. */
export async function charge(ws: string, opId: string, amount: number, memo: string, actorId?: string | null): Promise<ChargeResult> {
  return tx(async (): Promise<ChargeResult> => {
    const w = await lockWallet(ws);
    if (await one("SELECT 1 FROM credit_ledger WHERE workspace_id=? AND operation_id=? AND kind='charge'", ws, opId)) return { ok: true, already: true };
    if (w.total < amount) return { ok: false, reason: "insufficient", balance: w.total };
    const fromBonus = Math.min(w.bonus_balance, amount);
    const fromPaid = amount - fromBonus;
    await run("UPDATE credit_wallets SET paid_balance=paid_balance-?, bonus_balance=bonus_balance-? WHERE workspace_id=?", fromPaid, fromBonus, ws);
    await ledger(ws, opId, "charge", -fromPaid, -fromBonus, memo, actorId);
    return { ok: true, already: false };
  });
}

/** 실패 복구: 해당 operation 의 차감을 반대 거래로 되돌린다. 중복 환급되지 않는다. */
export async function refund(ws: string, opId: string, memo: string): Promise<boolean> {
  return tx(async () => {
    await lockWallet(ws);
    const c = await one<LedgerRow>("SELECT * FROM credit_ledger WHERE workspace_id=? AND operation_id=? AND kind='charge'", ws, opId);
    if (!c) return false;
    if (await one("SELECT 1 FROM credit_ledger WHERE workspace_id=? AND operation_id=? AND kind='refund'", ws, opId)) return false;
    await run("UPDATE credit_wallets SET paid_balance=paid_balance+?, bonus_balance=bonus_balance+? WHERE workspace_id=?", -c.paid_delta, -c.bonus_delta, ws);
    await ledger(ws, opId, "refund", -c.paid_delta, -c.bonus_delta, memo);
    return true;
  });
}

export async function listLedger(ws: string, limit = 100): Promise<LedgerRow[]> {
  return q<LedgerRow>("SELECT * FROM credit_ledger WHERE workspace_id=? ORDER BY created_at DESC, seq DESC LIMIT ?", ws, limit);
}
