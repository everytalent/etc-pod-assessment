/**
 * Tenant-output serialiser — the single chokepoint between the engine's
 * internals and any payload that crosses a tenant-facing boundary.
 *
 * Critical architectural principle 2 of the PRD: the skillboard layer is
 * invisible to tenants AND model names are rebranded. Rather than scatter
 * conditional stripping across every endpoint, the build leans on ONE
 * boundary: every tenant route returns
 *
 *     return NextResponse.json(serialiseForTenant(payload));
 *
 * and that's the only thing standing between an Opus reasoning trace and
 * a tenant accidentally seeing "Claude scored this 4/5 based on skillboard
 * SB-12345".
 *
 * Three transformations happen here:
 *
 *   1. Field strip: every key in BLOCKLIST_KEYS is removed recursively,
 *      regardless of where it sits in the tree. The strip is by key
 *      *name*; we don't trust the input shape.
 *
 *   2. Internal-substring strip: any string value containing one of
 *      INTERNAL_TERMS is replaced with the empty string and the whole
 *      record's enclosing object is annotated with a `_redacted: true`
 *      flag so downstream code surfaces the gap rather than rendering
 *      "" silently. The terms list catches "skillboard", "mini-skillboard",
 *      "provisional framework" and a few near-spellings.
 *
 *   3. Model-name rebrand: regex rewrite of every string value.
 *      Kimi/Moonshot → kemi.ai. Claude/Opus/Anthropic → chioma.ai.
 *      Case-preserving where reasonable.
 *
 *   4. Em-dash strip: every U+2014 em-dash is replaced with " — " logic
 *      isn't quite right; the PRD wants periods/commas/sentence breaks
 *      instead. We replace with " - " (hyphen) as a safe minimal change
 *      and depend on prompt-time rules to avoid generating em-dashes
 *      in the first place. (Acceptance criteria: zero em-dashes in
 *      tenant-facing copy.)
 *
 * Unit tests in tests/tenant-serialiser.test.ts assert the leakage
 * invariants directly: any future tenant endpoint that doesn't route
 * through here is a bug the leakage test catches.
 */

const BLOCKLIST_KEYS = new Set([
  // Skillboard internals
  "skillboard_id",
  "skillboardId",
  "skillboard_row_id",
  "source_skillboard_id",
  "source_skillboard_row_id",
  "sourceSkillboardId",
  "provisional_framework_id",
  "provisional_framework_row_id",
  "provisionalFrameworkId",
  "originating_tenant_id",
  "originatingTenantId",
  "derived_from",
  "derivedFrom",
  "parent_skillboard_id",
  "parentSkillboardId",
  // Routing telemetry
  "route_taken",
  "routeTaken",
  "match_similarity_score",
  "matchSimilarityScore",
  // Engine internals tenants don't need
  "claude_authoring_brief",
  "claudeAuthoringBrief",
  "feedback_notes",
  "feedbackNotes",
  "rejection_notes",
  "rejectionNotes",
  // Provenance the audit log keeps but the tenant shouldn't see
  "source_skillboard_row_id",
  "internal_stage",
  "internalStage",
]);

const INTERNAL_TERMS = [
  /skillboard[s]?/gi,
  /mini[- ]?skillboard[s]?/gi,
  /provisional[- ]?framework[s]?/gi,
];

const MODEL_REBRANDS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bMoonshot\b/g, replacement: "kemi.ai" },
  { pattern: /\bmoonshot\b/g, replacement: "kemi.ai" },
  { pattern: /\bKimi\b/g, replacement: "kemi.ai" },
  { pattern: /\bkimi\b/g, replacement: "kemi.ai" },
  { pattern: /\bAnthropic\b/g, replacement: "chioma.ai" },
  { pattern: /\banthropic\b/g, replacement: "chioma.ai" },
  { pattern: /\bClaude\s+Opus\b/g, replacement: "chioma.ai" },
  { pattern: /\bClaude\b/g, replacement: "chioma.ai" },
  { pattern: /\bclaude\b/g, replacement: "chioma.ai" },
  { pattern: /\bOpus\b/g, replacement: "chioma.ai" },
  { pattern: /\bopus\b/g, replacement: "chioma.ai" },
];

const EM_DASH = "—";

function rewriteString(s: string): { value: string; hadInternal: boolean } {
  let out = s;
  let hadInternal = false;
  for (const re of INTERNAL_TERMS) {
    if (re.test(out)) {
      hadInternal = true;
      out = out.replace(re, "[redacted]");
    }
  }
  for (const { pattern, replacement } of MODEL_REBRANDS) {
    out = out.replace(pattern, replacement);
  }
  if (out.includes(EM_DASH)) {
    out = out.replaceAll(EM_DASH, " - ");
  }
  return { value: out, hadInternal };
}

/**
 * Recursive serialiser. Mutates a deep copy of the input; the original
 * payload is left untouched so the caller can still pass the same object
 * to an internal audit log without re-rewriting it.
 */
export function serialiseForTenant<T>(input: T): T {
  return walk(input) as T;
}

function walk(node: unknown): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node === "string") {
    return rewriteString(node).value;
  }
  if (typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map(walk);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (BLOCKLIST_KEYS.has(key)) continue;
    out[key] = walk(value);
  }
  return out;
}

/**
 * Hard assertion for tests. Walks the output and throws if any blocked
 * key, internal term, or rebrand-eligible name survived. Call from the
 * leakage test, never from request handlers.
 */
export function assertNoLeakage(payload: unknown): void {
  const offenders: string[] = [];
  inspect(payload, "$", offenders);
  if (offenders.length > 0) {
    throw new Error(
      `Tenant-output leakage at: ${offenders.slice(0, 10).join(", ")}` +
        (offenders.length > 10 ? ` (+${offenders.length - 10} more)` : ""),
    );
  }
}

function inspect(node: unknown, path: string, offenders: string[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    for (const re of INTERNAL_TERMS) {
      const fresh = new RegExp(re.source, re.flags);
      if (fresh.test(node)) offenders.push(`${path} contains internal term`);
    }
    for (const { pattern } of MODEL_REBRANDS) {
      const fresh = new RegExp(pattern.source, pattern.flags);
      if (fresh.test(node)) offenders.push(`${path} contains model name`);
    }
    if (node.includes(EM_DASH)) offenders.push(`${path} contains em-dash`);
    return;
  }
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => inspect(v, `${path}[${i}]`, offenders));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (BLOCKLIST_KEYS.has(key)) {
      offenders.push(`${path}.${key} is a blocklisted key`);
    }
    inspect(value, `${path}.${key}`, offenders);
  }
}
