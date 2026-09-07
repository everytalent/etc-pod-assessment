"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { BrandCustomiser } from "@/components/tenant/BrandCustomiser";
import { OnboardingExplainer } from "@/components/tenant/OnboardingExplainer";

type Step = "explainer" | "brand";

export function OnboardingClient({
  tenantName,
  initialPrimary,
  initialAccent,
  initialLogoUrl,
  next,
}: {
  tenantName: string;
  initialPrimary: string;
  initialAccent: string;
  initialLogoUrl: string | null;
  /**
   * Where to land once brand setup is done. Defaults to the dashboard. A
   * company that arrived mid-task (say, handing a JD over from JD Studio)
   * is sent back to finish it instead of being dropped on the dashboard
   * with their work lost.
   */
  next?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("explainer");

  if (step === "explainer") {
    return <OnboardingExplainer onComplete={() => setStep("brand")} />;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Set up your brand.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Candidates will see your colours and logo when they take the
          assessment. You can change this later.
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
              logo_url: input.logoUrl,
              complete_onboarding: input.completeOnboarding,
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            return { ok: false, error: body.error ?? `${res.status}` };
          }
          router.push(next ?? "/tenant");
          router.refresh();
          return { ok: true };
        }}
      />
    </div>
  );
}
