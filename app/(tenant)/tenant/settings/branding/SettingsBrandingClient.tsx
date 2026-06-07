"use client";

import { useRouter } from "next/navigation";

import { BrandCustomiser } from "@/components/tenant/BrandCustomiser";

export function SettingsBrandingClient({
  tenantName,
  initialPrimary,
  initialAccent,
  initialLogoUrl,
}: {
  tenantName: string;
  initialPrimary: string;
  initialAccent: string;
  initialLogoUrl: string | null;
}) {
  const router = useRouter();
  return (
    <BrandCustomiser
      tenantName={tenantName}
      initialPrimary={initialPrimary}
      initialAccent={initialAccent}
      initialLogoUrl={initialLogoUrl}
      completeOnboardingOnSave={false}
      onSave={async (input) => {
        const res = await fetch("/api/v1/tenant/branding", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            primary_color: input.primaryColor,
            accent_color: input.accentColor,
            logo_url: input.logoUrl,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: body.error ?? `${res.status}` };
        }
        router.refresh();
        return { ok: true };
      }}
    />
  );
}
