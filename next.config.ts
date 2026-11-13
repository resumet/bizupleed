import type { NextConfig } from "next";

// 모든 콘솔 화면이 로그인 사용자·테넌트별 DB 데이터를 렌더링하므로
// 정적 캐시(Cache Components)는 사용하지 않고 요청 시점 렌더링으로 운영한다.
const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "postgres", "@electric-sql/pglite"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
