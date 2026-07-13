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
type IntakeMode = "paste" | "upload" | "url";

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
  const [claimedSeniority, setClaimedSeniority] = useState<
    "junior" | "mid" | "senior" | null
  >(null);
  const [roleLocation, setRoleLocation] = useState("");
  const [wantsOwnQuestions, setWantsOwnQuestions] = useState<boolean | null>(null);
  const [questionsRaw, setQuestionsRaw] = useState("");
  const [batchTreatment, setBatchTreatment] = useState<Treatment>("improve");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [intakeMode, setIntakeMode] = useState<IntakeMode>("paste");
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Don't auto-restore. Surface the saved draft as an offer so people
  // intentionally starting fresh see an empty form, and people retrying
  // after a failure can recover with one click.
  useEffect(() => {
    const draft = readDraft();
    if (draft && draft.intakeText.trim().length >= 20) {
      setPendingDraft(draft);
    }
  }, []);

  const acceptDraft = () => {
    if (!pendingDraft) return;
    setIntakeType(pendingDraft.intakeType);
    setIntakeText(pendingDraft.intakeText);
    setContextText(pendingDraft.contextText);
    setWantsOwnQuestions(pendingDraft.wantsOwnQuestions);
    setQuestionsRaw(pendingDraft.questionsRaw);
    setBatchTreatment(pendingDraft.batchTreatment);
    setRestoredFromDraft(true);
    setPendingDraft(null);
  };

  const declineDraft = () => {
    clearDraft();
    setPendingDraft(null);
  };

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
      claimed_seniority: claimedSeniority,
      role_location: roleLocation.trim() || null,
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
    // Intentionally NOT clearing the draft here. The /assessment-banks
    // POST creating the row doesn't mean generation succeeded — the
    // worker can still fail downstream (Anthropic timeout, prompt
    // rejection, etc.) and the "Try again" flow needs the form values
    // to be restorable. The draft is only cleared when the user
    // explicitly clicks "Start over" via discardDraft().
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
    setIntakeMode("paste");
    setSourceLabel(null);
    setUrlInput("");
    setExtractError(null);
  };

  const extractFromFile = async (file: File) => {
    setExtractError(null);
    setExtracting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/tenant/intake-extract", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExtractError(humaniseExtractError(data?.error, file.name));
        return;
      }
      setIntakeText(data.text);
      setSourceLabel(data.source_label ?? file.name);
    } catch (err) {
      setExtractError(
        err instanceof Error ? err.message : "Could not read the file.",
      );
    } finally {
      setExtracting(false);
    }
  };

  const extractFromUrl = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setExtractError("Paste a link to fetch.");
      return;
    }
    setExtractError(null);
    setExtracting(true);
    try {
      const res = await fetch("/api/v1/tenant/intake-extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExtractError(humaniseExtractError(data?.error, trimmed));
        return;
      }
      setIntakeText(data.text);
      setSourceLabel(data.source_label ?? trimmed);
    } catch (err) {
      setExtractError(
        err instanceof Error ? err.message : "Could not fetch that link.",
      );
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="space-y-6">
      {pendingDraft && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-foreground/20 bg-foreground/5 p-4 text-xs">
          <p>
            <span className="font-semibold">Resume your last draft?</span>{" "}
            We kept what you had ({pendingDraft.intakeText.trim().length}{" "}
            characters of {pendingDraft.intakeType === "job_description" ? "JD" : "SOW"} text).
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={declineDraft}
              className="rounded-lg border border-border bg-background px-3 py-1.5 font-medium hover:border-etc-marigold"
            >
              Start fresh
            </button>
            <button
              type="button"
              onClick={acceptDraft}
              className="rounded-lg bg-foreground px-3 py-1.5 font-semibold text-background"
            >
              Resume
            </button>
          </div>
        </div>
      )}
      {restoredFromDraft && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-foreground/20 bg-foreground/5 p-4 text-xs">
          <p>
            <span className="font-semibold">Draft restored.</span> Pick up where
            you left off, or start over.
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

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium">{intakeLabel}</span>
              <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-[0.7rem]">
                <ModeButton
                  active={intakeMode === "paste"}
                  onClick={() => setIntakeMode("paste")}
                >
                  Paste
                </ModeButton>
                <ModeButton
                  active={intakeMode === "upload"}
                  onClick={() => setIntakeMode("upload")}
                >
                  Upload file
                </ModeButton>
                <ModeButton
                  active={intakeMode === "url"}
                  onClick={() => setIntakeMode("url")}
                >
                  From link
                </ModeButton>
              </div>
            </div>

            {intakeMode === "upload" && (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-xs">
                <input
                  type="file"
                  aria-label="Upload job description or scope of work"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void extractFromFile(file);
                    e.target.value = "";
                  }}
                  disabled={extracting}
                  className="text-xs"
                />
                <p className="mt-2 text-muted-foreground">
                  PDF, DOCX, or TXT. Up to 5MB.
                </p>
              </div>
            )}

            {intakeMode === "url" && (
              <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://company.com/careers/role"
                    disabled={extracting}
                    className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void extractFromUrl()}
                    disabled={extracting || !urlInput.trim()}
                    className="inline-flex h-10 shrink-0 items-center rounded-lg bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-50"
                  >
                    {extracting ? "Fetching..." : "Fetch text"}
                  </button>
                </div>
                <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                  Tip: drop a share link from{" "}
                  <a
                    href="https://jd.energytalentco.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    JD Studio
                  </a>{" "}
                  (your branded JD platform) — it pulls the role title and
                  description straight in. No JD yet?{" "}
                  <a
                    href="https://jd.energytalentco.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-foreground underline-offset-4 hover:underline"
                  >
                    Create one in JD Studio →
                  </a>
                </p>
              </div>
            )}

            {extractError && (
              <p className="rounded-lg border border-destructive bg-destructive/10 p-2 text-[0.7rem] text-destructive">
                {extractError}
              </p>
            )}

            {sourceLabel && intakeMode !== "paste" && (
              <p className="text-[0.7rem] text-muted-foreground">
                Loaded from <span className="font-medium text-foreground">{sourceLabel}</span>.
                Review the extracted text below and edit if needed.
              </p>
            )}

            <textarea
              value={intakeText}
              onChange={(e) => {
                setIntakeText(e.target.value);
                setSourceLabel(null);
              }}
              rows={12}
              maxLength={50_000}
              className="w-full resize-y rounded-lg border border-input bg-background p-3 text-sm leading-relaxed"
              placeholder={
                intakeMode === "paste"
                  ? "Paste the role description here. More detail = sharper assessment."
                  : "Extracted text will appear here. You can edit before continuing."
              }
            />
            <p className="text-[0.65rem] text-muted-foreground">
              {intakeText.length.toLocaleString()} / 50,000 characters
              {intakeText.trim().length < 100 ? " (need at least 100)" : ""}
            </p>
          </div>

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

          <fieldset>
            <legend className="text-xs font-medium">Seniority level</legend>
            <p className="mt-1 text-[0.65rem] text-muted-foreground">
              Optional. If you know the level, tell us and we bias the question
              mix accordingly (senior roles get more case-study scenarios;
              junior roles get more short knowledge checks). Otherwise the
              algorithm reads it from the role.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <SeniorityChip
                checked={claimedSeniority === null}
                onChange={() => setClaimedSeniority(null)}
                label="Let algorithm decide"
              />
              <SeniorityChip
                checked={claimedSeniority === "junior"}
                onChange={() => setClaimedSeniority("junior")}
                label="Junior"
              />
              <SeniorityChip
                checked={claimedSeniority === "mid"}
                onChange={() => setClaimedSeniority("mid")}
                label="Mid"
              />
              <SeniorityChip
                checked={claimedSeniority === "senior"}
                onChange={() => setClaimedSeniority("senior")}
                label="Senior"
              />
            </div>
          </fieldset>

          <label className="block">
            <span className="text-xs font-medium">
              Role location (optional)
            </span>
            <p className="mt-1 text-[0.65rem] text-muted-foreground">
              City / country. Used so questions reference the right currency,
              regulations, and local context.
            </p>
            <input
              type="text"
              value={roleLocation}
              onChange={(e) => setRoleLocation(e.target.value)}
              maxLength={120}
              placeholder="Lagos, Nigeria"
              className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
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

