import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __d = resolve(fileURLToPath(import.meta.url), "..");
const root = resolve(__d, "..");
for (const f of [".env", ".env.local"]) {
  const p = resolve(root, f);
  if (existsSync(p)) loadEnv({ path: p, override: true });
}

const { desc } = await import("drizzle-orm");
const { db } = await import("../lib/db/client.js");
const { notifyLog } = await import("../lib/db/schema.js");

const rows = await db
  .select()
  .from(notifyLog)
  .orderBy(desc(notifyLog.deliveredAt))
  .limit(10);

for (const r of rows) {
  console.log(
    r.deliveredAt.toISOString(),
    r.severity.padEnd(8),
    r.eventType.padEnd(40),
    r.channel.padEnd(6),
    r.deliveryStatus,
  );
  if (r.eventType === "onboarding_completion_callback") {
    console.log("  payload:", JSON.stringify(r.payload, null, 2).slice(0, 800));
  }
}
console.log(`\n${rows.length} rows`);
process.exit(0);
