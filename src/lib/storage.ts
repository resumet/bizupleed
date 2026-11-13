import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./db";

/**
 * 업로드 이미지 저장소.
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 가 있으면 Supabase Storage(비공개 버킷)에 저장한다.
 *   서비스 키는 서버에서만 쓰이고, 이미지는 /uploads/[name] 라우트가 대신 내려준다.
 * - 없으면 로컬 디스크(data/uploads)에 저장한다. Vercel 은 파일 시스템이 읽기 전용이라 로컬 저장을 쓸 수 없다.
 */
const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || "uploads";

function supabase(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export const storageKind = () => (supabase() ? "supabase" : "local");

export async function putUpload(name: string, data: Buffer, mime: string): Promise<void> {
  const sb = supabase();
  if (sb) {
    const res = await fetch(`${sb.url}/storage/v1/object/${bucket()}/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${sb.key}`, apikey: sb.key, "content-type": mime, "cache-control": "max-age=31536000", "x-upsert": "false" },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`이미지 저장 실패 (Supabase Storage ${res.status}): ${(await res.text()).slice(0, 200)}`);
    return;
  }
  if (process.env.VERCEL) throw new Error("이미지 저장소가 설정되지 않았습니다. SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 를 등록하세요.");
  const dir = path.join(dataDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), data);
}

/** 저장된 이미지를 읽는다. 없으면 null. name 은 호출 측에서 형식을 검증한다. */
export async function getUpload(name: string): Promise<Uint8Array | null> {
  const sb = supabase();
  if (sb) {
    const res = await fetch(`${sb.url}/storage/v1/object/${bucket()}/${name}`, { headers: { authorization: `Bearer ${sb.key}`, apikey: sb.key } });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }
  if (process.env.VERCEL) return null;
  const file = path.join(dataDir(), "uploads", name);
  return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
}
