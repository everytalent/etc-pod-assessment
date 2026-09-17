/**
 * What an ETC question is allowed to ask.
 *
 * The skillboard defines a specialisation as a set of TASKS a person has
 * to be able to carry out. A question therefore earns its place by
 * telling us whether the candidate can carry out the task. Whether they
 * can expand an acronym tells us nothing about that: it is cheap to
 * revise, cheap to guess from the option list, and someone who does the
 * work daily can fail it while someone who has never touched a site can
 * pass it.
 *
 * "MPPT stands for:" with four expansions to choose from is the shape we
 * are ruling out. Not the multiple-choice format, which is fine and
 * often the right tool: the RECALL FRAMING. The same atom becomes a good
 * question the moment it asks what the candidate would do about it on a
 * real job.
 *
 * Generators are told this in their prompt, but a prompt is a request,
 * not a guarantee, and model output drifts back toward definitions
 * because definitions are easy to write. So the rule is also enforced in
 * code on the way to the database.
 */

export interface QuestionShapeIssue {
  pattern: string;
  message: string;
}

/**
 * Phrasings that are recall-shaped regardless of subject matter.
 *
 * Deliberately narrow: each one matches a question whose ANSWER is a
 * piece of vocabulary. Anything that merely mentions a term in the
 * course of describing a situation must pass, or we would reject most
 * legitimate scenario questions, so these are anchored to the
 * interrogative rather than left as loose keyword matches.
 */
const RECALL_PATTERNS: Array<{ re: RegExp; message: string }> = [
  {
    // Anchored to an actual acronym rather than the bare phrase: "the
    // client stands for nothing less than a replacement" is ordinary
    // prose in a perfectly good scenario question, and an earlier
    // version of this rule rejected it.
    re: /\b[A-Z][A-Z0-9]+\s+stands?\s+for\b/,
    message:
      "asks a candidate to expand an acronym, which measures vocabulary rather than whether they can do the task",
  },
  {
    // The same question with the acronym left implicit, e.g. a stem that
    // simply trails off into "... stands for:".
    re: /\bstands?\s+for\s*:?\s*$/i,
    message: "trails off into an acronym expansion rather than asking for an action",
  },
  {
    re: /\bwhat\s+(?:does|do)\s+.{1,40}?\s+(?:mean|stand for)\b/i,
    message: "asks for the meaning of a term rather than for a decision or action",
  },
  {
    re: /\bwhich\s+(?:of\s+the\s+following\s+)?(?:is|best)\s+(?:the\s+)?(?:definition|meaning)\b/i,
    message: "asks the candidate to match a term to its definition",
  },
  {
    re: /\bis\s+(?:the\s+term\s+)?defined\s+as\b/i,
    message: "tests a definition rather than applied judgement",
  },
  {
    re: /^\s*define\b/i,
    message: "opens by asking for a definition",
  },
  {
    re: /\bthe\s+(?:acronym|abbreviation)\s+.{0,40}\b(?:means|refers to|represents)\b/i,
    message: "tests an abbreviation rather than the underlying task",
  },
  {
    re: /\bwhich\s+term\s+(?:describes|refers to|is used for)\b/i,
    message: "asks the candidate to name a concept rather than apply it",
  },
];

/**
 * Returns every reason this question text is recall-shaped. Empty means
 * the text is acceptable on this axis (it says nothing about whether the
 * question is otherwise good).
 */
export function questionShapeIssues(questionText: string): QuestionShapeIssue[] {
  const issues: QuestionShapeIssue[] = [];
  for (const { re, message } of RECALL_PATTERNS) {
    if (re.test(questionText)) {
      issues.push({ pattern: re.source, message });
    }
  }
  return issues;
}

/** Convenience predicate for filtering generated batches. */
export function isRecallShaped(questionText: string): boolean {
  return questionShapeIssues(questionText).length > 0;
}

/**
 * The instruction block handed to every question-generating prompt.
 *
 * Kept next to the validator on purpose: when the rule changes, the
 * thing we ask for and the thing we enforce should change together,
 * rather than drifting apart in two files.
 */
export const TASK_PERFORMANCE_RULES = `WHAT A QUESTION IS FOR
The skillboard describes a task the person has to be able to carry out. Every question must tell us whether this candidate could carry it out. Nothing else is worth a candidate's time.

- Put the candidate in a situation and ask what they would DO: decide, diagnose, prioritise, sequence, calculate, check, or push back. The answer must be an action or a judgement, never a term.
- NEVER ask a candidate to expand an acronym, define a term, or match a word to its meaning. "MPPT stands for:" is banned outright, and so is every variation of it. Someone who does this work daily may not have memorised the words behind the letters, and someone who has never done it can learn them in a minute, so the question separates the wrong people.
- Multiple choice is fine and often the right format. The options must be competing COURSES OF ACTION or competing JUDGEMENTS about a described situation, not competing definitions.
- Wrong options must be answers a real person doing this job could genuinely arrive at, drawn from a mistake that actually happens on site. If a distractor is obviously silly, it is not doing any work.
- If you cannot write a situation for the task, the question is not ready. Do not fall back to asking what something is called.`;
