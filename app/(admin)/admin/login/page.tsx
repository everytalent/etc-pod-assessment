/**
 * Admin login — magic-link form.
 *
 * If the user lands here with `?error=not_authorized`, the auth-callback
 * rejected them because their email isn't in admin_users.
 *
 * If the user lands here with `?code=...`, the magic-link email was
 * misrouted (Supabase email template / Site URL points at /admin/login
 * instead of /admin/auth-callback). Forward to the callback so the code
 * exchange actually happens — otherwise the user sees the login form
 * again, requests a new link, and loops forever.
 */

import { redirect } from "next/navigation";

import { LoginForm } from "@/components/admin/LoginForm";
import { getAdminUser } from "@/lib/auth/admin";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; code?: string }>;
}) {
  const { next, error, code } = await searchParams;

  if (code) {
    const target = `/admin/auth-callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next ?? "/admin")}`;
    redirect(target);
  }

  const user = await getAdminUser();
  if (user) {
    redirect(next ?? "/admin");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6 py-10">
      <LoginForm next={next ?? "/admin"} initialError={error ?? null} />
    </main>
  );
}
