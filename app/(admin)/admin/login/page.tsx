/**
 * Admin login — magic-link form.
 *
 * If the user lands here with `?error=not_authorized`, the auth-callback
 * rejected them because their email isn't in admin_users.
 */

import { redirect } from "next/navigation";

import { LoginForm } from "@/components/admin/LoginForm";
import { getAdminUser } from "@/lib/auth/admin";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const user = await getAdminUser();
  const { next, error } = await searchParams;
  if (user) {
    redirect(next ?? "/admin");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6 py-10">
      <LoginForm next={next ?? "/admin"} initialError={error ?? null} />
    </main>
  );
}
