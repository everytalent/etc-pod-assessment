import { describe, expect, it } from "vitest";

import { assertNoLeakage, serialiseForTenant } from "./serialiser";

describe("tenant-output serialiser", () => {
  it("strips skillboard_id and provisional_framework_id fields", () => {
    const out = serialiseForTenant({
      decision: "hire",
      skillboard_id: "SB-123",
      provisional_framework_id: "PF-9",
      sourceSkillboardId: "SB-456",
      derived_from: ["SB-1", "SB-2"],
    }) as Record<string, unknown>;
    expect(out.skillboard_id).toBeUndefined();
    expect(out.provisional_framework_id).toBeUndefined();
    expect(out.sourceSkillboardId).toBeUndefined();
    expect(out.derived_from).toBeUndefined();
    expect(out.decision).toBe("hire");
  });

  it("rewrites Kimi/Moonshot to kemi.ai inside string values", () => {
    const out = serialiseForTenant({
      rationale: "Kimi gave this a 4 because Moonshot's analyser hesitated.",
    }) as { rationale: string };
    expect(out.rationale).not.toMatch(/Kimi|Moonshot/);
    expect(out.rationale).toContain("kemi.ai");
  });

  it("rewrites Claude/Opus/Anthropic to chioma.ai inside string values", () => {
    const out = serialiseForTenant({
      rationale: "Claude Opus disagreed (Anthropic's reasoning trace was thin).",
    }) as { rationale: string };
    expect(out.rationale).not.toMatch(/Claude|Opus|Anthropic/);
    expect(out.rationale).toContain("chioma.ai");
  });

  it("replaces em-dashes with hyphens in tenant strings", () => {
    const out = serialiseForTenant({
      heading: "Hire — Mid, Growing",
    }) as { heading: string };
    expect(out.heading).not.toContain("—");
    expect(out.heading).toContain(" - ");
  });

  it("redacts internal terms like 'skillboard' inside free-text strings", () => {
    const out = serialiseForTenant({
      note: "Matched against skillboard SB-12 (mini-skillboard fallback used).",
    }) as { note: string };
    expect(out.note).not.toMatch(/skillboard|mini-skillboard/i);
    expect(out.note).toContain("[redacted]");
  });

  it("walks nested arrays and objects", () => {
    const out = serialiseForTenant({
      candidates: [
        {
          name: "Funmi",
          skillboard_id: "SB-1",
          rationale: "Claude said good.",
        },
        {
          name: "Tunde",
          nested: { provisional_framework_id: "PF-2", note: "Kimi disagreed" },
        },
      ],
    }) as { candidates: Array<Record<string, unknown>> };
    expect(out.candidates[0].skillboard_id).toBeUndefined();
    expect((out.candidates[0].rationale as string)).toContain("chioma.ai");
    const nested = out.candidates[1].nested as Record<string, unknown>;
    expect(nested.provisional_framework_id).toBeUndefined();
    expect(nested.note as string).toContain("kemi.ai");
  });

  it("preserves the original input (no mutation)", () => {
    const input = { skillboard_id: "SB-1", rationale: "Claude said hi" };
    serialiseForTenant(input);
    expect(input.skillboard_id).toBe("SB-1");
    expect(input.rationale).toBe("Claude said hi");
  });

  it("assertNoLeakage passes on a clean payload", () => {
    expect(() =>
      assertNoLeakage({
        decision: "hire",
        stage: "mid.growing",
        rationale: "kemi.ai and chioma.ai agreed strongly.",
      }),
    ).not.toThrow();
  });

  it("assertNoLeakage throws when blocked key survives", () => {
    expect(() => assertNoLeakage({ skillboard_id: "x" })).toThrow(/leakage/);
  });

  it("assertNoLeakage throws when raw model name survives", () => {
    expect(() => assertNoLeakage({ note: "Kimi scored 4" })).toThrow(/leakage/);
  });

  it("assertNoLeakage throws when an em-dash survives", () => {
    expect(() => assertNoLeakage({ note: "Hire — Mid, Pro" })).toThrow(/leakage/);
  });
});
