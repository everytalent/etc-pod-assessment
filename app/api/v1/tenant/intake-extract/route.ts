/**
 * POST /api/v1/tenant/intake-extract
 *
 * Extracts plain text from a tenant-supplied source so the intake form
 * can populate its textarea from a file or a URL instead of forcing a
 * manual paste. Two shapes:
 *
 *   - multipart/form-data with a `file` field (.pdf, .docx, .txt)
 *   - application/json with { url: string }
 *
 * Returns { text, filename, source_label } on success. Text is run
 * through sanitiseUserText() so U+2028 / control chars are stripped
 * before the value lands in the form.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantMemberApi } from "@/lib/auth/tenant";
import { sanitiseUserText } from "@/lib/tenant/sanitise";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 50_000;
const URL_FETCH_TIMEOUT_MS = 10_000;

const urlSchema = z.object({
  url: z.string().url(),
});

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireTenantMemberApi();
  if (!auth.user) return auth.unauthorized;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    return handleFile(req);
  }
  if (contentType.includes("application/json")) {
    return handleUrl(req);
  }
  return NextResponse.json(
    { error: "unsupported_content_type" },
    { status: 415 },
  );
}

async function handleFile(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", limit_bytes: MAX_FILE_BYTES },
      { status: 413 },
    );
  }

  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  let text: string;
  try {
    if (name.endsWith(".pdf")) {
      text = await extractPdf(buffer);
    } else if (name.endsWith(".docx")) {
      text = await extractDocx(buffer);
    } else if (name.endsWith(".txt") || file.type.startsWith("text/")) {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json(
        { error: "unsupported_file_type" },
        { status: 400 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "extraction_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 422 },
    );
  }

  const cleaned = sanitiseUserText(text).trim();
  if (cleaned.length < 50) {
    return NextResponse.json(
      { error: "extracted_text_too_short" },
      { status: 422 },
    );
  }

  return NextResponse.json({
    text: cleaned.slice(0, MAX_OUTPUT_CHARS),
    filename: file.name,
    source_label: file.name,
  });
}

async function handleUrl(req: Request): Promise<NextResponse> {
  let parsed: { url: string };
  try {
    parsed = urlSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  // Block obvious SSRF targets — internal/private IP ranges and
  // localhost. We don't try to be exhaustive; the worst case is the
  // remote returns nothing useful and the tenant pastes instead.
  const u = new URL(parsed.url);
  if (
    u.protocol !== "https:" &&
    u.protocol !== "http:"
  ) {
    return NextResponse.json({ error: "unsupported_protocol" }, { status: 400 });
  }
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)/.test(u.hostname)) {
    return NextResponse.json({ error: "blocked_host" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(u.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; ETC-AssessmentBuilder/1.0; +https://energytalentco.com)",
        accept:
          "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    return NextResponse.json(
      {
        error: "fetch_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    return NextResponse.json(
      { error: "fetch_failed", status: res.status },
      { status: 502 },
    );
  }

  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "remote_too_large", limit_bytes: MAX_FILE_BYTES },
      { status: 413 },
    );
  }

  const remoteType = (res.headers.get("content-type") ?? "").toLowerCase();
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "remote_too_large", limit_bytes: MAX_FILE_BYTES },
      { status: 413 },
    );
  }
  const buffer = Buffer.from(ab);

  let text: string;
  try {
    if (remoteType.includes("application/pdf") || u.pathname.toLowerCase().endsWith(".pdf")) {
      text = await extractPdf(buffer);
    } else if (
      remoteType.includes("officedocument.wordprocessingml") ||
      u.pathname.toLowerCase().endsWith(".docx")
    ) {
      text = await extractDocx(buffer);
    } else if (remoteType.includes("text/html") || remoteType === "") {
      text = stripHtml(buffer.toString("utf-8"));
    } else if (remoteType.startsWith("text/")) {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json(
        { error: "unsupported_remote_type", remote_type: remoteType },
        { status: 415 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "extraction_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 422 },
    );
  }

  const cleaned = sanitiseUserText(text).trim();
  if (cleaned.length < 50) {
    return NextResponse.json(
      { error: "extracted_text_too_short" },
      { status: 422 },
    );
  }

  return NextResponse.json({
    text: cleaned.slice(0, MAX_OUTPUT_CHARS),
    filename: null,
    source_label: u.hostname + u.pathname,
  });
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const mod = (await import("pdf-parse")) as unknown as
    | { default: (data: Buffer) => Promise<{ text: string }> }
    | ((data: Buffer) => Promise<{ text: string }>);
  const fn = typeof mod === "function" ? mod : mod.default;
  const out = await fn(buffer);
  return out.text;
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const out = await mammoth.extractRawText({ buffer });
  return out.value;
}

function stripHtml(html: string): string {
  // Drop scripts and styles outright, then strip remaining tags. Good
  // enough for JD pages — tenants who need richer extraction can paste.
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/?(p|br|div|li|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}
