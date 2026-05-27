import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * Hotspot — image with regions to click. "Click the shading risk on
 * this PV array." Region check is server-side via point-in-bbox.
 *
 * config:
 *   image_path — Supabase Storage path
 *   regions[]  — id + bbox (x,y,w,h in 0-1 normalised coords) + is_correct
 *
 * answer:
 *   click_x, click_y (0-1)
 *   region_id (resolved by client OR by server in scoring)
 *   time_to_answer_ms (soft signal)
 */
export const hotspotTypeDef: QuestionTypeDef = {
  type: "hotspot",
  label: "Image hotspot",
  configSchema: z.object({
    image_path: z.string().min(1).max(200),
    regions: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          label: z.string().max(120).optional(),
          bbox: z.object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            w: z.number().min(0).max(1),
            h: z.number().min(0).max(1),
          }),
          is_correct: z.boolean(),
        }),
      )
      .min(1)
      .max(20),
  }),
  answerSchema: z.object({
    click_x: z.number().min(0).max(1),
    click_y: z.number().min(0).max(1),
    time_to_answer_ms: z.number().int().min(0).optional(),
  }),
  autoScore: ({ config, answer, points }) => {
    const c = config as {
      regions: Array<{
        id: string;
        bbox: { x: number; y: number; w: number; h: number };
        is_correct: boolean;
      }>;
    };
    const a = answer as { click_x: number; click_y: number };

    const hit = c.regions.find(
      (r) =>
        a.click_x >= r.bbox.x &&
        a.click_x <= r.bbox.x + r.bbox.w &&
        a.click_y >= r.bbox.y &&
        a.click_y <= r.bbox.y + r.bbox.h,
    );

    if (!hit) {
      return {
        score: 0,
        max: points,
        signals: ["missed_all_regions"],
        reason: `Click (${a.click_x.toFixed(2)}, ${a.click_y.toFixed(2)}) didn't land in any defined region.`,
      };
    }
    if (hit.is_correct) {
      return {
        score: points,
        max: points,
        signals: ["correct_region", `region:${hit.id}`],
        reason: `Clicked correct region ${hit.id}.`,
      };
    }
    return {
      score: 0,
      max: points,
      signals: ["wrong_region", `region:${hit.id}`],
      reason: `Clicked region ${hit.id}, which was not the correct one.`,
    };
  },
};
