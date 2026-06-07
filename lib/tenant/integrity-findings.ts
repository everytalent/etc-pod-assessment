/**
 * Integrity findings translator (PRD §5).
 *
 * Converts raw engine signals (counts, percentages, IP matches) into a
 * plain-English findings array tenants can read directly. The tenant
 * NEVER sees raw counts (no "5 copy-paste events", no "3 tab switches"
 * etc.) — that data lives in admin-only surfaces.
 *
 * Each finding is one sentence. Severity is bucketed coarsely
 * (info/warn/critical) so the dashboard can colour-code without
 * mathematical compositing.
 */

import { and, eq, ne, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  candidateIpMatch,
  responses,
  type CandidateIpMatch,
} from "@/lib/db/schema";

export type IntegrityFindingSeverity = "info" | "warn" | "critical";

export type IntegrityFinding = {
  text: string;
  severity: IntegrityFindingSeverity;
  /** Internal category — useful for analytics, never shown to tenants. */
  category:
    | "ai_assistance"
    | "same_device"
    | "tab_switching"
    | "paste_pattern"
    | "style_drift"
    | "pacing_anomaly"
    | "proctoring"
    | "clean";
};

export type RawIntegritySignals = {
  /** From the existing integrity scoring pipeline. */
  copyPasteEvents?: number;
  tabSwitchEvents?: number;
  averageResponseTimeStdDev?: number;
  styleShiftScore?: number;
  aiLikelihoodScore?: number;
  proctoringFlagged?: boolean;
};

/** Pure-data translator — easy to unit test. */
export function translateRawSignals(
  signals: RawIntegritySignals,
): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];

  if ((signals.aiLikelihoodScore ?? 0) > 0.7) {
    findings.push({
      text: "This candidate's answers show patterns suggesting outside AI assistance on at least some responses.",
      severity: "critical",
      category: "ai_assistance",
    });
  }
  if ((signals.copyPasteEvents ?? 0) >= 3) {
    findings.push({
      text: "This candidate's answers appear to have been pasted from another source rather than typed.",
      severity: "warn",
      category: "paste_pattern",
    });
  }
  if ((signals.tabSwitchEvents ?? 0) >= 3) {
    findings.push({
      text: "The candidate switched away from the assessment several times during long-answer questions.",
      severity: "warn",
      category: "tab_switching",
    });
  }
  if ((signals.styleShiftScore ?? 0) > 0.6) {
    findings.push({
      text: "The writing style of this candidate's answers shifts noticeably between questions, suggesting outside help on some responses.",
      severity: "warn",
      category: "style_drift",
    });
  }
  if (
    signals.averageResponseTimeStdDev !== undefined &&
    signals.averageResponseTimeStdDev < 0.15
  ) {
    findings.push({
      text: "Response times were unusually consistent across difficulty levels, which is uncommon in genuine attempts.",
      severity: "info",
      category: "pacing_anomaly",
    });
  }
  if (signals.proctoringFlagged) {
    findings.push({
      text: "Proctoring layer flagged anomalies during the session (camera or microphone signals).",
      severity: "warn",
      category: "proctoring",
    });
  }

  if (findings.length === 0) {
    findings.push({
      text: "No integrity concerns detected.",
      severity: "info",
      category: "clean",
    });
  }

  return findings;
}

/**
 * Detect same-IP candidates within a tenant assessment bank and
 * persist matches into candidate_ip_match. Idempotent: re-running
 * doesn't write duplicate rows.
 *
 * Returns the count of newly-persisted matches involving `responseId`.
 */
export async function detectAndPersistIpMatchesFor(
  responseId: string,
): Promise<number> {
  const [self] = await db
    .select()
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!self) return 0;

  const meta = (self.metadata ?? {}) as {
    tenant_bank_id?: string;
    candidate_ip_address?: string;
  };
  if (!meta.tenant_bank_id || !meta.candidate_ip_address) return 0;

  // Find other completed candidates for the same bank with the same IP.
  const others = await db
    .select()
    .from(responses)
    .where(
      and(
        eq(responses.assessmentId, self.assessmentId),
        ne(responses.id, responseId),
      ),
    );

  const matches: Array<{ otherId: string; ip: string }> = [];
  for (const other of others) {
    const otherMeta = (other.metadata ?? {}) as {
      tenant_bank_id?: string;
      candidate_ip_address?: string;
    };
    if (
      otherMeta.tenant_bank_id === meta.tenant_bank_id &&
      otherMeta.candidate_ip_address &&
      otherMeta.candidate_ip_address === meta.candidate_ip_address
    ) {
      matches.push({
        otherId: other.id,
        ip: meta.candidate_ip_address,
      });
    }
  }

  if (matches.length === 0) return 0;

  // Insert each match if not already present. The (a,b)/(b,a) ordering
  // doesn't matter — we de-dupe via the OR query.
  let written = 0;
  for (const m of matches) {
    const [existing] = await db
      .select({ id: candidateIpMatch.id })
      .from(candidateIpMatch)
      .where(
        and(
          eq(candidateIpMatch.tenantAssessmentBankId, meta.tenant_bank_id),
          or(
            and(
              eq(candidateIpMatch.responseAId, responseId),
              eq(candidateIpMatch.responseBId, m.otherId),
            ),
            and(
              eq(candidateIpMatch.responseAId, m.otherId),
              eq(candidateIpMatch.responseBId, responseId),
            ),
          )!,
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(candidateIpMatch).values({
      tenantAssessmentBankId: meta.tenant_bank_id,
      responseAId: responseId,
      responseBId: m.otherId,
      sharedIpAddress: m.ip,
    });
    written += 1;
  }
  return written;
}

/**
 * Lookup helper for the result page — finds same-IP matches involving
 * this response and returns the other candidates' names so the
 * findings translator can name them directly.
 */
export async function loadIpMatchPartnersFor(
  responseId: string,
): Promise<CandidateIpMatch[]> {
  return db
    .select()
    .from(candidateIpMatch)
    .where(
      or(
        eq(candidateIpMatch.responseAId, responseId),
        eq(candidateIpMatch.responseBId, responseId),
      )!,
    );
}
