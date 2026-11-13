import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "비즈업리드 — 랜딩부터 DB 관리·알림·분석까지",
  description: "랜딩페이지 제작, 상담 신청 DB 수집, 자동 알림, 상담 관리, 성과 분석과 AI 개선을 하나의 워크스페이스에서.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
