/**
 * One-off: reframe the live questions that opened by asking for a
 * definition.
 *
 * A skillboard describes tasks a person must be able to carry out, so a
 * question earns its place by showing whether they can carry one out.
 * These five each had a genuinely good applied question bolted onto a
 * "Define X and ..." stem, which is the half that measures vocabulary
 * rather than capability. The applied half is kept; the stem is replaced
 * with the situation it was really about.
 *
 * Every one of these had zero answers recorded, so no candidate's result
 * changes and nothing historical becomes incomparable. Each update is
 * guarded on the exact text it expects to find, so re-running it after
 * someone edits a question by hand does nothing rather than overwriting
 * their work.
 *
 * The generator that produced them has been fixed too: see
 * lib/engines/assessment/question-shape.ts, which both instructs and
 * enforces the rule. This script only cleans up what shipped before it.
 *
 * Run: pnpm dotenv -e .env.local -- pnpm tsx scripts/retire-recall-questions.ts
 */

import { eq } from "drizzle-orm";

import { db } from "../lib/db/client";
import { questions } from "../lib/db/schema";
import { questionShapeIssues } from "../lib/engines/assessment/question-shape";

interface Rewrite {
  id: string;
  /** Prefix of the text we expect to replace. Guards against clobbering. */
  expectedPrefix: string;
  questionText: string;
  /** Only set where dropping the "define" ask would make the rubric unfair. */
  rubricFrom?: string;
  rubricTo?: string;
}

const REWRITES: Rewrite[] = [
  {
    id: "54bc97fc-6906-4b56-853c-98cf1666ff7d",
    expectedPrefix: "Define what 'stale' and 'dormant' mean",
    questionText:
      "It is Monday triage and your database flags 340 candidates as inactive. Some have bouncing email addresses and CVs for roles that no longer exist. Others were placed eight months ago, or paused their search. Your manager wants the list halved by Friday. How do you split it, what happens to each group, and which single signal would you trust most to tell the two apart? Say what the business loses if you get the split wrong in either direction.",
    // Rubric already asks the candidate to distinguish and to justify,
    // which this scenario still requires. Left as is.
  },
  {
    id: "1054c67d-e1e1-4935-8ca7-1f3c8f34280b",
    expectedPrefix: "Define 'submit-to-interview conversion rate'",
    questionText:
      "Your last 20 submissions to one client produced 14 first-round interviews but only 1 offer. The client tells you the shortlists are \"fine\". Reading those two numbers together, what is actually going wrong with how you are calibrating against their bar, and what would you do differently on the next mandate? Use the numbers in your answer.",
    rubricFrom:
      "Candidate correctly defines submit-to-interview as (# candidates advanced to interview / # candidates submitted) and interview-to-offer as (# offers extended / # candidates interviewed).",
    rubricTo:
      "Candidate reads both ratios correctly off the numbers given (14/20 = 70% submit-to-interview, 1/14 = 7% interview-to-offer) rather than reacting to one of them alone.",
  },
  {
    id: "375b224a-9759-4ff9-8fae-79b981e2c447",
    expectedPrefix: "Define what a 'silver-medallist' candidate is",
    questionText:
      "A client picks one of your three finalists. The other two interviewed well and were close. In Friday triage you have about five minutes on each of their profiles before you move on, and realistically you will not open them again for six months. What do you record on them, and why does each item earn its place?",
    rubricFrom:
      "Correctly defines silver-medallist as a strong finalist who was not hired (not a weak applicant).",
    rubricTo:
      "Treats the two unplaced finalists as high-value re-engagement targets rather than as rejected applicants, and the recording choices reflect that.",
  },
  {
    id: "725ebdc4-083d-48a8-8f6d-985b19c58f96",
    expectedPrefix: "Define 'must-haves' versus 'nice-to-haves'",
    questionText:
      "You are 20 minutes into a 45-minute intake call. The hiring manager has just reeled off nine must-haves, including \"PVsyst expert\" and \"degree from a top-five university\". You suspect at most three are genuinely non-negotiable. How do you use the rest of the call to find out which, without putting the client on the defensive? Give the specific questions you would ask and what each answer would tell you.",
    rubricFrom:
      "(1) Clear definition — must-haves are criteria without which a candidate cannot perform the role or will be rejected at screening; nice-to-haves improve fit but are tradable.",
    rubricTo:
      "(1) Works from a sound working distinction — must-haves are criteria without which a candidate cannot perform the role or will be rejected at screening, while nice-to-haves improve fit but are tradable. This should show in how they test the list; they do not need to state it as a definition.",
  },
  {
    id: "ec22a26e-fbf9-42f1-a69e-d784591906ba",
    expectedPrefix: "Define what makes a solar lead 'qualified'",
    questionText:
      "A Lagos homeowner fills in your web form and replies \"yes I am interested\" to your first message. Your senior colleague takes handovers twice a week and pushes back hard on leads that are not ready. What do you need to establish before you hand this one over, and why does each item matter? Name at least four things.",
    // Rubric is a list of criteria plus "must explain WHY each matters",
    // which the scenario asks for directly. Left as is.
  },
];

async function main(): Promise<void> {
  let updated = 0;
  let skipped = 0;

  for (const r of REWRITES) {
    const [row] = await db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        scoringRubric: questions.scoringRubric,
      })
      .from(questions)
      .where(eq(questions.id, r.id))
      .limit(1);

    if (!row) {
      console.log(`[skip] ${r.id} no longer exists`);
      skipped += 1;
      continue;
    }
    if (!row.questionText.startsWith(r.expectedPrefix)) {
      console.log(`[skip] ${r.id} has already been changed, leaving it alone`);
      skipped += 1;
      continue;
    }

    // Refuse to write a replacement that is itself recall-shaped.
    const issues = questionShapeIssues(r.questionText);
    if (issues.length > 0) {
      throw new Error(
        `replacement for ${r.id} is still recall-shaped: ${issues[0].message}`,
      );
    }

    let rubric = row.scoringRubric;
    if (r.rubricFrom && r.rubricTo) {
      if (!rubric?.includes(r.rubricFrom)) {
        console.log(`[skip] ${r.id} rubric no longer matches, leaving it alone`);
        skipped += 1;
        continue;
      }
      rubric = rubric.replace(r.rubricFrom, r.rubricTo);
    }

    await db
      .update(questions)
      .set({ questionText: r.questionText, scoringRubric: rubric })
      .where(eq(questions.id, r.id));

    console.log(`[done] ${r.id}`);
    console.log(`       was: ${row.questionText.slice(0, 80)}...`);
    console.log(`       now: ${r.questionText.slice(0, 80)}...`);
    updated += 1;
  }

  console.log(`\n${updated} rewritten, ${skipped} skipped.`);
  process.exit(0);
}

void main();
