/**
 * Admin login — magic-link form.
 *
 * Server Component shell + client form. The form calls Supabase
 * signInWithOtp directly (browser SDK), which emails a code-exchange link
 * back to /admin/auth-callback. We redirect to ?next= afterwards.
 */

import { redirect } from "next/navigation";

import { LoginForm } from "@/components/admin/LoginForm";
import { getAdminUser } from "@/lib/auth/admin";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getAdminUser();
  const { next } = await searchParams;
  if (user) {
    redirect(next ?? "/admin");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6 py-10">
      <LoginForm next={next ?? "/admin"} />
    </main>
  );
}
