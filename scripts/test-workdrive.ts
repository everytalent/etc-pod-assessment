/**
 * End-to-end WorkDrive smoke test:
 *   1. ensureFolder('etc-pod-archive') under root
 *   2. ensureFolder('test-zoho-conn') inside that
 *   3. Upload a tiny .txt file
 *   4. Mint a view share-link
 *
 * Re-runs are idempotent (folders are reused; file is overwritten).
 *
 * Run: pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/test-workdrive.ts
 */

import {
  createShareLink,
  ensureFolder,
  uploadFile,
} from "@/lib/zoho/workdrive";

async function main() {
  const root = process.env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID;
  if (!root) {
    console.error("ZOHO_WORKDRIVE_ROOT_FOLDER_ID missing");
    process.exit(1);
  }

  console.log(`[1/5] root folder = ${root}`);

  const archiveRoot = await ensureFolder(root, "etc-pod-archive");
  console.log(`[2/5] etc-pod-archive folder id = ${archiveRoot}`);

  const testFolder = await ensureFolder(archiveRoot, "test-zoho-conn");
  console.log(`[3/5] test-zoho-conn folder id = ${testFolder}`);

  const file = await uploadFile({
    parentId: testFolder,
    filename: `smoke-test-${new Date().toISOString().slice(0, 10)}.txt`,
    contentType: "text/plain",
    body: `ETC POD smoke test\nUploaded at ${new Date().toISOString()}\n`,
    overwrite: true,
  });
  console.log(`[4/5] uploaded file id = ${file.id} (name: ${file.name})`);

  const link = await createShareLink(file.id, { role: "view" });
  console.log(
    `[5/5] link = ${link.url}  (${link.isPublic ? "public share link" : "team-only direct URL — URL Rules not configured"})`,
  );

  console.log("\nAll WorkDrive operations passed.");
}

main().catch((err) => {
  console.error("[test-workdrive] failed:", err);
  process.exit(1);
});
