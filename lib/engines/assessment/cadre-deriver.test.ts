import { describe, expect, it } from "vitest";

import { cellsForCadre, deriveCadre } from "./cadre-deriver";

describe("deriveCadre — boundary cells", () => {
  it("Junior + Below → EL", () => {
    expect(deriveCadre("junior", "below")).toBe("el");
  });

  it("Junior + Growing → EL", () => {
    expect(deriveCadre("junior", "g")).toBe("el");
  });

  it("Junior + Pro → INT (boundary)", () => {
    expect(deriveCadre("junior", "p")).toBe("int");
  });

  it("Junior + TP → INT", () => {
    expect(deriveCadre("junior", "tp")).toBe("int");
  });

  it("Mid + Below → INT", () => {
    expect(deriveCadre("mid", "below")).toBe("int");
  });

  it("Mid + NH → EXPD (boundary)", () => {
    expect(deriveCadre("mid", "nh")).toBe("expd");
  });

  it("Mid + Pro → EXPD", () => {
    expect(deriveCadre("mid", "p")).toBe("expd");
  });

  it("Mid + TP → ADV (boundary)", () => {
    expect(deriveCadre("mid", "tp")).toBe("adv");
  });

  it("Senior + Below → ADV", () => {
    expect(deriveCadre("senior", "below")).toBe("adv");
  });

  it("Senior + NH → ADV", () => {
    expect(deriveCadre("senior", "nh")).toBe("adv");
  });

  it("Senior + Growing → EXPT (boundary)", () => {
    expect(deriveCadre("senior", "g")).toBe("expt");
  });

  it("Senior + Pro → EXPT", () => {
    expect(deriveCadre("senior", "p")).toBe("expt");
  });

  it("Senior + TP → EXPT (peak)", () => {
    expect(deriveCadre("senior", "tp")).toBe("expt");
  });
});

describe("deriveCadre — band-dominant property", () => {
  it("Senior at Below outranks Junior at TP (band weighted)", () => {
    // We don't expose the ordinal directly, but we can assert that
    // the cadre for (senior, below) is at least as high as (junior, tp).
    // ADV (senior, below) should be > INT (junior, tp).
    const a = deriveCadre("senior", "below");
    const b = deriveCadre("junior", "tp");
    expect(a).toBe("adv");
    expect(b).toBe("int");
  });
});

describe("cellsForCadre — inverse map", () => {
  it("every cadre has at least one cell", () => {
    for (const cadre of ["el", "int", "expd", "adv", "expt"] as const) {
      expect(cellsForCadre(cadre).length).toBeGreaterThan(0);
    }
  });

  it("all 15 cells are accounted for across the 5 cadres", () => {
    const total = (["el", "int", "expd", "adv", "expt"] as const).reduce(
      (sum, c) => sum + cellsForCadre(c).length,
      0,
    );
    expect(total).toBe(15);
  });

  it("EL contains exactly Junior {below, nh, g}", () => {
    const cells = cellsForCadre("el");
    expect(cells).toHaveLength(3);
    expect(cells.every((c) => c.band === "junior")).toBe(true);
    expect(cells.map((c) => c.level).sort()).toEqual(["below", "g", "nh"]);
  });

  it("EXPT contains exactly Senior {g, p, tp}", () => {
    const cells = cellsForCadre("expt");
    expect(cells).toHaveLength(3);
    expect(cells.every((c) => c.band === "senior")).toBe(true);
    expect(cells.map((c) => c.level).sort()).toEqual(["g", "p", "tp"]);
  });
});
