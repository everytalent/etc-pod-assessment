/**
 * Zoho OAuth + API client wrapper.
 *
 * Refreshes the access token on demand using the long-lived refresh token
 * stored in env. Caches the access token in module memory until ~5 min
 * before expiry.
 *
 * Strictly server-side. Importing this in a Client Component is a bug —
 * the refresh token must never reach the browser.
 */

const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry

interface CachedAccessToken {
  token: string;
  /** ms since epoch when the token actually expires (server-side clock). */
  expiresAt: number;
}

let cached: CachedAccessToken | null = null;

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(`${key} is required for the Zoho client`);
  }
  return v;
}

/**
 * Resolve the data-centre suffix (com / eu / in / com.au / com.cn / jp / sa).
 * Default 'com' covers most accounts.
 */
function dc(): string {
  return process.env.ZOHO_DC ?? "com";
}

/**
 * Hostnames vary per data centre.
 *
 *   accounts.zoho.{dc}    → OAuth (token refresh)
 *   www.zohoapis.{dc}     → WorkDrive REST API
 *   upload.zoho.{dc}      → WorkDrive file uploads (multipart)
 *   sheet.zoho.{dc}       → Sheet API
 *
 * Note: there is one wart on the Australian DC: accounts URL is
 * 'accounts.zoho.com.au' but the API host is 'www.zohoapis.com.au'.
 * Same suffix in both — we treat them uniformly.
 */
export const ZOHO_HOSTS = {
  accounts: () => `https://accounts.zoho.${dc()}`,
  api: () => `https://www.zohoapis.${dc()}`,
  upload: () => `https://upload.zoho.${dc()}`,
  sheet: () => `https://sheet.zoho.${dc()}`,
} as const;

/**
 * Get a valid access token. Refreshes if cache is empty or expired.
 * Concurrent callers share the same in-flight refresh promise.
 */
let refreshInFlight: Promise<CachedAccessToken> | null = null;

export async function getZohoAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + REFRESH_SAFETY_MARGIN_MS) {
    return cached.token;
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  const result = await refreshInFlight;
  cached = result;
  return result.token;
}

async function refreshAccessToken(): Promise<CachedAccessToken> {
  const url = `${ZOHO_HOSTS.accounts()}/oauth/v2/token`;
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
    throw new Error(
      `Zoho token refresh failed: ${res.status} ${text.slice(0, 500)}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Zoho token refresh returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
  const obj = data as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!obj.access_token) {
    throw new Error(`Zoho token refresh: missing access_token (${obj.error ?? "unknown"})`);
  }
  return {
    token: obj.access_token,
    expiresAt: Date.now() + (obj.expires_in ?? 3600) * 1000,
  };
}

/**
 * Authenticated fetch — adds the OAuth header automatically. Use the
 * underlying ZOHO_HOSTS to build the URL.
 */
export async function zohoFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getZohoAccessToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Zoho-oauthtoken ${token}`);
  }
  return fetch(url, { ...init, headers });
}

/**
 * Convenience JSON wrapper. Throws on non-2xx, returns the decoded body.
 */
export async function zohoFetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await zohoFetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Zoho ${init.method ?? "GET"} ${url} failed: ${res.status} ${text.slice(0, 500)}`,
    );
  }
  if (text === "") return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Zoho ${url} returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
}
