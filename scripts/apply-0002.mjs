// Apply 0002 migration (open-ended answer columns) + create the
// voice-responses Storage bucket. Idempotent.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlText = readFileSync("drizzle/0002_freezing_mandrill.sql", "utf8");
const statements = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const sql = postgres(url, { connect_timeout: 15 });
try {
  for (const [i, stmt] of statements.entries()) {
    console.log(`[apply] ${i + 1}/${statements.length}:`, stmt.replace(/\s+/g, " ").slice(0, 80));
    // ALTER TABLE ADD COLUMN IF NOT EXISTS — but Drizzle generates plain ADD COLUMN.
    // To make idempotent on re-runs, catch the "already exists" error.
    try {
      await sql.unsafe(stmt);
    } catch (err) {
      if (err.code === "42701") {
        console.log("  (column already exists, skipping)");
      } else {
        throw err;
      }
    }
  }

  console.log("[storage] creating voice-responses bucket if absent…");
  await sql`
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'voice-responses',
      'voice-responses',
      false,
      52428800,
      ARRAY['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // RLS policies — service role bypasses these, but they're useful as
  // defence-in-depth if anon ever gets a leaked path.
  console.log("[storage] applying RLS policies…");
  // Drop existing then recreate (idempotent).
  await sql.unsafe(`
    DROP POLICY IF EXISTS "voice_responses_no_anon_select" ON storage.objects;
    DROP POLICY IF EXISTS "voice_responses_no_anon_insert" ON storage.objects;
  `);
  await sql.unsafe(`
    CREATE POLICY "voice_responses_no_anon_select"
      ON storage.objects FOR SELECT
      TO anon
      USING (bucket_id <> 'voice-responses');
  `);
  await sql.unsafe(`
    CREATE POLICY "voice_responses_no_anon_insert"
      ON storage.objects FOR INSERT
      TO anon
      WITH CHECK (bucket_id <> 'voice-responses');
  `);

  const buckets = await sql`SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'voice-responses'`;
  console.log("[storage] bucket:");
  console.table(buckets);
} finally {
  await sql.end({ timeout: 2 });
}
