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
}: {
  tenantName: string;
  initialPrimary: string;
  initialAccent: string;
  initialLogoUrl: string | null;
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
          router.push("/tenant");
          router.refresh();
          return { ok: true };
        }}
      />
    </div>
  );
}
