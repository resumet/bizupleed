import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./db";

let cachedKey: Buffer | null = null;

/**
 * 암호화·해시용 비밀키. APP_SECRET 환경변수를 쓴다.
 * 로컬 개발에서만 편의상 data/.secret 에 자동 생성한다. 운영(Vercel 또는 외부 DB 연결)에서는 키가 인스턴스마다 달라지거나
 * 사라지면 저장된 연락처를 복호화할 수 없으므로 자동 생성하지 않고 오류로 중단한다.
 */
function secretKey(): Buffer {
  if (cachedKey) return cachedKey;
  let secret = process.env.APP_SECRET;
  if (!secret) {
    if (process.env.VERCEL || process.env.DATABASE_URL) throw new Error("APP_SECRET 환경 변수가 필요합니다. (예: openssl rand -hex 32)");
    const f = path.join(dataDir(), ".secret");
    if (fs.existsSync(f)) secret = fs.readFileSync(f, "utf8").trim();
    else {
      secret = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(f, secret, { mode: 0o600 });
    }
  }
  cachedKey = crypto.createHash("sha256").update(secret).digest();
  return cachedKey;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decrypt(enc: string | null | undefined): string {
  if (!enc) return "";
  try {
    const b = Buffer.from(enc, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/** 검색·중복 판정용 키드 해시(원문 복원 불가). */
export const keyedHash = (v: string) => crypto.createHmac("sha256", secretKey()).update(v).digest("hex");
export const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

export const normalizePhone = (v: string) => v.replace(/\D/g, "");
export const isValidPhone = (digits: string) => /^0\d{8,10}$/.test(digits);
export const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

export function formatPhone(d: string): string {
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

export function maskPhone(d: string): string {
  if (d.length < 8) return "****";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}
