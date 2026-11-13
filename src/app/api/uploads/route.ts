import { can } from "@/lib/accounts";
import { newId, now, rateLimit, run } from "@/lib/db";
import { getCtx, sameOrigin } from "@/lib/session";
import { putUpload } from "@/lib/storage";

// Vercel 함수의 요청 본문 한도(4.5MB)보다 작게 잡는다.
const MAX = 4 * 1024 * 1024;

/** 파일 시그니처로 실제 이미지 형식을 판별한다(확장자·Content-Type 을 신뢰하지 않음). */
function sniff(b: Buffer): { ext: string; mime: string } | null {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return { ext: "gif", mime: "image/gif" };
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

export async function POST(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!sameOrigin(req)) return Response.json({ error: "잘못된 요청입니다." }, { status: 403 });
  if (!can(ctx, "landing.edit")) return Response.json({ error: "권한이 없습니다." }, { status: 403 });
  if (!(await rateLimit(`up:${ctx.userId}`, 120, 600))) return Response.json({ error: "업로드가 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "파일이 없습니다." }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "이미지는 4MB 이하만 올릴 수 있습니다." }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) return Response.json({ error: "PNG, JPG, GIF, WEBP 이미지만 올릴 수 있습니다." }, { status: 400 });
  const id = newId("f");
  const name = `${id}.${kind.ext}`;
  try {
    await putUpload(name, buf, kind.mime);
  } catch (e) {
    console.error("[upload]", e);
    return Response.json({ error: "이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
  await run("INSERT INTO uploads VALUES (?,?,?,?,?,?)", id, ctx.workspaceId, name, kind.mime, buf.length, now());
  return Response.json({ url: `/uploads/${name}` });
}
