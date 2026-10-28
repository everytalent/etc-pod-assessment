/**
 * Replace the Sales Associate (apprentice) assessment's questions with an
 * aptitude set: reading comprehension, communication and sales arithmetic.
 *
 * The bank was generated from the JD and the calibrator anchored it to a solar
 * skillboard, so applicants were asked for industry expertise an apprentice
 * role does not require. This keeps the same link (same assessment row, same
 * slug) and changes what sits behind it:
 *
 *   1. A tenant-owned provisional skillboard with three skills and six tasks.
 *      Never activated, so it cannot feed ETC's own validation flow. Its only
 *      job is to give each question a task so the CAT picker's per-task cap
 *      spreads a run across all three areas.
 *   2. The current scored questions move to an archived copy of the
 *      assessment rather than being deleted. Answers cascade on question
 *      delete, and anyone who already sat it keeps their record.
 *   3. The aptitude questions are inserted and the assessment switches to
 *      mode 'fixed', which serves this assessment's own questions instead of
 *      whatever the solar skillboard holds.
 *
 * Practice ("sample") rows are left alone; the engine excludes them from the
 * scored pool.
 *
 * Usage (prints the plan, writes nothing):
 *   pnpm dotenv -e .env.local -- tsx scripts/fix-sales-apprentice-aptitude.ts
 * Apply:
 *   pnpm dotenv -e .env.local -- tsx scripts/fix-sales-apprentice-aptitude.ts --apply
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  assessments,
  questions,
  responses,
  skillboards,
  skills,
  tasks,
  tenantAssessmentBank,
  type QuestionOption,
} from "@/lib/db/schema";

const BANK_ID = "38b20b21-56e8-4dd5-bbfb-c925abfd3f2c";
const APPLY = process.argv.includes("--apply");

const TITLE = "Sales Associate (Apprentice) aptitude assessment";
const INTRO =
  "This assessment checks reading comprehension, written communication and everyday sales arithmetic. No product or industry knowledge is needed. Read each question carefully and answer in your own words where asked.";

type Area = "read_facts" | "read_infer" | "write" | "respond" | "price" | "percent";

const STRUCTURE: { skill: string; tasks: { key: Area; name: string }[] }[] = [
  {
    skill: "Reading comprehension",
    tasks: [
      { key: "read_facts", name: "Pick out facts, conditions and instructions from written information" },
      { key: "read_infer", name: "Infer meaning and draw sound conclusions from text" },
    ],
  },
  {
    skill: "Communication",
    tasks: [
      { key: "write", name: "Write clear, correct business messages" },
      { key: "respond", name: "Respond to customers and colleagues with clarity and care" },
    ],
  },
  {
    skill: "Numeracy and sales arithmetic",
    tasks: [
      { key: "price", name: "Calculate prices, discounts, deposits and payment plans" },
      { key: "percent", name: "Work with percentages, targets, averages and commission" },
    ],
  },
];

type Mcq = {
  area: Area;
  difficulty: number;
  text: string;
  options: [string, string, string, string];
  correct: "a" | "b" | "c" | "d";
};
type Open = { area: Area; difficulty: number; text: string; rubric: string };

const MCQS: Mcq[] = [
  // Reading comprehension
  {
    area: "read_facts",
    difficulty: 2,
    text: "Read this notice:\n\n\"Site visits are only done on working days (Monday to Friday). Every site visit must be booked at least two working days ahead.\"\n\nA customer calls on Thursday afternoon and wants a site visit as early as possible. What is the earliest day it can take place?",
    options: [
      "Saturday, the first day after Friday",
      "Friday, the next working day after the call",
      "Monday, two working days after Thursday",
      "Tuesday, two working days after Friday",
    ],
    correct: "c",
  },
  {
    area: "read_facts",
    difficulty: 3,
    text: "Read this extract from a price sheet:\n\n\"Customers pay 60% when they sign the order and the remaining 40% on delivery. Delivery happens within 10 working days of the first payment. Orders above ₦5 million also get a free maintenance visit three months after delivery.\"\n\nWhich statement is supported by the extract?",
    options: [
      "A customer who orders ₦4 million of goods gets a free maintenance visit",
      "Delivery happens within 10 working days of the customer paying 60%",
      "Customers pay 40% when they sign and the other 60% on delivery",
      "Every customer receives a maintenance visit three months after delivery",
    ],
    correct: "b",
  },
  {
    area: "read_infer",
    difficulty: 4,
    text: "A client sends this email:\n\n\"Thank you for the quote. The price works for us, but our finance team only approves purchases at the start of each quarter, and the next quarter begins in January. Please hold the quote until then.\"\n\nWhat is the main reason the client has not placed the order yet?",
    options: [
      "The client feels the quoted price is too high for this year's budget",
      "The client wants to compare the quote with other suppliers' prices first",
      "The client is waiting for us to confirm a delivery date for the order",
      "The client's finance team only approves purchases at the start of a quarter",
    ],
    correct: "d",
  },
  {
    area: "read_facts",
    difficulty: 5,
    text: "Your team's rule for client visits is:\n\n\"Log every client visit in the CRM on the same day. If the client asked for a quote, tag the visit 'Quote requested' and send the quote within 48 hours. If the client said no, tag the visit 'Closed – lost' and write the reason in one sentence.\"\n\nOn Tuesday you visit a client who says they are not interested because they have already signed with another supplier. What should you do?",
    options: [
      "Log the visit on Tuesday, tag it 'Closed – lost' and note that they signed elsewhere",
      "Log the visit on Tuesday, tag it 'Quote requested' and follow up within 48 hours",
      "Wait until Friday, then log all of the week's visits together with their outcomes",
      "Tag the visit 'Closed – lost' on Wednesday and leave the reason field blank",
    ],
    correct: "a",
  },
  {
    area: "read_infer",
    difficulty: 6,
    text: "Read this field report:\n\n\"In the past month, five of the eight small businesses we visited in Ikeja said they liked the product but could not pay the full price at once. Two said they would buy if a payment plan were available. One said the product was not useful to them.\"\n\nWhich conclusion is best supported by the report?",
    options: [
      "Most of the businesses visited did not see any value in the product",
      "Price was the only reason any of the businesses gave for not buying",
      "Offering a payment plan could help convert more of these businesses",
      "Businesses in Ikeja prefer to buy from suppliers they already know",
    ],
    correct: "c",
  },
  {
    area: "read_facts",
    difficulty: 7,
    text: "Read the promotion terms:\n\n\"The promotion runs from 1 to 15 November. Customers who pay in full during the promotion get 5% off. Customers who pay a deposit during the promotion but complete payment after 15 November get 2% off, applied to the final payment only.\"\n\nA customer pays a deposit on 10 November and the balance on 20 November. What discount do they get?",
    options: [
      "2% off the final payment only, because the balance was paid after 15 November",
      "5% off the full price, because the deposit was paid during the promotion",
      "2% off the full price, because part of the payment was made in the promotion",
      "No discount, because the full payment was not completed by 15 November",
    ],
    correct: "a",
  },
  {
    area: "read_infer",
    difficulty: 3,
    text: "\"The client was reluctant to sign because the warranty terms were vague.\"\n\nWhat does \"vague\" mean in this sentence?",
    options: [
      "Not clear or specific enough",
      "More costly than the client expected",
      "Too long and detailed to read easily",
      "Changed at the very last minute",
    ],
    correct: "a",
  },
  {
    area: "read_infer",
    difficulty: 8,
    text: "Read this extract from the apprentice handbook:\n\n\"Apprentices close deals under ₦10 million on their own. Deals of ₦10 million or more are handled together with a senior sales manager, and on those deals the apprentice earns 1% commission instead of the usual 3%.\"\n\nWhich statement is NOT supported by the extract?",
    options: [
      "An apprentice can close a ₦9.5 million deal without a senior manager",
      "Senior sales managers earn 2% commission on deals of ₦10 million or more",
      "On a ₦12 million deal, the apprentice works alongside a senior manager",
      "An apprentice earns a lower rate on a ₦10 million deal than on a ₦9 million one",
    ],
    correct: "b",
  },

  // Numeracy and sales arithmetic
  {
    area: "price",
    difficulty: 2,
    text: "A customer buys 3 units at ₦45,000 each. What is the total?",
    options: ["₦125,000", "₦135,000", "₦145,000", "₦115,000"],
    correct: "b",
  },
  {
    area: "price",
    difficulty: 3,
    text: "An item costs ₦240,000. The customer is given a 10% discount. What do they pay?",
    options: ["₦216,000", "₦214,000", "₦224,000", "₦230,000"],
    correct: "a",
  },
  {
    area: "percent",
    difficulty: 4,
    text: "You earn 3% commission on a sale of ₦8,500,000. How much commission do you earn?",
    options: ["₦25,500", "₦285,000", "₦2,550,000", "₦255,000"],
    correct: "d",
  },
  {
    area: "percent",
    difficulty: 4,
    text: "Your monthly target is ₦6,000,000. By day 20 you have sold ₦3,600,000. What percentage of your target have you reached?",
    options: ["50%", "60%", "65%", "40%"],
    correct: "b",
  },
  {
    area: "price",
    difficulty: 5,
    text: "An order is worth ₦4,750,000. The customer pays a 60% deposit now and the rest on delivery. How much is paid on delivery?",
    options: ["₦1,900,000", "₦2,850,000", "₦2,100,000", "₦1,750,000"],
    correct: "a",
  },
  {
    area: "percent",
    difficulty: 5,
    text: "Your sales over four weeks were ₦1,200,000, ₦800,000, ₦1,500,000 and ₦900,000. What was your average sales per week?",
    options: ["₦1,000,000", "₦1,250,000", "₦1,100,000", "₦1,200,000"],
    correct: "c",
  },
  {
    area: "price",
    difficulty: 6,
    text: "A product costs ₦1,800,000. The customer pays a 25% deposit and the rest in 6 equal monthly payments. How much is each monthly payment?",
    options: ["₦300,000", "₦250,000", "₦275,000", "₦225,000"],
    correct: "d",
  },
  {
    area: "price",
    difficulty: 6,
    text: "Supplier A charges ₦920,000 including delivery. Supplier B charges ₦850,000 plus ₦60,000 for delivery. Which is cheaper for the customer, and by how much?",
    options: [
      "Supplier A, by ₦10,000",
      "Supplier B, by ₦70,000",
      "Supplier B, by ₦10,000",
      "They cost exactly the same",
    ],
    correct: "c",
  },
  {
    area: "percent",
    difficulty: 7,
    text: "Sales were ₦2,500,000 in March and ₦3,000,000 in April. By what percentage did sales increase?",
    options: ["20%", "25%", "16.7%", "50%"],
    correct: "a",
  },
  {
    area: "percent",
    difficulty: 7,
    text: "You make 40 calls. 25% of the calls lead to a meeting, and 30% of those meetings become a sale. How many sales do you make?",
    options: ["4", "12", "3", "10"],
    correct: "c",
  },
  {
    area: "percent",
    difficulty: 8,
    text: "You earn 3% commission on the first ₦5,000,000 you sell in a month and 4% on everything above that. This month you sell ₦8,000,000. What is your total commission?",
    options: ["₦240,000", "₦280,000", "₦320,000", "₦270,000"],
    correct: "d",
  },
  {
    area: "price",
    difficulty: 8,
    text: "You buy an item for ₦400,000 and set a selling price that gives 25% profit on cost. The customer then negotiates 10% off your selling price. How much profit do you make?",
    options: ["₦60,000", "₦50,000", "₦40,000", "₦75,000"],
    correct: "b",
  },
  {
    area: "price",
    difficulty: 3,
    text: "A client meeting starts at 2:15 pm and the journey takes 1 hour 50 minutes. What is the latest time you can leave and still arrive on time?",
    options: ["12:25 pm", "12:35 pm", "1:25 pm", "12:15 pm"],
    correct: "a",
  },

  // Communication
  {
    area: "write",
    difficulty: 3,
    text: "Which sentence is written correctly?",
    options: [
      "Their going to send the invoice tomorrow.",
      "They're going to send the invoice tomorrow.",
      "There going to send the invoice tomorrow.",
      "They're going too send the invoice tomorrow.",
    ],
    correct: "b",
  },
  {
    area: "write",
    difficulty: 4,
    text: "You met Mrs Okafor at her office yesterday. Which is the best opening line for your follow-up message?",
    options: [
      "Hi, did you think about what I told you? I'm still waiting for your reply.",
      "Dear Sir/Madam, I am writing to introduce our company and our products.",
      "Good morning Ma, please kindly revert back urgently on our discussion ASAP.",
      "Good morning Mrs Okafor, thank you for your time at your office yesterday.",
    ],
    correct: "d",
  },
  {
    area: "respond",
    difficulty: 5,
    text: "A client messages you to complain that their delivery is two days late. Which reply is best?",
    options: [
      "I'm sorry for the delay. Logistics confirm it arrives Thursday by noon, and I'll message you when it leaves.",
      "Sorry, but delivery delays are handled by the logistics team, not by sales, so please contact them.",
      "Delays happen with every supplier at this time of year, so we kindly ask you to be patient with us.",
      "Thank you for your message. We will look into it and get back to you as soon as we possibly can.",
    ],
    correct: "a",
  },
  {
    area: "respond",
    difficulty: 5,
    text: "Your call note reads: \"Spoke with Mr Bello (Ops Manager, Bello Foods). Interested in 2 units. Budget OK. Needs MD approval. MD back from travel on the 12th. Asked us to call on the 13th.\"\n\nWhich one-sentence summary for your manager is most accurate?",
    options: [
      "Mr Bello wants 2 units and his budget is fine, so the Bello Foods deal is closed.",
      "Bello Foods' MD is away until the 12th, so the company is not interested for now.",
      "Bello Foods wants 2 units and has budget, but the MD must approve; call on the 13th.",
      "Bello Foods must check its budget with the MD before deciding on the 2 units.",
    ],
    correct: "c",
  },
  {
    area: "write",
    difficulty: 6,
    text: "Which message best explains a price increase to an existing client?",
    options: [
      "Prices have gone up. The new price list is attached. Let us know what you want to do.",
      "From 1 December our prices rise by 8% because of higher import costs. Orders confirmed before then keep today's price.",
      "Due to unforeseen circumstances beyond our control, pricing has been revised upwards accordingly.",
      "We regret to inform you that prices will increase soon, so you should place your order now before it is late.",
    ],
    correct: "b",
  },
  {
    area: "respond",
    difficulty: 7,
    text: "Your manager writes: \"Please deliver the order to the client after the manager confirms it on Friday.\"\n\nWhich question most needs answering before you act?",
    options: [
      "Which manager in the team is responsible for confirming orders?",
      "Should the client be told the delivery time by phone or by email?",
      "Does the client prefer a morning delivery or an afternoon delivery?",
      "Is the delivery on Friday, or is the manager's confirmation on Friday?",
    ],
    correct: "d",
  },
  {
    area: "respond",
    difficulty: 4,
    text: "A prospect says: \"We tried something like this before and it didn't work for us.\" What is the best next thing to say?",
    options: [
      "Our product is different, so you won't have that problem this time.",
      "Many of our customers said the same thing before they bought from us.",
      "What happened last time, and what would need to be different now?",
      "That's fine. Can I still send you our price list to look at later?",
    ],
    correct: "c",
  },
];

const OPENS: Open[] = [
  {
    area: "write",
    difficulty: 5,
    text: "A customer you have never met sends this WhatsApp message:\n\n\"How much is the bigger package you advertised, and how fast can you deliver to Gwarinpa?\"\n\nThe bigger package costs ₦1,450,000. You do not yet know the delivery time to Gwarinpa. Write the reply you would send, in 3 to 5 sentences.",
    rubric:
      "Score on written communication, not product knowledge. Full marks need all of: a polite greeting; the price stated clearly as ₦1,450,000; an honest answer on delivery that does NOT invent a delivery date, instead saying it is being confirmed and when the customer will hear back; a clear next step or question that moves the sale forward (e.g. confirming the delivery address or asking when they need it); correct grammar and spelling; professional but friendly tone suited to WhatsApp. Half marks: price and honest delivery answer present but tone, structure or grammar is weak, or no next step. Zero: no price, a made-up delivery promise, rude or careless tone, or so many errors the meaning is unclear. Do not reward length beyond 5 sentences.",
  },
  {
    area: "write",
    difficulty: 6,
    text: "Read your meeting notes:\n\n\"Met Mrs Adeyemi, Admin Manager, Greenfield Schools (3 campuses in Lagos). Wants pricing for all 3 campuses. Deal likely around ₦14 million. Decision by end of month. Asked for a site visit next week.\"\n\nApprentices close deals under ₦10 million on their own; larger deals are handled with a senior sales manager. Write a short email (4 to 6 sentences) to your sales manager summarising the meeting and saying what you need from them.",
    rubric:
      "Score on comprehension and written communication. Full marks need all of: names the client and organisation; states the likely deal size (about ₦14 million) and recognises it is above the ₦10 million apprentice limit so the manager must be involved; gives the decision deadline (end of month); mentions the site visit requested for next week; makes a specific request of the manager (e.g. join the site visit, help prepare pricing for 3 campuses); clear structure, concise, correct grammar, professional tone. Half marks: most facts present but the ask is vague or missing, or it misses the ₦10 million limit, or writing is disorganised. Zero: key facts wrong or missing, no ask, or unclear writing.",
  },
  {
    area: "price",
    difficulty: 6,
    text: "A customer is buying a package for ₦2,000,000 on a payment plan: 30% deposit now, and the balance in 5 equal monthly payments. In 3 to 4 sentences, explain the plan to the customer in plain words, including how much they pay now and how much each month.",
    rubric:
      "Score on arithmetic and clear explanation. Correct figures: deposit ₦600,000; balance ₦1,400,000; each monthly payment ₦280,000; total still ₦2,000,000. Full marks need the correct deposit and monthly figures, explained in plain language a non-expert customer would understand, with correct grammar and a polite tone. Half marks: one figure wrong but the method is clearly right and the explanation is clear, OR figures correct but explanation confusing. Zero: deposit and monthly figures both wrong, or explanation missing.",
  },
];

async function main(): Promise<void> {
  const [bank] = await db
    .select()
    .from(tenantAssessmentBank)
    .where(eq(tenantAssessmentBank.id, BANK_ID))
    .limit(1);
  if (!bank) throw new Error(`bank ${BANK_ID} not found`);
  if (bank.status !== "ready" || !bank.assessmentLinkToken) {
    throw new Error(`bank is ${bank.status}, expected ready with a link token`);
  }

  const [assessment] = await db
    .select()
    .from(assessments)
    .where(eq(assessments.slug, bank.assessmentLinkToken))
    .limit(1);
  if (!assessment) throw new Error(`assessment ${bank.assessmentLinkToken} not found`);

  const [counts] = await db
    .select({
      scored: sql<number>`count(*) filter (where ${questions.sample} = false)::int`,
      sample: sql<number>`count(*) filter (where ${questions.sample} = true)::int`,
    })
    .from(questions)
    .where(eq(questions.assessmentId, assessment.id));

  const byStatus = await db
    .select({ status: responses.status, n: sql<number>`count(*)::int` })
    .from(responses)
    .where(eq(responses.assessmentId, assessment.id))
    .groupBy(responses.status);

  console.log("Bank:", bank.id, "status", bank.status, "seniority", bank.claimedSeniority);
  console.log("Assessment:", assessment.id, `"${assessment.title}"`, "mode", assessment.mode, "pass", `${assessment.passThreshold}%`);
  console.log("Specialisation now:", assessment.specialisation);
  console.log("Questions now:", counts.scored, "scored,", counts.sample, "practice");
  console.log("Responses so far:", byStatus.length ? byStatus.map((r) => `${r.n} ${r.status}`).join(", ") : "none");
  console.log(`Replacement: ${MCQS.length} multiple choice + ${OPENS.length} written`);

  if (assessment.mode === "fixed" && assessment.title === TITLE) {
    console.log("Already replaced. Nothing to do.");
    return;
  }
  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const tenantTag = bank.tenantId.slice(0, 8);

  await db.transaction(async (tx) => {
    const [board] = await tx
      .insert(skillboards)
      .values({
        specialisation: `Sales Associate Apprentice Aptitude (tenant:${tenantTag} · ${stamp})`,
        description:
          "Aptitude for an apprentice sales role: reading comprehension, written and spoken communication, and sales arithmetic. No industry knowledge assessed.",
        creationPath: "tenant_builder",
        roleFamily: "bd_pm",
        provisional: true,
        originatingTenantId: bank.tenantId,
      })
      .returning({ id: skillboards.id, specialisation: skillboards.specialisation });

    const taskIds = new Map<Area, { taskId: string; skillId: string }>();
    for (const [si, s] of STRUCTURE.entries()) {
      const [skill] = await tx
        .insert(skills)
        .values({ skillboardId: board.id, name: s.skill, orderIndex: si })
        .returning({ id: skills.id });
      for (const [ti, t] of s.tasks.entries()) {
        const [task] = await tx
          .insert(tasks)
          .values({ skillId: skill.id, name: t.name, orderIndex: ti })
          .returning({ id: tasks.id });
        taskIds.set(t.key, { taskId: task.id, skillId: skill.id });
      }
    }

    // The solar questions move to an archived twin so earlier answers keep
    // pointing at real rows.
    const [archive] = await tx
      .insert(assessments)
      .values({
        title: `[replaced ${stamp}] ${assessment.title}`,
        slug: `${assessment.slug}-replaced-${stamp}`,
        roleType: assessment.roleType,
        status: "archived",
        visibility: "unlisted",
        mode: assessment.mode,
        specialisation: assessment.specialisation,
        passThreshold: assessment.passThreshold,
      })
      .returning({ id: assessments.id });
    const moved = await tx
      .update(questions)
      .set({ assessmentId: archive.id })
      .where(and(eq(questions.assessmentId, assessment.id), eq(questions.sample, false)))
      .returning({ id: questions.id });

    const common = (area: Area, difficulty: number, orderIndex: number) => {
      const anchor = taskIds.get(area)!;
      return {
        assessmentId: assessment.id,
        orderIndex,
        specialisation: board.specialisation,
        band: "junior" as const,
        level: "g" as const,
        skillId: anchor.skillId,
        taskId: anchor.taskId,
        difficultyScore: difficulty,
        competencyArea: STRUCTURE.find((s) => s.tasks.some((t) => t.key === area))!.skill,
        tenantAuthored: false,
        treatment: "algorithm_generated" as const,
      };
    };

    let order = 0;
    for (const q of MCQS) {
      const options: QuestionOption[] = q.options.map((label, i) => ({
        id: "abcd"[i]!,
        label,
      }));
      await tx.insert(questions).values({
        ...common(q.area, q.difficulty, order++),
        type: "mcq",
        questionText: q.text,
        options,
        correctAnswer: [q.correct],
        points: 1,
      });
    }
    for (const q of OPENS) {
      await tx.insert(questions).values({
        ...common(q.area, q.difficulty, order++),
        type: "open",
        questionText: q.text,
        points: 2,
        scoringRubric: q.rubric,
      });
    }

    await tx
      .update(assessments)
      .set({
        title: TITLE,
        introText: INTRO,
        mode: "fixed",
        roleType: "bd",
        specialisation: board.specialisation,
      })
      .where(eq(assessments.id, assessment.id));

    await tx
      .update(tenantAssessmentBank)
      .set({ claimedSeniority: bank.claimedSeniority ?? "junior", updatedAt: new Date() })
      .where(eq(tenantAssessmentBank.id, bank.id));

    console.log(`\nApplied. Moved ${moved.length} questions to archive ${archive.id}; inserted ${order}; board ${board.id}.`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? `${err.message}\n${String((err as { cause?: unknown }).cause ?? "")}` : err);
    process.exit(1);
  });
