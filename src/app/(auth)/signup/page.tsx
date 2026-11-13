import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/client";
import { PLAN } from "@/lib/pricing";
import { getCtx } from "@/lib/session";

export const metadata = { title: "무료 체험 시작 — 비즈업리드" };

export default async function SignupPage() {
  if (await getCtx()) redirect("/app");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <Link href="/" className="text-lg font-extrabold tracking-tight">비즈업<span className="text-blue-600">리드</span></Link>
        <h1 className="mt-4 text-xl font-extrabold">{PLAN.trialDays}일 무료 체험</h1>
        <p className="mb-5 mt-1 text-sm text-gray-500">카드 등록 없이 시작합니다. 체험이 끝나도 자동으로 결제되지 않습니다.</p>
        <AuthForm mode="signup" />
        <p className="mt-4 text-center text-sm text-gray-600">이미 계정이 있으신가요? <Link href="/login" className="font-semibold text-blue-600 underline">로그인</Link></p>
      </div>
    </main>
  );
}
