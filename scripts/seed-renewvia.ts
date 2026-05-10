/**
 * Seed the Renewvia assessment (17 questions, mix of MCQ and open-ended
 * with rubrics). Idempotent: re-running deletes the prior Renewvia
 * assessment by slug and reinserts. Other assessments untouched.
 *
 * Run: pnpm dlx dotenv -e .env.local -- pnpm dlx tsx scripts/seed-renewvia.ts
 */

import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../lib/db/schema";

const SLUG = "renewvia";

type McqOption = { id: string; label: string };

type SeedQuestion =
  | {
      type: "mcq";
      questionText: string;
      section: string | null;
      options: McqOption[];
      correctAnswer: string[];
      points: number;
      negativePoints: number;
    }
  | {
      type: "open";
      questionText: string;
      section: string | null;
      points: number;
      negativePoints: number;
      scoringRubric: string;
    };

const SECTION_A = "A · Scenario MCQs";
const SECTION_B = "B · Technical written";
const SECTION_C = "C · Troubleshooting";

const QUESTIONS: SeedQuestion[] = [
  // ---------- Section A: scenario MCQs ----------
  {
    type: "mcq",
    section: SECTION_A,
    questionText:
      "Engr Bashiru is handling a 200 kWp solar project in Amichi, Anambra. During installation he needs to route PV homerun cables from the strings to the inverter, while avoiding thermal derating (voltage drop due to heat) and loss of current-carrying capacity. Which routing option should you recommend?",
    options: [
      { id: "a", label: "Run the cables on bare roof in free air under direct sunlight" },
      { id: "b", label: "Run the cables on a shaded free-air path with continuous ventilation" },
      { id: "c", label: "Run the cables underground through conduit with grouped conductors" },
      { id: "d", label: "Run the cables beneath modules on the roof where intermittent shading occurs" },
    ],
    correctAnswer: ["b"],
    points: 2,
    negativePoints: 1,
  },
  {
    type: "mcq",
    section: SECTION_A,
    questionText:
      "Engr Kemi Adeyemi is commissioning a 75 kWp system in Lekki, Lagos. While testing, the monitoring platform shows negative power on one phase. What should you advise her to troubleshoot first?",
    options: [
      { id: "a", label: "Incorrect CT ratio programmed into the meter" },
      { id: "b", label: "Phase sequence mismatch between voltage reference and CT placement" },
      { id: "c", label: "Reversed CT polarity or incorrect CT orientation on that phase" },
      { id: "d", label: "Neutral instability causing false reverse power readings" },
    ],
    correctAnswer: ["c"],
    points: 2,
    negativePoints: 1,
  },
  {
    type: "mcq",
    section: SECTION_A,
    questionText:
      "Engr Musa Bello is installing a 120 kWp hybrid system in Kaduna and needs to connect remote start/stop signals from the inverter/ATS to the generator controller. Which cable should you recommend for reliable signal transmission without interference?",
    options: [
      { id: "a", label: "2-core unscreened flexible control cable" },
      { id: "b", label: "2-core screened twisted-pair control cable" },
      { id: "c", label: "Single-core armored instrumentation cable" },
      { id: "d", label: "Standard PV1-F solar cable" },
    ],
    correctAnswer: ["b"],
    points: 2,
    negativePoints: 1,
  },
  {
    type: "mcq",
    section: SECTION_A,
    questionText:
      "Engr Chinedu Okafor is working on a 50 kWp system in Onitsha and is about to complete the AC earthing. Where should you instruct him to bond the AC earth?",
    options: [
      { id: "a", label: "Bond only at the inverter protective earth terminal" },
      { id: "b", label: "Bond at the nearest sub-distribution board earth bar" },
      { id: "c", label: "Bond at the main earth terminal / main distribution earth bar" },
      { id: "d", label: "Bond at the generator earth point downstream of ATS" },
    ],
    correctAnswer: ["c"],
    points: 2,
    negativePoints: 1,
  },
  {
    type: "mcq",
    section: SECTION_A,
    questionText:
      "Engr Fatima Sani is commissioning a 30 kWp rooftop system in Abuja. While crimping MC4 connectors she measures a string that should be around 400 V Voc but reads approximately 200 V. What is the most likely cause?",
    options: [
      { id: "a", label: "Insulation leakage is depressing the open-circuit voltage" },
      { id: "b", label: "Approximately half the modules are electrically out of circuit" },
      { id: "c", label: "Temperature rise has reduced string Voc significantly" },
      { id: "d", label: "Several bypass diodes are conducting under open-circuit conditions" },
    ],
    correctAnswer: ["b"],
    points: 2,
    negativePoints: 1,
  },
  {
    type: "mcq",
    section: SECTION_A,
    questionText:
      "Engr Tunde Balogun is commissioning a 50 kW inverter system in Ibadan when the inverter reports an F24 fault (DC Insulation Impedance Failure). What does the fault most specifically represent?",
    options: [
      { id: "a", label: "DC leakage current exceeding inverter threshold" },
      { id: "b", label: "Abnormal insulation impedance between DC conductors and earth" },
      { id: "c", label: "Protective earth continuity fault on inverter chassis" },
      { id: "d", label: "PV string voltage imbalance outside MPPT range" },
    ],
    correctAnswer: ["b"],
    points: 2,
    negativePoints: 1,
  },

  // ---------- Section B: technical written ----------
  {
    type: "open",
    section: SECTION_B,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Ibrahim Lawal is about to mobilize his team for a 100 kWp rooftop installation in Ilorin. Before work begins, he asks you to outline the critical safety measures and HSE standards he must enforce on site. Describe the safety measures and HSE standards you would recommend.",
    scoringRubric: `Required keywords (must cover most):
- PPE
- Fall arrest / harness
- Lifeline / anchor point
- Electrical isolation
- Emergency rescue plan

Preferred keywords (bonus):
- Toolbox talk
- Barricading
- Arc flash

Red-flag keywords (cap score low):
- "Work carefully" only
- "Use ladder" as the sole control
- No mention of fall protection
- No isolation procedure

Award full credit for clear coverage of all required items. Reduce 1 point per missing required item. Red flags should pull the score sharply (often to 1 or 0) — they indicate dangerous reasoning.`,
  },
  {
    type: "open",
    section: SECTION_B,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Ngozi Eze is handling installations across different roof types (thin sheets, aluminium, tiles, asbestos) on a large estate project in Enugu. She wants to avoid roof damage and prevent leaks regardless of roof type or rafter material. Explain how you would guide her on mounting methodology for each case.",
    scoringRubric: `Required (cover most):
- Rafter locating
- Waterproofing / flashing (aluminium roofing)
- Standing seam clamp
- Tile hook / non-penetrative mounting (tile roofing)
- Asbestos no-drill or special handling (asbestos roofing)
- Structural assessment

Preferred:
- Torque control
- Pilot holes
- Rail spanning
- Purlin attachment

Red flags:
- Drill directly through asbestos
- Screw only into roofing sheet
- Silicone as sole waterproofing`,
  },
  {
    type: "open",
    section: SECTION_B,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Sadiq Abubakar is installing an energy meter for a 60 kWp system in Kano and needs to connect it to a monitoring logger. Which communication cable should you recommend, and why?",
    scoringRubric: `Required:
- RS485
- Twisted pair
- Shielded / screened
- Modbus

Preferred:
- 120 ohm termination
- Cat5e
- Belden

Red flags:
- PV cable
- Battery cable
- "Any two-core cable"`,
  },
  {
    type: "open",
    section: SECTION_B,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Bassey Effiong has completed installation of a 90 kWp system in Uyo and is about to verify the AC earthing integrity before commissioning. Explain how he should carry out this verification.",
    scoringRubric: `Required (must hit 3):
- Earth resistance tester
- Earth continuity test
- Fall-of-potential / 3-point test
- Loop impedance
- Ohms resistance limit
- Less than 5 ohms (or project spec)

Preferred:
- Clamp earth tester
- IEC / NEC reference

Red flags:
- "Use multimeter only"
- No resistance value stated`,
  },
  {
    type: "open",
    section: SECTION_B,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Yakubu Danjuma is finalizing the DC side of a 150 kWp system in Jos and wants to ensure proper earthing, bonding, and surge protection. Explain how you would advise him to earth the DC side correctly.",
    scoringRubric: `Required (must hit 4 of 5):
- Equipment bonding
- Surge protection / SPD
- Frame grounding
- Functional earth
- No direct grounded PV conductor (transformerless systems)

Red flags (any → automatic 0–1):
- Bond positive conductor directly to earth
- Bond negative conductor directly to earth`,
  },
  {
    type: "open",
    section: SECTION_B,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Aisha Mohammed is running a PV homerun cable on a ground-mounted system in Maiduguri. After installing 77 meters, the cable roll finishes about 9 meters before the fuse box. Explain how she should complete the installation in a compliant way.",
    scoringRubric: `Required (must hit 3 of 4):
- No mid-span improvised splice
- Junction box / combiner termination
- MC4-compatible connector
- Replace run if needed
- Maintain IP rating

Red flags (any → automatic 0–1):
- Tape joint
- Twist and tape
- Household connector
- "Just join the cable"`,
  },
  {
    type: "open",
    section: SECTION_B,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Peter Nwankwo is working on a large industrial solar system in Aba with long homerun cable distances. He wants to avoid polarity errors and ensure traceability from strings to inverter. Describe the system you would recommend.",
    scoringRubric: `Required (must hit 4):
- Cable labeling
- Ferrules / markers
- Continuity test
- Polarity verification
- String schedule / as-built

Preferred:
- Tone tracer
- Megger cross-check

Red flags:
- Color only identification
- "Follow the cable physically"`,
  },
  {
    type: "open",
    section: SECTION_B,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Zainab Sule is installing a 50 kW Deye hybrid inverter system in Sokoto with 23 units of 51.2 V high-voltage batteries. She needs to configure them within the inverter's 160–800 V DC input range. Explain how you would guide her to connect the batteries safely and correctly.",
    scoringRubric: `Required (must hit 4 of 5):
- Series configuration on each battery terminal (two terminals; each must stay below 800 V)
- Battery management system / BMS
- Voltage window (160–800 V)
- Manufacturer-approved stack configuration
- DIP / addressing / communications

Red flags (any → automatic 0–1):
- Parallel all batteries directly
- Connect 51.2 V bank straight to inverter battery input
- Ignore BMS communications`,
  },

  // ---------- Section C: troubleshooting ----------
  {
    type: "open",
    section: SECTION_C,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Emeka Obi is commissioning a 40 kWp system in Owerri and notices one string is reading about half of its expected Voc at the inverter terminals. Describe the structured troubleshooting steps you would ask him to follow.",
    scoringRubric: `Required (must hit 4 of 5):
- Measure module-by-module Voc
- Check open circuit / broken conductor
- Check MC4 crimps
- Check disconnected modules
- String continuity test

Red flags:
- Immediately blame insulation fault
- Replace inverter first`,
  },
  {
    type: "open",
    section: SECTION_C,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr Halima Garba is commissioning a battery bank in Zaria when she notices a section of a battery cable becoming extremely hot at a single point along the conductor (not at the terminals). Explain how you would diagnose and resolve this issue.",
    scoringRubric: `Required (must hit 4 of 5):
- High resistance point
- Damaged conductor strands
- Internal cable defect
- Thermal imaging / inspect hotspot
- Replace cable section

Red flags:
- Tighten terminals only (without checking cable body)
- Increase cable size without fault finding`,
  },
  {
    type: "open",
    section: SECTION_C,
    points: 5,
    negativePoints: 0,
    questionText:
      "Engr David Ojo is troubleshooting a 50 kW system in Akure where a Deye inverter reports F24 — DC Insulation Impedance Failure on one string. Describe your full troubleshooting procedure from diagnosis to resolution.",
    scoringRubric: `Required (must hit 6 of 7):
- Megger / insulation resistance test
- Isolate strings one by one
- Check positive to earth
- Check negative to earth
- Moisture ingress
- MC4 inspection
- Cable damage
- Combiner inspection

Preferred:
- Compare insulation resistance per string
- Dawn condensation nuisance fault

Red flags:
- Replace inverter immediately
- Reset alarm only
- Ignore because voltage is normal`,
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false });
  const db = drizzle(sql, { schema });

  // Clean slate for this slug only.
  const [existing] = await db
    .select({ id: schema.assessments.id })
    .from(schema.assessments)
    .where(eq(schema.assessments.slug, SLUG))
    .limit(1);
  if (existing) {
    console.log(`Removing existing Renewvia assessment ${existing.id}`);
    await db.delete(schema.assessments).where(eq(schema.assessments.id, existing.id));
  }

  const [assessment] = await db
    .insert(schema.assessments)
    .values({
      title: "Renewvia – Solar Tech Competency Assessment",
      slug: SLUG,
      roleType: "tech",
      status: "draft",
      visibility: "listed",
      passThreshold: 70,
      introText:
        "Welcome. This assessment combines scenario-based MCQs and short written responses on PV cabling, earthing, batteries, and troubleshooting. Take your time — most candidates finish in 20–35 minutes.",
      outroText:
        "Thank you. Your responses have been submitted. The Renewvia review team will be in touch shortly.",
    })
    .returning();
  if (!assessment) throw new Error("Failed to insert assessment");
  console.log(`Created assessment ${assessment.id}`);

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i]!;
    // Default per-question time limits: tight enough to keep candidates
    // honest, generous enough to read the scenario and form a real answer.
    // MCQs: 90s — read scenario + pick. Open-ended: 240s — line up below
    // the 5-min voice cap so the recorder never auto-cuts on the user.
    const timeLimitSeconds = q.type === "mcq" ? 90 : 240;
    const common = {
      assessmentId: assessment.id,
      orderIndex: i,
      questionText: q.questionText,
      section: q.section,
      points: q.points,
      negativePoints: q.negativePoints,
      timerEnabled: true,
      timeLimitSeconds,
      timeoutAction: "auto_submit" as const,
      required: true,
    };
    if (q.type === "mcq") {
      await db.insert(schema.questions).values({
        ...common,
        type: "mcq",
        options: q.options,
        correctAnswer: q.correctAnswer,
      });
    } else {
      await db.insert(schema.questions).values({
        ...common,
        type: "open",
        options: [],
        correctAnswer: [],
        scoringRubric: q.scoringRubric,
      });
    }
  }
  console.log(`Inserted ${QUESTIONS.length} questions.`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
