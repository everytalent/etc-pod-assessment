// Applies drizzle/0000_curly_korg.sql directly via postgres-js, bypassing
// drizzle-kit's TTY-required interactive prompt. Used for one-shot runs from
// non-interactive shells (this CI/agent context). Idempotent: re-running on a
// populated DB will fail loudly (CREATE TABLE without IF NOT EXISTS) — that's
// the correct behaviour for a fresh deploy.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlText = readFileSync("drizzle/0000_curly_korg.sql", "utf8");
const statements = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`[apply] ${statements.length} statements to run`);

const sql = postgres(url, { connect_timeout: 15 });
try {
  for (const [i, stmt] of statements.entries()) {
    const summary = stmt.replace(/\s+/g, " ").slice(0, 80);
    console.log(`[apply] ${i + 1}/${statements.length}: ${summary}…`);
    await sql.unsafe(stmt);
  }
  console.log("[apply] done.");
} catch (err) {
  console.error("[apply] failed:", err.message);
  process.exit(1);
} finally {
  await sql.end({ timeout: 2 });
}
