"use client";

import { useRouter } from "next/navigation";

import { BrandCustomiser } from "@/components/tenant/BrandCustomiser";

export function SettingsBrandingClient({
  tenantName,
  initialPrimary,
  initialAccent,
  initialPrimaryText,
  initialLogoUrl,
  initialTextMark,
  initialSupportEmail,
  initialCompanyUrl,
  initialFooterText,
  initialContactEmail,
  initialContactPhone,
  initialShowPoweredByEtc,
}: {
  tenantName: string;
  initialPrimary: string;
  initialAccent: string;
  initialPrimaryText: string;
  initialLogoUrl: string | null;
  initialTextMark: string | null;
  initialSupportEmail: string | null;
  initialCompanyUrl: string | null;
  initialFooterText: string | null;
  initialContactEmail: string | null;
  initialContactPhone: string | null;
  initialShowPoweredByEtc: boolean;
}) {
  const router = useRouter();
  return (
    <BrandCustomiser
      tenantName={tenantName}
      initialPrimary={initialPrimary}
      initialAccent={initialAccent}
      initialPrimaryText={initialPrimaryText}
      initialLogoUrl={initialLogoUrl}
      initialTextMark={initialTextMark}
      initialSupportEmail={initialSupportEmail}
      initialCompanyUrl={initialCompanyUrl}
      initialFooterText={initialFooterText}
      initialContactEmail={initialContactEmail}
      initialContactPhone={initialContactPhone}
      initialShowPoweredByEtc={initialShowPoweredByEtc}
      completeOnboardingOnSave={false}
      onSave={async (input) => {
        const res = await fetch("/api/v1/tenant/branding", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            primary_color: input.primaryColor,
            accent_color: input.accentColor,
            primary_text_color: input.primaryTextColor,
            logo_url: input.logoUrl,
            text_mark: input.textMark,
            support_email: input.supportEmail,
            company_url: input.companyUrl,
            footer_text: input.footerText,
            contact_email: input.contactEmail,
            contact_phone: input.contactPhone,
            show_powered_by_etc: input.showPoweredByEtc,
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