function SeniorityChip({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        "h-10 rounded-lg border px-3 text-xs font-semibold transition-colors",
        checked
          ? "border-foreground bg-foreground/5 text-foreground"
          : "border-border bg-card text-muted-foreground hover:border-etc-marigold",
      )}
    >
      {label}
    </button>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function humaniseExtractError(code: unknown, label: string): string {
  switch (code) {
    case "missing_file":
      return "No file was selected.";
    case "file_too_large":
    case "remote_too_large":
      return "That file is over the 5MB limit.";
    case "unsupported_file_type":
      return "We can read PDF, DOCX, and TXT files. Try one of those.";
    case "unsupported_remote_type":
      return "We couldn't read that link as a job posting. Paste the text instead.";
    case "extraction_failed":
      return "We couldn't read that file. Try a different format or paste the text.";
    case "extracted_text_too_short":
      return "We extracted very little text from that source — paste the role manually for a better assessment.";
    case "fetch_failed":
      return "We couldn't reach that link. Check the URL or paste the text instead.";
    case "blocked_host":
    case "unsupported_protocol":
      return "That link isn't supported. Use a public https URL.";
    case "invalid_url":
      return `"${label}" doesn't look like a valid URL.`;
    default:
      return "We couldn't process that source. Paste the text instead.";
  }
}

function parseQuestions(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*Q\s*[:.\-]\s*/i, "").trim())
    .filter((line) => line.length >= 10 && line.length <= 1000)
    .slice(0, 100);
}
