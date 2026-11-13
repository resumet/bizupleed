import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/client";
import { getCtx } from "@/lib/session";

export const metadata = { title: "로그인 — 비즈업리드" };

export default async function LoginPage() {
  if (await getCtx()) redirect("/app");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <Link href="/" className="text-lg font-extrabold tracking-tight">비즈업<span className="text-blue-600">리드</span></Link>
        <h1 className="mb-5 mt-4 text-xl font-extrabold">로그인</h1>
        <AuthForm mode="login" />
        <p className="mt-4 text-center text-sm text-gray-600">계정이 없으신가요? <Link href="/signup" className="font-semibold text-blue-600 underline">14일 무료 체험</Link></p>
      </div>
    </main>
  );
}
