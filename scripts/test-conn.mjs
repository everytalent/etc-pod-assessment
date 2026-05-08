// Tiny one-shot DB connectivity test. DATABASE_URL must be supplied via the
// caller's environment (we wrap with `dotenv -e .env.local`). Prints the actual
// error so we can diagnose past drizzle-kit's spinner. Delete after use.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

// Mask password in the printout so we don't leak it.
const masked = url.replace(/(:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
console.log("[test] connecting to:", masked);

try {
  const sql = postgres(url, { connect_timeout: 15, idle_timeout: 5 });
  const rows = await sql`SELECT 1 AS ok`;
  console.log("[test] connected. SELECT 1 →", rows);
  await sql.end({ timeout: 2 });
  process.exit(0);
} catch (err) {
  console.error("[test] connection failed:");
  console.error(err);
  process.exit(1);
}
