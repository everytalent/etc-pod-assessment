import { describe, expect, it } from "vitest";

import { deduceBand } from "./band-deducer";
import type { OnboardingProfile } from "./types";

function profile(overrides: Partial<OnboardingProfile> = {}): OnboardingProfile {
  return {
    candidate_id: "ETC-00001",
    full_name: "Test Candidate",
    email: "test@example.com",
    phone: null,
    country: "Nigeria",
    city: "Lagos",
    state: "Lagos",
    specialisation: "Solar Installation",
    has_solar_experience: true,
    years_bucket: "3_to_5",
    work_types: [],
    skills: [],
    certifications: [],
    portfolio: [],
    ...overrides,
  };
}

describe("deduceBand — years-only deductions (v1.1 buckets)", () => {
  it("less than 3 years → junior", () => {
    const r = deduceBand(profile({ years_bucket: "less_than_3" }));
    expect(r.band).toBe("junior");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("3-5 years with no role signals → mid (intermediate baseline)", () => {
    const r = deduceBand(profile({ years_bucket: "3_to_5" }));
    expect(r.band).toBe("mid");
  });

  it("5-10 years → senior baseline", () => {
    const r = deduceBand(profile({ years_bucket: "5_to_10" }));
    expect(r.band).toBe("senior");
  });

  it("10+ years → senior with strong confidence", () => {
    const r = deduceBand(profile({ years_bucket: "10_plus" }));
    expect(r.band).toBe("senior");
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it("no years bucket → junior with low confidence", () => {
    const r = deduceBand(profile({ years_bucket: null }));
    expect(r.band).toBe("junior");
    expect(r.confidence).toBeLessThan(0.6);
  });
});

describe("deduceBand — role signals override years", () => {
  it("2-5 years + 'Project Lead' role → mid (one promotion)", () => {
    const r = deduceBand(
      profile({
        years_bucket: "3_to_5",
        portfolio: [
          {
            name: "Lagos rooftop array",
            role: "Project Lead",
            scope: "20 kWp residential",
            period: "2024",
            activities: ["Team coordination"],
          },
        ],
      }),
    );
    expect(r.band).toBe("mid");
  });

  it("2-5 years + multiple leadership signals → senior", () => {
    const r = deduceBand(
      profile({
        years_bucket: "3_to_5",
        work_types: ["Head of operations"],
        portfolio: [
          {
            name: "Anambra mini-grid",
            role: "Site Manager",
            scope: "200 kWp",
            period: "2023-2024",
            activities: ["Contractor management", "Stakeholder reporting"],
          },
        ],
      }),
    );
    expect(r.band).toBe("senior");
  });

  it("5-10 years + 'Intern' wording → floored to junior", () => {
    const r = deduceBand(
      profile({
        years_bucket: "5_to_10",
        portfolio: [
          {
            name: "Field support",
            role: "Trainee Technician",
            scope: null,
            period: "2020-2024",
            activities: ["Assistant to lead installer"],
          },
        ],
      }),
    );
    expect(r.band).toBe("junior");
    expect(r.reasoning).toContain("floored to Junior");
  });

  it("conflicting senior + junior wording lowers confidence", () => {
    const r = deduceBand(
      profile({
        years_bucket: "3_to_5",
        portfolio: [
          {
            name: "Mixed work",
            role: "Lead Trainee Engineer", // both signals
            scope: null,
            period: null,
            activities: [],
          },
        ],
      }),
    );
    expect(r.confidence).toBeLessThan(0.55);
  });
});

describe("deduceBand — non-solar safety belt", () => {
  it("non-solar candidate with 5-10 years is capped at mid", () => {
    const r = deduceBand(
      profile({
        has_solar_experience: false,
        years_bucket: "5_to_10",
        non_solar_industry: "Construction & Engineering",
      }),
    );
    expect(r.band).toBe("mid");
    expect(r.reasoning).toContain("capped at Mid");
  });

  it("non-solar with 2-5 years stays junior (no leadership wording)", () => {
    const r = deduceBand(
      profile({
        has_solar_experience: false,
        years_bucket: "3_to_5",
        non_solar_industry: "Oil & Gas",
      }),
    );
    expect(r.band).toBe("junior");
  });
});

describe("deduceBand — confidence sanity", () => {
  it("empty portfolio + empty work_types drops confidence", () => {
    const r = deduceBand(
      profile({
        years_bucket: "3_to_5",
        portfolio: [],
        work_types: [],
      }),
    );
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("rich profile at clear extreme returns high confidence", () => {
    const r = deduceBand(
      profile({
        years_bucket: "10_plus",
        work_types: ["Residential Solar", "Commercial Solar"],
        portfolio: [
          {
            name: "EPC project A",
            role: "Project Director",
            scope: "1 MWp",
            period: "2019-2024",
            activities: [
              "Stakeholder reporting",
              "Contractor management",
              "Team leadership",
            ],
          },
        ],
      }),
    );
    expect(r.band).toBe("senior");
    expect(r.confidence).toBeGreaterThan(0.7);
  });
});
