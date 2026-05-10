/**
 * Zoho WorkDrive helpers — folder discovery + file upload.
 *
 * Resource model is JSON:API style. Important shapes:
 *
 *   GET /files/{folderId}/files       → list children of folder
 *   POST /files                       → create folder (or any resource)
 *   POST /upload (on upload host)     → multipart file upload
 *
 * All requests are auth'd via the shared zohoFetch wrapper, which handles
 * token refresh transparently.
 */

import { ZOHO_HOSTS, zohoFetch, zohoFetchJson } from "./client";

interface WorkDriveResource {
  id: string;
  type: string;
  attributes: {
    name?: string;
    type?: string;
    is_folder?: boolean;
    resource_id?: string;
    [k: string]: unknown;
  };
}

interface ListResponse {
  data: WorkDriveResource[];
}

interface SingleResponse {
  data: WorkDriveResource;
}

/**
 * List immediate children of a folder. Pages of up to 100 items at a time;
 * we expect each assessment folder to be small (handful of subfolders +
 * sheet files), so a single page suffices.
 */
async function listChildren(parentId: string): Promise<WorkDriveResource[]> {
  const url = `${ZOHO_HOSTS.api()}/workdrive/api/v1/files/${parentId}/files?page%5Blimit%5D=100`;
  const json = await zohoFetchJson<ListResponse>(url);
  return Array.isArray(json.data) ? json.data : [];
}

function isFolderResource(item: WorkDriveResource): boolean {
  // Different Zoho responses use different fields. Be permissive.
  if (item.attributes.is_folder === true) return true;
  if (item.attributes.type === "folder") return true;
  return false;
}

/** Find a folder by name within a parent. Case-sensitive match. */
export async function findFolderByName(
  parentId: string,
  name: string,
): Promise<string | null> {
  const items = await listChildren(parentId);
  const target = items.find(
    (item) => isFolderResource(item) && item.attributes.name === name,
  );
  return target?.id ?? null;
}

/** Create a folder, return its id. */
export async function createFolder(
  parentId: string,
  name: string,
): Promise<string> {
  const url = `${ZOHO_HOSTS.api()}/workdrive/api/v1/files`;
  const body = {
    data: {
      attributes: { name, parent_id: parentId },
      type: "files",
    },
  };
  const res = await zohoFetchJson<SingleResponse>(url, {
    method: "POST",
    headers: { "Content-Type": "application/vnd.api+json" },
    body: JSON.stringify(body),
  });
  if (!res.data?.id) {
    throw new Error("WorkDrive create folder: missing id in response");
  }
  return res.data.id;
}

/** Lazy: find or create the named folder under parent. */
export async function ensureFolder(
  parentId: string,
  name: string,
): Promise<string> {
  const existing = await findFolderByName(parentId, name);
  if (existing) return existing;
  return createFolder(parentId, name);
}

/**
 * Upload a file's bytes to the given folder.
 * Returns the new file's resource_id and final name.
 *
 * Uses the multipart `content` field name (not `filename`, which Zoho's
 * older docs mention but their current API rejects with
 * `UPLOAD_RULE_NOT_CONFIGURED`). Some Zoho deployments accept either —
 * `content` is the more reliable choice.
 *
 * Host: `www.zohoapis.<dc>` (NOT `upload.zoho.<dc>` — that's a different
 * older Zoho Drive product, not WorkDrive).
 */
export async function uploadFile(args: {
  parentId: string;
  filename: string;
  contentType: string;
  body: Buffer | Uint8Array | string | Blob;
  /** If true, overwrite an existing file with the same name in the folder. */
  overwrite?: boolean;
}): Promise<{ id: string; name: string }> {
  const url = `${ZOHO_HOSTS.api()}/workdrive/api/v1/upload`;

  let blob: Blob;
  if (args.body instanceof Blob) {
    blob = args.body;
  } else if (typeof args.body === "string") {
    blob = new Blob([args.body], { type: args.contentType });
  } else {
    blob = new Blob([args.body as BlobPart], { type: args.contentType });
  }

  const form = new FormData();
  // Field name is `content` per current Zoho WorkDrive API. The
  // 3rd argument (filename) sets the multipart filename header.
  form.append("content", blob, args.filename);
  form.append("parent_id", args.parentId);
  form.append("override-name-exist", String(args.overwrite ?? true));

  const res = await zohoFetch(url, { method: "POST", body: form });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `WorkDrive upload failed: ${res.status} ${text.slice(0, 500)}`,
    );
  }

  const data = JSON.parse(text) as {
    data?: WorkDriveResource | WorkDriveResource[];
  };
  const item = Array.isArray(data.data) ? data.data[0] : data.data;
  if (!item) {
    throw new Error(`WorkDrive upload: empty response data`);
  }
  return {
    id: item.attributes?.resource_id ?? item.id,
    name: item.attributes?.name ?? args.filename,
  };
}

/**
 * Direct WorkDrive file URL — works for anyone signed in to your Zoho
 * team. Use this for emailing links to admins; they already have team
 * access. No URL Rules / public-share-link configuration needed.
 *
 * If you ever want truly public links, configure URL Rules under
 * WorkDrive admin and call createShareLink() instead.
 */
export function workDriveFileUrl(fileId: string): string {
  // workdrive.zoho.com is the same across DCs.
  return `https://workdrive.zoho.com/file/${fileId}`;
}

/** Same idea for folder URLs — used in archive notification emails. */
export function workDriveFolderUrl(folderId: string): string {
  return `https://workdrive.zoho.com/folder/${folderId}`;
}

/**
 * Generate a public share link for a file. Requires the WorkDrive team
 * admin to have configured "URL Rules" (allow public sharing).
 *
 * Zoho's role_id values: 5=view, 6=comment, 3=edit.
 *
 * Falls back to {@link workDriveFileUrl} (direct, signed-in-only URL) if
 * URL rules aren't configured. The function returns whichever it can.
 */
export async function createShareLink(
  fileId: string,
  options: { role: "view" | "comment" | "edit" } = { role: "view" },
): Promise<{ url: string; isPublic: boolean }> {
  const roleId =
    options.role === "edit" ? "3" : options.role === "comment" ? "6" : "5";
  const url = `${ZOHO_HOSTS.api()}/workdrive/api/v1/files/${fileId}/sharelinks`;
  const body = {
    data: {
      attributes: { role_id: roleId, password: "" },
      type: "file_sharelink",
    },
  };
  try {
    type LinkResponse = {
      data?: { attributes?: { link?: string; share_link?: string } };
    };
    const json = await zohoFetchJson<LinkResponse>(url, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.api+json" },
      body: JSON.stringify(body),
    });
    const link =
      json.data?.attributes?.link ?? json.data?.attributes?.share_link;
    if (link) return { url: link, isPublic: true };
  } catch {
    // URL rules likely not configured. Fall through to direct URL.
  }
  return { url: workDriveFileUrl(fileId), isPublic: false };
}

/** Delete a file by id. Used by the audio archive flow once the upload to Zoho confirms. */
export async function deleteFile(fileId: string): Promise<void> {
  const url = `${ZOHO_HOSTS.api()}/workdrive/api/v1/files/${fileId}`;
  const res = await zohoFetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`WorkDrive delete failed: ${res.status} ${text.slice(0, 200)}`);
  }
}
