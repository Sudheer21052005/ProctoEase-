/**
 * Pure, DOM-free filter/sort helpers for the exam-wide Evaluation tab.
 *
 * These helpers only ARRANGE backend data for display. The system
 * recommendation itself is produced by the backend's deterministic 7-rule
 * engine (Phase B) and is never recomputed, re-derived or re-weighted here.
 */

import type { CandidateEvaluation, RecommendationCode, RiskLevel } from "@/api/reporting.api"

/** The six recommendation codes, exactly as emitted by the backend engine. */
export const RECOMMENDATION_CODES = [
  "MANUAL_REVIEW",
  "NOT_RECOMMENDED_ACADEMIC",
  "NOT_RECOMMENDED_BOTH",
  "INTEGRITY_REVIEW",
  "SHORTLIST",
  "STRONG_SHORTLIST",
] as const

export type RecommendationCodeValue = (typeof RECOMMENDATION_CODES)[number]
export type RecommendationFilter = "all" | RecommendationCode

/** Risk levels for the filter control (mirrors the backend risk_level union). */
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const

export type RiskFilter = "all" | RiskLevel
export type StatusFilter = "all" | "started" | "submitted" | "evaluated"

export interface EvaluationFilterState {
  search: string
  risk: RiskFilter
  recommendation: RecommendationFilter
  status: StatusFilter
  severeOnly: boolean
}

/**
 * PRESENTATION-ORDER RANK MAP ONLY.
 *
 * This map controls the default visual grouping of the table and the pill
 * legend order (concerns first, endorsements last). It is NOT a
 * re-derivation, re-weighting or reinterpretation of the backend's
 * recommendation — the code itself always comes verbatim from the API, and
 * unknown codes still render with a neutral tone and their backend label.
 */
export const RECOMMENDATION_DISPLAY_RANK: Record<string, number> = {
  INTEGRITY_REVIEW: 0,
  NOT_RECOMMENDED_BOTH: 1,
  NOT_RECOMMENDED_ACADEMIC: 2,
  MANUAL_REVIEW: 3,
  SHORTLIST: 4,
  STRONG_SHORTLIST: 5,
}

export type SortKey =
  | "candidate"
  | "score"
  | "risk"
  | "violations"
  | "duration"
  | "submitted"
  | "recommendation"

export type SortDir = "asc" | "desc"

/**
 * Filter candidates by search text (case-insensitive over name, email and —
 * as a low-cost convenience — the attempt id), risk level, recommendation
 * code, attempt status and the severe-integrity flag.
 */
export function applyFilters(
  candidates: CandidateEvaluation[],
  state: EvaluationFilterState
): CandidateEvaluation[] {
  const q = state.search.trim().toLowerCase()
  return candidates.filter((c) => {
    if (q) {
      const haystack =
        `${c.candidate_name ?? ""} ${c.candidate_email ?? ""} ${c.attempt_id}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (state.risk !== "all") {
      if (!c.risk_available || c.risk_level !== state.risk) return false
    }
    if (state.recommendation !== "all" && c.recommendation.code !== state.recommendation) {
      return false
    }
    if (state.status !== "all" && c.status !== state.status) return false
    if (state.severeOnly && !c.severe_integrity) return false
    return true
  })
}

/** Nulls (and NaN) always sink to the bottom, regardless of sort direction. */
function nullSafe<T>(
  a: T | null,
  b: T | null,
  compare: (a: T, b: T) => number,
  mult: number
): number {
  const aNull = a === null || (typeof a === "number" && Number.isNaN(a))
  const bNull = b === null || (typeof b === "number" && Number.isNaN(b))
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  return compare(a as T, b as T) * mult
}

/**
 * Single-column sort. Strings compare via localeCompare; numbers/dates
 * numerically/chronologically; recommendation by the presentation rank map
 * above. Returns a new array; never mutates the input.
 */
export function sortCandidates(
  candidates: CandidateEvaluation[],
  key: SortKey,
  dir: SortDir
): CandidateEvaluation[] {
  const mult = dir === "asc" ? 1 : -1
  const rank = (c: CandidateEvaluation) =>
    RECOMMENDATION_DISPLAY_RANK[c.recommendation.code] ?? RECOMMENDATION_DISPLAY_RANK.MANUAL_REVIEW

  return [...candidates].sort((a, b) => {
    switch (key) {
      case "candidate":
        return (
          (a.candidate_name ?? a.candidate_email ?? "").localeCompare(
            b.candidate_name ?? b.candidate_email ?? ""
          ) * mult
        )
      case "score":
        return nullSafe(a.percentage, b.percentage, (x, y) => x - y, mult)
      case "risk":
        return nullSafe(a.risk_score, b.risk_score, (x, y) => x - y, mult)
      case "violations":
        return (a.total_violations - b.total_violations) * mult
      case "duration":
        return nullSafe(a.duration_minutes, b.duration_minutes, (x, y) => x - y, mult)
      case "submitted":
        return nullSafe(a.submitted_at, b.submitted_at, (x, y) => x.localeCompare(y), mult)
      case "recommendation":
        return (rank(a) - rank(b)) * mult
      default:
        return 0
    }
  })
}
