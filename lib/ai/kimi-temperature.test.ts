/**
 * Moonshot's newer models refuse any temperature but 1 with a 400. The
 * client must learn that on the first refusal, retry with 1, and keep
 * sending 1 to that model afterwards, so Kimi stays in the cross-check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scoreOpenEndedKimi } from "./kimi";

type Call = { model: string; temperature: number };

function moonshotMock(calls: Call[]) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model: string; temperature: number };
    calls.push({ model: body.model, temperature: body.temperature });
    if (body.temperature !== 1) {
      return new Response(
        JSON.stringify({ error: { message: "invalid temperature: only 1 is allowed for this model", type: "invalid_request_error" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                suggestedScore: 4,
                rationale: "Mentions the ratio and derating.",
                hits: ["DC:AC ratio"],
                misses: [],
                redFlagsTriggered: [],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

describe("kimi temperature handling", () => {
  const calls: Call[] = [];
  beforeEach(() => {
    calls.length = 0;
    process.env.KIMI_API_KEY = "test-key";
    process.env.KIMI_MODEL = "kimi-k2-thinking";
    vi.stubGlobal("fetch", moonshotMock(calls));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KIMI_MODEL;
  });

  it("retries with temperature 1 after the refusal and remembers it", async () => {
    const first = await scoreOpenEndedKimi({
      questionText: "Q",
      rubric: "R",
      candidateAnswer: "A",
      maxPoints: 5,
    });
    expect(first.suggestedScore).toBe(4);
    expect(calls.map((c) => c.temperature)).toEqual([0.2, 1]);

    await scoreOpenEndedKimi({ questionText: "Q2", rubric: "R", candidateAnswer: "A", maxPoints: 5 });
    // The second answer goes straight to temperature 1: no wasted refusal.
    expect(calls.map((c) => c.temperature)).toEqual([0.2, 1, 1]);
    expect(calls.every((c) => c.model === "kimi-k2-thinking")).toBe(true);
  });
});
