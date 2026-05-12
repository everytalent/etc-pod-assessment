// Apply 0005: feature_flags table (the new bit) + reconcile drizzle
// snapshot drift carried over from earlier hand-applied work
// (ai_scores, ai_*/score_source enums, transcript/score_source/
// scoring_rubric/ai_consensus/ai_pipeline_ran_at columns).
//
// Idempotent — any DDL already present in prod is detected by its
// SQLSTATE code and skipped, so the only practical effect on the
// current DB is creating feature_flags.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlText = readFileSync("drizzle/0005_magenta_the_hunter.sql", "utf8");
const statements = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

// 42P07 = duplicate_table / duplicate_index
// 42710 = duplicate_object (enum type, constraint)
// 42701 = duplicate_column
const SKIP_CODES = new Set(["42P07", "42710", "42701"]);

const sql = postgres(url, { connect_timeout: 15 });
try {
  for (const [i, stmt] of statements.entries()) {
    console.log(
      `[apply] ${i + 1}/${statements.length}:`,
      stmt.replace(/\s+/g, " ").slice(0, 100),
    );
    try {
      await sql.unsafe(stmt);
    } catch (err) {
      if (SKIP_CODES.has(err.code)) {
        console.log(`  (already applied [${err.code}], skipping)`);
      } else {
        throw err;
      }
    }
  }

  const flagRows = await sql`
    SELECT key, enabled_for_roles, updated_at
    FROM feature_flags
    ORDER BY key
  `;
  console.log("[apply] feature_flags rows:");
  console.table(flagRows);
} finally {
  await sql.end({ timeout: 2 });
}
