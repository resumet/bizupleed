// 스키마 적용: npm run db:migrate
// DATABASE_URL(.env.local 또는 환경 변수)이 가리키는 Postgres(Supabase)에 테이블·인덱스·RLS 를 만든다. 여러 번 실행해도 안전하다.
import fs from "node:fs";
import { closeDb, migrate, one, run, TABLES, usingPostgres } from "../src/lib/db";

for (const f of [".env.local", ".env"]) {
  if (fs.existsSync(f)) process.loadEnvFile(f);
}

async function main() {
  if (!usingPostgres()) {
    console.error("DATABASE_URL 이 없습니다. .env.local 에 Supabase 연결 문자열을 넣거나 환경 변수로 지정하세요.\n(로컬 개발용 내장 DB 는 서버가 시작될 때 스키마가 자동 적용되므로 이 명령이 필요 없습니다.)");
    process.exit(1);
  }
  await migrate();
  console.log(`스키마 적용 완료: 테이블 ${TABLES.length}개 (RLS 활성화).`);

  // Supabase 라면 업로드 이미지용 비공개 버킷을 만든다.
  const hasStorage = await one<{ t: string | null }>("SELECT to_regclass('storage.buckets')::text AS t");
  if (hasStorage?.t) {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "uploads";
    await run("INSERT INTO storage.buckets (id, name, public) VALUES (?, ?, false) ON CONFLICT (id) DO NOTHING", bucket, bucket);
    console.log(`Storage 버킷 준비 완료: ${bucket} (비공개)`);
  }
}

main()
  .then(closeDb)
  .catch(async (e) => {
    console.error(e);
    await closeDb().catch(() => {});
    process.exit(1);
  });
