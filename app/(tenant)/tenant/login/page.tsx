/**
 * Tenant login — magic-link form. Mirrors the admin login page but
 * gates against `tenant_users` via /tenant/auth-callback.
 */

import { redirect } from "next/navigation";

import { TenantLoginForm } from "@/components/tenant/TenantLoginForm";
import { getTenantSession } from "@/lib/auth/tenant";

export default async function TenantLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; code?: string }>;
}) {
  const { next, error, code } = await searchParams;

  if (code) {
    const target = `/tenant/auth-callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next ?? "/tenant")}`;
    redirect(target);
  }

  const session = await getTenantSession();
  if (session) {
    redirect(next ?? "/tenant");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6 py-10">
      <TenantLoginForm next={next ?? "/tenant"} initialError={error ?? null} />
    </main>
  );
}
