import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "", // 테스트는 항상 내장 Postgres(PGlite, 메모리)에서 실행한다
      BIZUP_PGLITE_DIR: "memory://",
      BIZUP_DATA_DIR: path.join(os.tmpdir(), "bizuplead-test"),
      APP_SECRET: "test-secret",
      ANTHROPIC_API_KEY: "",
    },
  },
});
