import { describe, it, expect } from "vitest"
import {
  applyFilters,
  sortCandidates,
  RECOMMENDATION_CODES,
  RISK_LEVELS,
  RECOMMENDATION_DISPLAY_RANK,
  type SortKey,
  type SortDir,
} from "../evaluation.logic"
import type { CandidateEvaluation } from "@/api/reporting.api"

function makeCandidate(overrides: Partial<CandidateEvaluation> = {}): CandidateEvaluation {
  return {
    attempt_id: "attempt-1",
    candidate_id: "candidate-1",
    candidate_name: "Ada Lovelace",
    candidate_email: "ada@techcorp.demo",
    status: "evaluated",
    started_at: "2026-08-29T10:00:00Z",
    submitted_at: "2026-08-29T11:00:00Z",
    duration_minutes: 60,
    total_score: 41,
    max_score: 50,
    percentage: 82,
    objective_score: 30,
    objective_max_score: 35,
    coding_score: 11,
    coding_max_score: 15,
    risk_score: 0.2,
    risk_level: "low",
    risk_available: true,
    total_violations: 0,
    high_violations: 0,
    critical_violations: 0,
    severe_integrity: false,
    recommendation: {
      code: "SHORTLIST",
      label: "Shortlist",
      reason: "Score 82% is at or above the excellence benchmark with clean integrity.",
    },
    ...overrides,
  }
}

const base = [
  makeCandidate(),
  makeCandidate({
    attempt_id: "attempt-2",
    candidate_id: "candidate-2",
    candidate_name: "Grace Hopper",
    candidate_email: "grace@navy.mil",
    status: "submitted",
    percentage: 44,
    total_score: 22,
    risk_score: 0.8,
    risk_level: "high",
    total_violations: 7,
    high_violations: 2,
    critical_violations: 1,
    severe_integrity: true,
    recommendation: {
      code: "INTEGRITY_REVIEW",
      label: "Integrity review required",
      reason: "Severe integrity findings outweigh strong academic performance.",
    },
  }),
  makeCandidate({
    attempt_id: "attempt-3",
    candidate_id: "candidate-3",
    candidate_name: null,
    candidate_email: "ghost@techcorp.demo",
    status: "started",
    percentage: null,
    total_score: null,
    duration_minutes: null,
    submitted_at: null,
    risk_score: null,
    risk_level: null,
    risk_available: false,
    recommendation: {
      code: "MANUAL_REVIEW",
      label: "Manual review",
      reason: "Attempt incomplete; not enough data.",
    },
  }),
]

const NO_FILTERS = {
  search: "",
  risk: "all" as const,
  recommendation: "all" as const,
  status: "all" as const,
  severeOnly: false,
}

describe("evaluation.logic — applyFilters", () => {
  it("1. search filters by name AND email, case-insensitively", () => {
    const byName = applyFilters(base, { ...NO_FILTERS, search: "lovelace" })
    expect(byName.map((c) => c.attempt_id)).toEqual(["attempt-1"])

    const byEmail = applyFilters(base, { ...NO_FILTERS, search: "NAVY" })
    expect(byEmail.map((c) => c.attempt_id)).toEqual(["attempt-2"])

    // attempt_id convenience match
    const byId = applyFilters(base, { ...NO_FILTERS, search: "attempt-3" })
    expect(byId.map((c) => c.attempt_id)).toEqual(["attempt-3"])

    // null name must not crash the search
    const byNull = applyFilters(base, { ...NO_FILTERS, search: "ghost" })
    expect(byNull.map((c) => c.attempt_id)).toEqual(["attempt-3"])
  })

  it("2. risk filter matches each level, 'all', and excludes unavailable risk", () => {
    for (const level of RISK_LEVELS) {
      const got = applyFilters(base, { ...NO_FILTERS, risk: level })
      expect(got.every((c) => c.risk_available && c.risk_level === level)).toBe(true)
    }
    expect(applyFilters(base, { ...NO_FILTERS, risk: "low" }).map((c) => c.attempt_id)).toEqual(["attempt-1"])
    expect(applyFilters(base, { ...NO_FILTERS, risk: "high" }).map((c) => c.attempt_id)).toEqual(["attempt-2"])
    expect(applyFilters(base, { ...NO_FILTERS, risk: "critical" })).toEqual([])
    expect(applyFilters(base, { ...NO_FILTERS, risk: "all" }).length).toBe(3)
  })

  it("3. recommendation filter matches by code plus 'all'", () => {
    const got = applyFilters(base, { ...NO_FILTERS, recommendation: "INTEGRITY_REVIEW" })
    expect(got.map((c) => c.attempt_id)).toEqual(["attempt-2"])
    expect(applyFilters(base, { ...NO_FILTERS, recommendation: "STRONG_SHORTLIST" })).toEqual([])
    expect(applyFilters(base, { ...NO_FILTERS, recommendation: "all" }).length).toBe(3)
  })

  it("4. status filter matches started/submitted/evaluated plus 'all'", () => {
    expect(applyFilters(base, { ...NO_FILTERS, status: "started" }).map((c) => c.attempt_id)).toEqual(["attempt-3"])
    expect(applyFilters(base, { ...NO_FILTERS, status: "submitted" }).map((c) => c.attempt_id)).toEqual(["attempt-2"])
    expect(applyFilters(base, { ...NO_FILTERS, status: "evaluated" }).map((c) => c.attempt_id)).toEqual(["attempt-1"])
    expect(applyFilters(base, { ...NO_FILTERS, status: "all" }).length).toBe(3)
  })

  it("severeOnly keeps only severe_integrity candidates", () => {
    const got = applyFilters(base, { ...NO_FILTERS, severeOnly: true })
    expect(got.map((c) => c.attempt_id)).toEqual(["attempt-2"])
  })

  it("6. a filter set matching nothing returns []", () => {
    expect(
      applyFilters(base, { search: "nobody-remote", risk: "all", recommendation: "all", status: "all", severeOnly: false })
    ).toEqual([])
  })
})

