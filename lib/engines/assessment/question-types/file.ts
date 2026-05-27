import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * File upload (BOQ, design file, photo). Hybrid scoring: format check
 * auto, content scored by AI if the rubric demands it.
 */
export const fileTypeDef: QuestionTypeDef = {
  type: "file",
  label: "File upload",
  configSchema: z.object({
    /** Allowed MIME prefixes (e.g. ["application/pdf", "image/"]) */
    allowed_mime_prefixes: z.array(z.string().min(1).max(60)).max(10),
    /** Max file size in bytes (0 = unlimited up to platform max). */
    max_size_bytes: z.number().int().min(0).max(50 * 1024 * 1024),
  }),
  answerSchema: z.object({
    file_path: z.string().min(1).max(200),
    mime: z.string().min(1).max(60),
    size_bytes: z.number().int().min(0),
  }),
  autoScore: ({ config, answer, points }) => {
    const c = config as { allowed_mime_prefixes: string[]; max_size_bytes: number };
    const a = answer as { mime: string; size_bytes: number };
    const mimeOk = c.allowed_mime_prefixes.some((p) => a.mime.startsWith(p));
    if (!mimeOk) {
      return {
        score: 0,
        max: points,
        signals: ["mime_rejected"],
        reason: `Mime ${a.mime} not in allowlist.`,
      };
    }
    if (c.max_size_bytes > 0 && a.size_bytes > c.max_size_bytes) {
      return {
        score: 0,
        max: points,
        signals: ["oversized"],
        reason: `File ${a.size_bytes} bytes exceeds limit ${c.max_size_bytes}.`,
      };
    }
    // Format passes — content scoring (if any) is AI's job.
    return null;
  },
};
