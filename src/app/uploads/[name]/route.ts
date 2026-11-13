import { getUpload } from "@/lib/storage";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** 업로드 이미지 제공(공개 랜딩에서 사용). 파일명은 추측 불가능한 임의 ID 이고 내용이 바뀌지 않으므로 CDN 에 장기 캐시한다. */
export async function GET(_req: Request, ctx: RouteContext<"/uploads/[name]">) {
  const { name } = await ctx.params;
  const m = /^([A-Za-z0-9_-]+)\.(png|jpg|gif|webp)$/.exec(name);
  if (!m) return new Response("not found", { status: 404 });
  const data = await getUpload(name);
  if (!data) return new Response("not found", { status: 404 });
  return new Response(data as BodyInit, {
    headers: { "content-type": MIME[m[2]], "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}
