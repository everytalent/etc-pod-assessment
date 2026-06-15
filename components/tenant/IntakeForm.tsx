"use client";

/**
 * Tenant intake form (PRD §1).
 *
 * Two-step wizard:
 *   Step 1 — intake type toggle (JD / SOW), main text field, optional
 *            context field
 *   Step 2 — optional tenant-supplied questions (inline lines) with a
 *            batch-default treatment (use_as_is / improve)
 *
 * Both steps fire as a single POST to /api/v1/tenant/assessment-banks.
 * The API creates the bank row and enqueues the generation job; the
 * client redirects to /tenant/assessments/[id]/waiting on success.
 *
 * File upload (Step 1 .pdf/.docx, Step 2 .txt/.csv) is a Phase 2b
 * follow-up — Phase 2a takes paste-only inputs.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type IntakeType = "job_description" | "scope_of_work";
type Treatment = "use_as_is" | "improve";

const DRAFT_KEY = "tenant-intake-draft-v1";

type Draft = {
  intakeType: IntakeType;
  intakeText: string;
  contextText: string;
  wantsOwnQuestions: boolean | null;
  questionsRaw: string;
  batchTreatment: Treatment;
};

function readDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage full / private mode — ignore.
  }
}

function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function IntakeForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [intakeType, setIntakeType] = useState<IntakeType>("job_description");
  const [intakeText, setIntakeText] = useState("");
  const [contextText, setContextText] = useState("");
  const [wantsOwnQuestions, setWantsOwnQuestions] = useState<boolean | null>(null);
  const [questionsRaw, setQuestionsRaw] = useState("");
  const [batchTreatment, setBatchTreatment] = useState<Treatment>("improve");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);

  useEffect(() => {
    const draft = readDraft();
    if (!draft) return;
    setIntakeType(draft.intakeType);
    setIntakeText(draft.intakeText);
    setContextText(draft.contextText);
    setWantsOwnQuestions(draft.wantsOwnQuestions);
    setQuestionsRaw(draft.questionsRaw);
    setBatchTreatment(draft.batchTreatment);
    setRestoredFromDraft(true);
  }, []);

  useEffect(() => {
    if (intakeText.trim().length < 20) return;
    writeDraft({
      intakeType,
      intakeText,
      contextText,
      wantsOwnQuestions,
      questionsRaw,
      batchTreatment,
    });
  }, [
    intakeType,
    intakeText,
    contextText,
    wantsOwnQuestions,
    questionsRaw,
    batchTreatment,
  ]);

  const intakeLabel =
    intakeType === "job_description"
      ? "Paste your job description"
      : "Paste your scope of work";

  const contextPlaceholder =
    intakeType === "job_description"
      ? "Seniority level, team setup, must-have tools, dealbreakers"
      : "Team size needed, project duration, required availability, key milestones";

  const parsedQuestions = parseQuestions(questionsRaw);

  const canAdvanceStep1 = intakeText.trim().length >= 100;
  const canSubmit = canAdvanceStep1 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const body = {
      intake_type: intakeType,
      intake_text: intakeText.trim(),
      context_text: contextText.trim() || null,
      tenant_supplied_questions: parsedQuestions.map((q) => ({
        text: q,
        treatment: batchTreatment,
        source: "inline" as const,
      })),
    };

    const res = await fetch("/api/v1/tenant/assessment-banks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `${res.status}`);
      setSubmitting(false);
      return;
    }
    const data = await res.json();
    clearDraft();
    router.push(`/tenant/assessments/${data.id}/waiting`);
  };

  const discardDraft = () => {
    clearDraft();
    setIntakeType("job_description");
    setIntakeText("");
    setContextText("");
    setWantsOwnQuestions(null);
    setQuestionsRaw("");
    setBatchTreatment("improve");
    setStep(1);
    setRestoredFromDraft(false);
  };

  return (
    <div className="space-y-6">
      {restoredFromDraft && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-foreground/20 bg-foreground/5 p-4 text-xs">
          <p>
            <span className="font-semibold">We saved what you had.</span> Your
            previous draft is restored below — pick up where you left off, or
            start over.
          </p>
          <button
            type="button"
            onClick={discardDraft}
            className="shrink-0 rounded-lg border border-border bg-background px-3 py-1.5 font-medium hover:border-etc-marigold"
          >
            Start over
          </button>
        </div>
      )}
      <Stepper current={step} />

      {step === 1 ? (
        <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
          <fieldset>
            <legend className="text-sm font-semibold">What are you hiring for?</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <RadioCard
                checked={intakeType === "job_description"}
                onChange={() => setIntakeType("job_description")}
                title="A permanent role"
                hint="Hiring one or more people into an ongoing position."
              />
              <RadioCard
                checked={intakeType === "scope_of_work"}
                onChange={() => setIntakeType("scope_of_work")}
                title="Project-based work"
                hint="Sourcing externally-contracted talent for a defined project."
              />
            </div>
          </fieldset>

          <label className="block">
            <span className="text-xs font-medium">{intakeLabel}</span>
            <textarea
              value={intakeText}
              onChange={(e) => setIntakeText(e.target.value)}
              rows={12}
              maxLength={50_000}
              className="mt-1 w-full resize-y rounded-lg border border-input bg-background p-3 text-sm leading-relaxed"
              placeholder="Paste the role description here. More detail = sharper assessment."
            />
            <p className="mt-1 text-[0.65rem] text-muted-foreground">
              {intakeText.length.toLocaleString()} / 50,000 characters
              {intakeText.trim().length < 100 ? " (need at least 100)" : ""}
            </p>
          </label>

          <label className="block">
            <span className="text-xs font-medium">
              Anything else we should know (optional)
            </span>
            <textarea
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              rows={4}
              maxLength={5000}
              placeholder={contextPlaceholder}
              className="mt-1 w-full resize-y rounded-lg border border-input bg-background p-3 text-sm"
            />
          </label>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canAdvanceStep1}
              onClick={() => setStep(2)}
              className="inline-flex h-11 items-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </section>
      ) : (
        <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
          <header>
            <h2 className="text-sm font-semibold">
              Do you want to add some questions yourself?
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The algorithm generates a full question bank from your role. If
              you have questions you specifically want candidates to answer,
              you can add them here.
            </p>
          </header>

          {wantsOwnQuestions === null && (
            <div className="grid gap-2 sm:grid-cols-2">
              <RadioCard
                checked={false}
                onChange={() => {
                  setWantsOwnQuestions(false);
                  setQuestionsRaw("");
                }}
                title="No, the algorithm handles it"
                hint="Skip ahead and generate the assessment."
              />
              <RadioCard
                checked={false}
                onChange={() => setWantsOwnQuestions(true)}
                title="Yes, I have some"
                hint="Add your questions on the next screen."
              />
            </div>
          )}

          {wantsOwnQuestions === true && (
            <>
              <label className="block">
                <span className="text-xs font-medium">
                  Treatment for all your questions
                </span>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <RadioCard
                    checked={batchTreatment === "use_as_is"}
                    onChange={() => setBatchTreatment("use_as_is")}
                    title="Use as-is"
                    hint="Included verbatim. Text and answer key untouched."
                  />
                  <RadioCard
                    checked={batchTreatment === "improve"}
                    onChange={() => setBatchTreatment("improve")}
                    title="Improve"
                    hint="Algorithm refines wording and calibrates to the grid."
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-medium">
                  Questions, one per line
                </span>
                <textarea
                  value={questionsRaw}
                  onChange={(e) => setQuestionsRaw(e.target.value)}
                  rows={10}
                  maxLength={20_000}
                  placeholder="Describe how you would size an inverter for a 10 kWp residential array."
                  className="mt-1 w-full resize-y rounded-lg border border-input bg-background p-3 text-sm font-mono leading-relaxed"
                />
                <p className="mt-1 text-[0.65rem] text-muted-foreground">
                  {parsedQuestions.length} parsed
                </p>
              </label>

              <button
                type="button"
                onClick={() => {
                  setWantsOwnQuestions(null);
                  setQuestionsRaw("");
                }}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Actually, let the algorithm handle it
              </button>
            </>
          )}

          {wantsOwnQuestions === false && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
              The algorithm will generate the full question bank.{" "}
              <button
                type="button"
                onClick={() => setWantsOwnQuestions(true)}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                Change my mind
              </button>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium hover:border-etc-marigold"
            >
              Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit || wantsOwnQuestions === null}
              className="inline-flex h-11 items-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Generate assessment"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stepper({ current }: { current: 1 | 2 }) {
  return (
    <ol className="flex items-center gap-3 text-xs text-muted-foreground">
      <Step n={1} label="Role or project" current={current} />
      <span className="h-px flex-1 bg-border" />
      <Step n={2} label="Your questions" current={current} />
    </ol>
  );
}

function Step({
  n,
  label,
  current,
}: {
  n: 1 | 2;
  label: string;
  current: 1 | 2;
}) {
  const active = current === n;
  const done = current > n;
  return (
    <li
      className={cn(
        "flex items-center gap-2",
        active ? "text-foreground" : "",
        done ? "text-foreground/70" : "",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border text-[0.65rem] font-semibold",
          active
            ? "border-foreground bg-foreground text-background"
            : done
              ? "border-foreground/40 bg-muted text-foreground"
              : "border-border bg-card",
        )}
      >
        {n}
      </span>
      <span>{label}</span>
    </li>
  );
}

function RadioCard({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        checked
          ? "border-foreground bg-foreground/5"
          : "border-border bg-card hover:border-etc-marigold",
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-[0.7rem] text-muted-foreground">{hint}</p>
    </button>
  );
}

function parseQuestions(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*Q\s*[:.\-]\s*/i, "").trim())
    .filter((line) => line.length >= 10 && line.length <= 1000)
    .slice(0, 100);
}
