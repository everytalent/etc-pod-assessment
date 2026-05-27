"use client";

/**
 * CandidateProfileForm — minimal admin form to author a candidate
 * profile for the local-dev shim. Matches the OnboardingProfile
 * shape so this is the same payload Onboarding will provide later.
 *
 * Deliberately bare-bones: only the fields the band-deducer + CAT
 * flow actually consume. Easier to fill in for testing.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function CandidateProfileForm() {
  const router = useRouter();
  const [candidateId, setCandidateId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [specialisation, setSpecialisation] = useState("");
  const [hasSolar, setHasSolar] = useState(true);
  // v1.1 contract: matches Onboarding's actual 4-bucket dropdown.
  const [yearsBucket, setYearsBucket] = useState<
    "less_than_3" | "3_to_5" | "5_to_10" | "10_plus"
  >("3_to_5");
  const [country, setCountry] = useState("Nigeria");
  const [city, setCity] = useState("Lagos");
  const [workTypes, setWorkTypes] = useState("");
  const [skills, setSkills] = useState("");
  const [claimedBandOverride, setClaimedBandOverride] = useState<
    "junior" | "mid" | "senior" | ""
  >("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind === "submitting") return;
    setState({ kind: "submitting" });

    const body = {
      profile: {
        candidate_id: candidateId.trim(),
        full_name: fullName.trim(),
        email: email.trim(),
        phone: null,
        country: country.trim(),
        city: city.trim(),
        state: null,
        specialisation: specialisation.trim(),
        has_solar_experience: hasSolar,
        years_bucket: yearsBucket,
        non_solar_industry: null,
        work_types: workTypes
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean),
        skills: skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        certifications: [],
        portfolio: [],
      },
      claimed_band_override: claimedBandOverride === "" ? null : claimedBandOverride,
    };

    const res = await fetch("/api/admin/candidate-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setState({ kind: "ok", message: "Profile saved." });
      router.refresh();
    } else {
      const text = await res.text().catch(() => "");
      setState({
        kind: "error",
        message: `Save failed (${res.status}): ${text.slice(0, 200)}`,
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Candidate ID (e.g. ETC-00001)">
        <input
          required
          value={candidateId}
          onChange={(e) => setCandidateId(e.target.value)}
          className={inputCls}
          placeholder="ETC-00001"
        />
      </Field>
      <Field label="Full name">
        <input
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="Specialisation (must match a skillboard)">
        <input
          required
          value={specialisation}
          onChange={(e) => setSpecialisation(e.target.value)}
          className={inputCls}
          placeholder="Solar Sales Specialist"
        />
      </Field>
      <Field label="Country">
        <input
          required
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="City">
        <input
          required
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="Has solar industry experience">
        <select
          value={hasSolar ? "yes" : "no"}
          onChange={(e) => setHasSolar(e.target.value === "yes")}
          className={inputCls}
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="Years bucket">
        <select
          value={yearsBucket}
          onChange={(e) =>
            setYearsBucket(e.target.value as typeof yearsBucket)
          }
          className={inputCls}
        >
          <option value="less_than_3">Less than 3 years</option>
          <option value="3_to_5">3-5 years</option>
          <option value="5_to_10">5-10 years</option>
          <option value="10_plus">10+ years</option>
        </select>
      </Field>
      <Field label="Work types (comma-separated)">
        <input
          value={workTypes}
          onChange={(e) => setWorkTypes(e.target.value)}
          className={inputCls}
          placeholder="Project Lead, Site Manager"
        />
      </Field>
      <Field label="Skills (comma-separated)">
        <input
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          className={inputCls}
          placeholder="MC4 termination, BOQ creation"
        />
      </Field>
      <Field label="Claimed band override (optional — else auto-deduced)">
        <select
          value={claimedBandOverride}
          onChange={(e) =>
            setClaimedBandOverride(
              e.target.value as "" | "junior" | "mid" | "senior",
            )
          }
          className={inputCls}
        >
          <option value="">— auto from years + signals —</option>
          <option value="junior">Junior</option>
          <option value="mid">Mid</option>
          <option value="senior">Senior</option>
        </select>
      </Field>

      <div className="sm:col-span-2 mt-2 flex items-center justify-between gap-3">
        {state.kind === "error" && (
          <span className="text-xs text-destructive">{state.message}</span>
        )}
        {state.kind === "ok" && (
          <span className="text-xs text-green-700">{state.message}</span>
        )}
        <button
          type="submit"
          disabled={state.kind === "submitting"}
          className="ml-auto inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {state.kind === "submitting" ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold";
