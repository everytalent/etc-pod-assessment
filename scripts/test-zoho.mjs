// Connectivity smoke-test for Zoho creds. Verifies:
//   1. Refresh-token exchange returns an access_token.
//   2. The access_token can call /users/me on WorkDrive.
//   3. The configured ZOHO_WORKDRIVE_ROOT_FOLDER_ID is reachable + we can
//      list its contents.
//
// Strictly side-effect-free — does not write anything.
//
// Run: pnpm exec dotenv -e .env.local -- node scripts/test-zoho.mjs

const dc = process.env.ZOHO_DC ?? "com";
const accountsHost = `https://accounts.zoho.${dc}`;
const apiHost = `https://www.zohoapis.${dc}`;

function envOrThrow(key) {
  const v = process.env[key];
  if (!v) {
    console.error(`ENV missing: ${key}`);
    process.exit(1);
  }
  return v;
}

async function refresh() {
  const url = `${accountsHost}/oauth/v2/token`;
  const body = new URLSearchParams({
    refresh_token: envOrThrow("ZOHO_REFRESH_TOKEN"),
    client_id: envOrThrow("ZOHO_CLIENT_ID"),
    client_secret: envOrThrow("ZOHO_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[refresh] FAIL ${res.status}\n${text}`);
    process.exit(1);
  }
  const data = JSON.parse(text);
  if (!data.access_token) {
    console.error(`[refresh] FAIL — no access_token in response:\n${text}`);
    process.exit(1);
  }
  console.log(
    `[refresh] OK — access_token granted (expires in ${data.expires_in}s)`,
  );
  return data.access_token;
}

async function getUser(token) {
  const url = `${apiHost}/workdrive/api/v1/users/me`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[users/me] FAIL ${res.status}\n${text.slice(0, 500)}`);
    process.exit(1);
  }
  const data = JSON.parse(text);
  const u = data?.data?.attributes ?? {};
  console.log(
    `[users/me] OK — ${u.display_name ?? u.email_id ?? "(unknown)"} (${u.email_id ?? "no-email"})`,
  );
  return data;
}

async function listRootFolder(token) {
  const folderId = envOrThrow("ZOHO_WORKDRIVE_ROOT_FOLDER_ID");
  // List items under the root folder.
  const url = `${apiHost}/workdrive/api/v1/files/${folderId}/files?page%5Blimit%5D=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(
      `[list root] FAIL ${res.status} for folder ${folderId}\n${text.slice(0, 500)}`,
    );
    console.error(
      `\nMost likely the folder ID is wrong, or this account doesn't have access. ` +
        `Open WorkDrive in browser, navigate to the folder, copy the part of the URL ` +
        `after /folder/ — paste it as ZOHO_WORKDRIVE_ROOT_FOLDER_ID.`,
    );
    process.exit(1);
  }
  const data = JSON.parse(text);
  const count = Array.isArray(data?.data) ? data.data.length : 0;
  console.log(
    `[list root] OK — folder ${folderId} reachable, ${count} immediate child item(s) listed.`,
  );
}

async function main() {
  console.log(`[zoho] DC = ${dc}`);
  console.log(`[zoho] accounts host = ${accountsHost}`);
  console.log(`[zoho] api host = ${apiHost}`);
  const token = await refresh();
  await getUser(token);
  await listRootFolder(token);
  console.log("\nAll three checks passed. Zoho creds are good.");
}

main().catch((err) => {
  console.error("[zoho] unexpected error:", err);
  process.exit(1);
});