describe("evaluation.logic — sortCandidates", () => {
  const withNulls = [
    makeCandidate({ attempt_id: "a", percentage: 50, risk_score: 0.5, duration_minutes: 30 }),
    makeCandidate({ attempt_id: "b", percentage: null, risk_score: null, duration_minutes: null, submitted_at: null }),
    makeCandidate({ attempt_id: "c", percentage: 90, risk_score: 0.1, duration_minutes: 90 }),
  ]

  function idsFor(key: SortKey, dir: SortDir, rows = withNulls): string[] {
    return sortCandidates(rows, key, dir).map((c) => c.attempt_id)
  }

  it("5a. sorts by percentage asc and desc with nulls last", () => {
    expect(idsFor("score", "asc")).toEqual(["a", "c", "b"])
    expect(idsFor("score", "desc")).toEqual(["c", "a", "b"])
  })

  it("5b. sorts by risk_score asc and desc with nulls last", () => {
    expect(idsFor("risk", "asc")).toEqual(["c", "a", "b"])
    expect(idsFor("risk", "desc")).toEqual(["a", "c", "b"])
  })

  it("5c. sorts by duration asc and desc with nulls last", () => {
    expect(idsFor("duration", "asc")).toEqual(["a", "c", "b"])
    expect(idsFor("duration", "desc")).toEqual(["c", "a", "b"])
  })

  it("5d. sorts by submitted_at asc and desc with nulls last", () => {
    const rows = [
      makeCandidate({ attempt_id: "late", submitted_at: "2026-09-01T10:00:00Z" }),
      makeCandidate({ attempt_id: "early", submitted_at: "2026-08-01T10:00:00Z" }),
      makeCandidate({ attempt_id: "never", submitted_at: null }),
    ]
    expect(sortCandidates(rows, "submitted", "asc").map((c) => c.attempt_id)).toEqual(["early", "late", "never"])
    expect(sortCandidates(rows, "submitted", "desc").map((c) => c.attempt_id)).toEqual(["late", "early", "never"])
  })

  it("5e. sorts by name with null names last", () => {
    // null names fall back to email, then "" (documented comparator behavior)
    const rows = [
      makeCandidate({ attempt_id: "z", candidate_name: "Zora" }),
      makeCandidate({ attempt_id: "null-name", candidate_name: null }), // sorts by email "ghost@..."
      makeCandidate({ attempt_id: "a", candidate_name: "Ada" }),
    ]
    expect(sortCandidates(rows, "candidate", "asc").map((c) => c.attempt_id)).toEqual(["a", "null-name", "z"])
    expect(sortCandidates(rows, "candidate", "desc").map((c) => c.attempt_id)).toEqual(["z", "null-name", "a"])
  })

  it("5f. sorts by violation count asc and desc", () => {
    const rows = [
      makeCandidate({ attempt_id: "many", total_violations: 12 }),
      makeCandidate({ attempt_id: "none", total_violations: 0 }),
    ]
    expect(sortCandidates(rows, "violations", "asc").map((c) => c.attempt_id)).toEqual(["none", "many"])
    expect(sortCandidates(rows, "violations", "desc").map((c) => c.attempt_id)).toEqual(["many", "none"])
  })

  it("5g. sorts by recommendation rank asc and desc without recomputing recommendations", () => {
    expect(sortCandidates(base, "recommendation", "asc").map((c) => c.attempt_id)).toEqual([
      "attempt-2", // INTEGRITY_REVIEW (rank 0)
      "attempt-3", // MANUAL_REVIEW (rank 3)
      "attempt-1", // SHORTLIST (rank 4)
    ])
    expect(sortCandidates(base, "recommendation", "desc").map((c) => c.attempt_id)).toEqual([
      "attempt-1",
      "attempt-3",
      "attempt-2",
    ])
    // An unknown code falls back to the MANUAL_REVIEW rank for ordering only.
    const unknown = makeCandidate({ attempt_id: "u", recommendation: { code: "FUTURE_CODE" as never, label: "Future", reason: "r" } })
    const ranked = sortCandidates([unknown, ...base], "recommendation", "asc").map((c) => c.attempt_id)
    expect(ranked.indexOf("u")).toBeGreaterThan(ranked.indexOf("attempt-2"))
    expect(RECOMMENDATION_DISPLAY_RANK.FUTURE_CODE).toBeUndefined()
  })

  it("does not mutate the input array", () => {
    const rows = [...withNulls]
    sortCandidates(rows, "score", "asc")
    expect(rows.map((c) => c.attempt_id)).toEqual(["a", "b", "c"])
  })

  it("exports the six backend recommendation codes", () => {
    expect(RECOMMENDATION_CODES).toEqual([
      "MANUAL_REVIEW",
      "NOT_RECOMMENDED_ACADEMIC",
      "NOT_RECOMMENDED_BOTH",
      "INTEGRITY_REVIEW",
      "SHORTLIST",
      "STRONG_SHORTLIST",
    ])
  })
})
