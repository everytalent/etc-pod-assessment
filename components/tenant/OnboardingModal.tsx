"use client";

/**
 * Translucent-backdrop onboarding modal. Wraps the 4-card explainer
 * and brand customiser, dismissible at any time via the X button OR a
 * "Skip for now" link.
 *
 * Dismissing marks onboarding_completed_at so the modal doesn't
 * reappear on every visit. The user can re-trigger the full setup
 * from /tenant/settings/branding any time.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { BrandCustomiser } from "@/components/tenant/BrandCustomiser";
import { OnboardingExplainer } from "@/components/tenant/OnboardingExplainer";

type Step = "explainer" | "brand";

export function OnboardingModal({
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
  const [step, setStep] = useState<Step>("explainer");
  const [closing, setClosing] = useState(false);

  const dismiss = async () => {
    if (closing) return;
    setClosing(true);
    await fetch("/api/v1/tenant/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ complete_onboarding: true }),
    });
    router.refresh();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workspace onboarding"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-2xl">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close onboarding"
          className="absolute -top-2 -right-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-muted"
        >
          ✕
        </button>

        <div className="rounded-2xl bg-background p-1 shadow-2xl">
          {step === "explainer" ? (
            <div className="p-2">
              <OnboardingExplainer onComplete={() => setStep("brand")} />
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={dismiss}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Skip for now
                </button>
              </div>
            </div>
          ) : (
            <div className="p-5">
              <header className="mb-4">
                <h2 className="text-xl font-bold">Set up your brand.</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Candidates will see your colours and logo. You can change
                  this later from Settings.
                </p>
              </header>
              <BrandCustomiser
                tenantName={tenantName}
                initialPrimary={initialPrimary}
                initialAccent={initialAccent}
                initialLogoUrl={initialLogoUrl}
                completeOnboardingOnSave={true}
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
                      complete_onboarding: input.completeOnboarding,
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
              <div className="mt-4 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => setStep("explainer")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ← Back to overview
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
