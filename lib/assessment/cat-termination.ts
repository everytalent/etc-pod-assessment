/**
 * Confidence-driven CAT termination and picker.
 *
 * Replaces the earlier sequential-by-order_index picker + hard 25-question
 * soft cap with a 1PL (Rasch-like) Bayesian estimator over a discrete
 * grid. After every answered question the posterior over the candidate's
 * ability theta is updated; the engine stops when we're confident enough
 * or the soft ceiling is hit.
 *
 * Design choices (kept deliberately simple):
 *
 * - Theta and difficulty share a 0-10 scale. Questions carry
 *   difficulty_score (1-10) already; theta is anchored on the same axis
 *   so item selection is difficulty ≈ theta.
 * - Prior: truncated Gaussian centred at 5 with sd 1.5, discretised on
 *   101 grid points (0.0, 0.1, ..., 10.0). Wide enough to move fast in
 *   the first few probes.
 * - Likelihood: for question with difficulty d, expected correctness is
 *   logistic((theta - d) / slope). The observed value is the answer's
 *   score/points ratio in [0, 1]; we treat it as a soft correctness
 *   observation via a beta-like weighting.
 * - Termination: posterior SD ≤ 0.55 AND answered ≥ MIN_QUESTIONS, OR
 *   hard cap at MAX_QUESTIONS. Cap remains as a runaway guard.
 * - Selection: pick the unanswered question whose difficulty minimises
 *   |difficulty - mean(theta)|. This maximises Fisher information for
 *   Rasch models and biases toward questions the candidate is likely to
 *   find diagnostic.
 *
 * Not implementing (deferred): 2PL/3PL parameters, per-band exposure
 * control, content-balancing across skills. These are worth adding once
 * we have enough completions to fit parameters. For now this is a real
 * confidence-driven CAT; it just uses the difficulty_score authors set.
 */

const GRID_SIZE = 101;
const GRID_MIN = 0;
const GRID_MAX = 10;
const GRID_STEP = (GRID_MAX - GRID_MIN) / (GRID_SIZE - 1);
const PRIOR_MEAN = 5;
const PRIOR_SD = 2.0;
const LIKELIHOOD_SLOPE = 1.0;

export const MIN_QUESTIONS = 8;
export const MAX_QUESTIONS = 25;
export const SE_STOP_THRESHOLD = 0.7;

export type CatAnswer = {
  difficulty: number;
  scoreRatio: number;
};

export type CatDecision =
  | { kind: "next"; questionId: string; posterior: PosteriorSummary }
  | { kind: "end"; posterior: PosteriorSummary; reason: TerminationReason };

export type CatCandidateQuestion = {
  id: string;
  difficulty: number;
};

export type TerminationReason =
  | "confidence_reached"
  | "hard_cap_hit"
  | "no_more_questions";

export type PosteriorSummary = {
  mean: number;
  sd: number;
  answered: number;
};

function logistic(x: number): number {
  if (x >= 0) {
    const e = Math.exp(-x);
    return 1 / (1 + e);
  }
  const e = Math.exp(x);
  return e / (1 + e);
}

function buildGrid(): number[] {
  const g = new Array<number>(GRID_SIZE);
  for (let i = 0; i < GRID_SIZE; i++) g[i] = GRID_MIN + i * GRID_STEP;
  return g;
}

function priorLogWeights(grid: number[]): number[] {
  const w = new Array<number>(GRID_SIZE);
  const twoSigmaSq = 2 * PRIOR_SD * PRIOR_SD;
  for (let i = 0; i < GRID_SIZE; i++) {
    const d = grid[i]! - PRIOR_MEAN;
    w[i] = -(d * d) / twoSigmaSq;
  }
  return w;
}

/**
 * Update posterior log-weights with one observed answer.
 * Uses a soft-correctness likelihood: for observed ratio p in [0, 1]
 * and expected correctness E = logistic((theta - d) / slope), the log-
 * likelihood is p * ln(E) + (1 - p) * ln(1 - E). This reduces to the
 * standard Bernoulli log-likelihood when p is 0 or 1 and interpolates
 * smoothly for partial-credit answers.
 */
function accumulateLikelihood(
  logWeights: number[],
  grid: number[],
  answer: CatAnswer,
): void {
  const p = Math.min(1, Math.max(0, answer.scoreRatio));
  for (let i = 0; i < GRID_SIZE; i++) {
    const theta = grid[i]!;
    const z = (theta - answer.difficulty) / LIKELIHOOD_SLOPE;
    const eCorrect = logistic(z);
    // Guard against ln(0). eCorrect is in (0, 1) already but clamp for
    // safety against extreme z.
    const eSafe = Math.min(1 - 1e-9, Math.max(1e-9, eCorrect));
    logWeights[i]! += p * Math.log(eSafe) + (1 - p) * Math.log(1 - eSafe);
  }
}

function summarise(
  logWeights: number[],
  grid: number[],
  answered: number,
): PosteriorSummary {
  // Normalise by subtracting max, exp, sum, then compute mean/variance.
  let maxLog = -Infinity;
  for (let i = 0; i < GRID_SIZE; i++) {
    if (logWeights[i]! > maxLog) maxLog = logWeights[i]!;
  }
  let z = 0;
  const w = new Array<number>(GRID_SIZE);
  for (let i = 0; i < GRID_SIZE; i++) {
    const e = Math.exp(logWeights[i]! - maxLog);
    w[i] = e;
    z += e;
  }
  let mean = 0;
  for (let i = 0; i < GRID_SIZE; i++) {
    mean += grid[i]! * (w[i]! / z);
  }
  let variance = 0;
  for (let i = 0; i < GRID_SIZE; i++) {
    const d = grid[i]! - mean;
    variance += d * d * (w[i]! / z);
  }
  return { mean, sd: Math.sqrt(variance), answered };
}

/**
 * Decide next question or terminate given the sequence of observed
 * answers and the pool of unanswered questions. Returns a `next` with
 * the selected question and current posterior, or `end` with a
 * termination reason.
 */
export function decideNext(
  answers: CatAnswer[],
  candidates: CatCandidateQuestion[],
): CatDecision {
  const grid = buildGrid();
  const logWeights = priorLogWeights(grid);
  for (const a of answers) accumulateLikelihood(logWeights, grid, a);
  const posterior = summarise(logWeights, grid, answers.length);

  if (answers.length >= MAX_QUESTIONS) {
    return { kind: "end", posterior, reason: "hard_cap_hit" };
  }
  if (
    answers.length >= MIN_QUESTIONS &&
    posterior.sd <= SE_STOP_THRESHOLD
  ) {
    return { kind: "end", posterior, reason: "confidence_reached" };
  }
  if (candidates.length === 0) {
    return { kind: "end", posterior, reason: "no_more_questions" };
  }

  // Information-maximising pick: minimise |difficulty - mean|.
  let best: CatCandidateQuestion | null = null;
  let bestGap = Infinity;
  for (const q of candidates) {
    const gap = Math.abs(q.difficulty - posterior.mean);
    if (gap < bestGap) {
      bestGap = gap;
      best = q;
    }
  }
  if (!best) {
    return { kind: "end", posterior, reason: "no_more_questions" };
  }
  return { kind: "next", questionId: best.id, posterior };
}
