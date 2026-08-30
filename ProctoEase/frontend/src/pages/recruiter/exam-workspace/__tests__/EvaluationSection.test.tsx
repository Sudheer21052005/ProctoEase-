// @vitest-environment jsdom
/**
 * Component tests for EvaluationSection (Phase C).
 *
 * The React Query hook is mocked, so no QueryClientProvider is needed.
 * FeatureGuard is a pass-through; react-router-dom is partially mocked for
 * useParams/useNavigate; sonner's toast is spied.
 */

import "@testing-library/jest-dom/vitest"
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import type { CandidateEvaluation, ExamEvaluationResponse } from "@/api/reporting.api"
import type { UseQueryResult } from "@tanstack/react-query"

// -- Module mocks -----------------------------------------------------------------

const refetch = vi.fn()
const navigate = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()
const mutateAsync = vi.fn()

let mockHookReturn: Pick<UseQueryResult<ExamEvaluationResponse, Error>, "data" | "isLoading" | "isError" | "refetch" | "isFetching">

vi.mock("@/hooks/useReporting", () => ({
  useExamEvaluation: () => mockHookReturn,
  useSetRecruiterDecision: () => ({ mutateAsync }),
}))

vi.mock("@/api/reporting.api", () => ({
  RECRUITER_DECISIONS: ["PENDING", "SHORTLISTED", "REVIEW", "REJECTED"],
  reportingApi: {
    downloadIntegrityReportPdf: vi.fn(),
  },
}))

vi.mock("@/components/security/FeatureGuard", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useParams: () => ({ examId: "exam-1" }),
    useNavigate: () => navigate,
  }
})

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import { reportingApi } from "@/api/reporting.api"
import EvaluationSection from "../EvaluationSection"

// -- Fixtures ----------------------------------------------------------------------

function makeCandidate(overrides: Partial<CandidateEvaluation> = {}): CandidateEvaluation {
  return {
    attempt_id: "attempt-AAA",
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
    recruiter_decision: null,
    recruiter_notes: null,
    reviewed_by: null,
    reviewed_at: null,
    ...overrides,
  }
}

function makeResponse(candidates: CandidateEvaluation[]): ExamEvaluationResponse {
  return {
    exam_id: "exam-1",
    exam_title: "Backend Screen",
    total_attempts: candidates.length,
    max_score: 50,
    objective_max_score: 35,
    coding_max_score: 15,
    passing_score_pct: 50,
    borderline_max_pct: 60,
    excellence_score_pct: 75,
    candidates,
  }
}

function renderSection() {
  return render(<EvaluationSection />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHookReturn = {
    data: makeResponse([]),
    isLoading: false,
    isError: false,
    refetch,
    isFetching: false,
  }
})

// vitest runs with globals:false, so RTL's automatic afterEach(cleanup)
// registration never hooks in — DOM would accumulate across tests. Clean up
// explicitly.
afterEach(() => {
  cleanup()
})

// -- Tests -------------------------------------------------------------------------

describe("EvaluationSection", () => {
  it("8. renders one row per candidate with name/email/score/risk/violations/label", () => {
    mockHookReturn.data = makeResponse([
      makeCandidate(),
      makeCandidate({
        attempt_id: "attempt-BBB",
        candidate_name: "Grace Hopper",
        candidate_email: "grace@navy.mil",
        percentage: 44,
        total_score: 22,
        risk_level: "high",
        risk_score: 0.8,
        total_violations: 7,
        high_violations: 2,
        critical_violations: 1,
        recommendation: { code: "INTEGRITY_REVIEW", label: "Integrity review required", reason: "Severe integrity findings." },
      }),
    ])
    renderSection()

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
    expect(screen.getByText("ada@techcorp.demo")).toBeInTheDocument()
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument()
    expect(screen.getByText("82.0%")).toBeInTheDocument()
    expect(screen.getByText("44.0%")).toBeInTheDocument()
    // risk badge text is the raw level (uppercase is CSS-only); the same
    // string also appears on the risk filter pill
    expect(screen.getAllByText("high")).toHaveLength(2)
    expect(screen.getByText("7")).toBeInTheDocument()
    expect(screen.getByText("1 crit · 2 high")).toBeInTheDocument()
    expect(screen.getByText("Shortlist")).toBeInTheDocument()
    expect(screen.getByText("Integrity review required")).toBeInTheDocument()
  })

  it("9. loading state renders the spinner", () => {
    mockHookReturn.isLoading = true
    mockHookReturn.data = undefined
    renderSection()
    expect(screen.getByTestId("evaluation-loading")).toBeInTheDocument()
  })

  it("10. error state shows a message and Retry invokes refetch", () => {
    mockHookReturn.isError = true
    mockHookReturn.data = undefined
    renderSection()

    expect(screen.getByText(/could not load the exam evaluation/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it("11. empty exam renders the EmptyState (no attempts yet)", () => {
    mockHookReturn.data = makeResponse([])
    renderSection()

    expect(screen.getByText("No attempts yet")).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("12. recommendation is shown VERBATIM — label and reason render as-is; unknown code still renders backend label", () => {
    mockHookReturn.data = makeResponse([
      makeCandidate(),
      makeCandidate({
        attempt_id: "attempt-GARBLE",
        candidate_name: "Future Candidate",
        recommendation: {
          // A code this frontend build has never seen: must still render the
          // backend label/reason untouched (no client recomputation).
          code: "SOMETHING_NEW" as never,
          label: "Freshly Named Verdict",
          reason: "Produced by a newer engine version; frontend must not alter it.",
        },
      }),
    ])
    renderSection()

    expect(screen.getByText("Shortlist")).toBeInTheDocument()
    expect(
      screen.getByText("Score 82% is at or above the excellence benchmark with clean integrity.")
    ).toBeInTheDocument()
    expect(screen.getByText("Freshly Named Verdict")).toBeInTheDocument()
    expect(
      screen.getByText("Produced by a newer engine version; frontend must not alter it.")
    ).toBeInTheDocument()
  })

  it("13. Review action navigates to ../review?attemptId=<that row's id>", () => {
    mockHookReturn.data = makeResponse([
      makeCandidate(),
      makeCandidate({ attempt_id: "attempt-BBB", candidate_name: "Grace Hopper", candidate_email: "grace@navy.mil" }),
    ])
    renderSection()

    const reviewButtons = screen.getAllByRole("button", { name: "Review" })
    expect(reviewButtons).toHaveLength(2)
    fireEvent.click(reviewButtons[1])
    expect(navigate).toHaveBeenCalledExactlyOnceWith("../review?attemptId=attempt-BBB")
  })

  it("14. Download action calls downloadIntegrityReportPdf with that row's attempt_id and toasts success", async () => {
    const downloadMock = vi.mocked(reportingApi.downloadIntegrityReportPdf)
    downloadMock.mockResolvedValueOnce(undefined)
    mockHookReturn.data = makeResponse([makeCandidate()])
    renderSection()

    fireEvent.click(screen.getByRole("button", { name: "Download Integrity Report" }))
    await vi.waitFor(() => expect(downloadMock).toHaveBeenCalledExactlyOnceWith("attempt-AAA"))
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Integrity report downloaded."))
  })

  it("15. recommendation reason is displayed as secondary text under the pill", () => {
    const reason = "Severe integrity findings outweigh strong academic performance."
    mockHookReturn.data = makeResponse([
      makeCandidate({
        recommendation: { code: "INTEGRITY_REVIEW", label: "Integrity review required", reason },
      }),
    ])
    renderSection()

    const reasonEl = screen.getByText(reason)
    expect(reasonEl).toBeInTheDocument()
    // Also exposed as the pill's tooltip.
    expect(screen.getByTitle(reason)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Phase D — human recruiter decision (separate from system recommendation)
// ═══════════════════════════════════════════════════════════════════════════

describe("EvaluationSection — recruiter decision (Phase D)", () => {
  it("D1. displays the current decision per row; never-reviewed renders PENDING; reviewed metadata shown", () => {
    mockHookReturn.data = makeResponse([
      makeCandidate(),
      makeCandidate({
        attempt_id: "attempt-REVIEWED",
        candidate_name: "Sanya Nair",
        candidate_email: "sanya@techcorp.demo",
        recommendation: {
          code: "NOT_RECOMMENDED_BOTH",
          label: "Not recommended (both)",
          reason: "Failing score with severe integrity findings.",
        },
        recruiter_decision: "REJECTED",
        recruiter_notes: "Reviewed integrity evidence and examination performance.",
        reviewed_by: "reviewer-1",
        reviewed_at: "2026-08-30T12:00:00Z",
      }),
    ])
    renderSection()

    // Never-reviewed row shows the PENDING default; reviewed row shows its
    // persisted decision. Both columns coexist with the system recommendation
    // (its labels/reasons still visible above).
    expect(screen.getAllByText("PENDING").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("REJECTED")).toBeInTheDocument()
    expect(screen.getByText("Reviewed integrity evidence and examination performance.")).toBeInTheDocument()
    // Metadata line ("Reviewed <date>") plus the notes line both mention "Reviewed".
    expect(screen.getAllByText(/Reviewed/i).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("Shortlist")).toBeInTheDocument() // system recommendation untouched
  })

  it("D2. Decide opens the editor with select + notes; save posts the decision for THAT attempt id and toasts success", async () => {
    mutateAsync.mockResolvedValueOnce({
      attempt_id: "attempt-AAA",
      decision: "SHORTLISTED",
      notes: "Strong technical performance after manual review.",
      reviewed_by: "reviewer-1",
      reviewed_by_email: "recruiter@techcorp.com",
      reviewed_at: "2026-08-30T12:00:00Z",
    })
    mockHookReturn.data = makeResponse([
      makeCandidate(),
      makeCandidate({ attempt_id: "attempt-BBB", candidate_name: "Grace Hopper", candidate_email: "grace@navy.mil" }),
    ])
    renderSection()

    // Open the editor on the FIRST row only (Grace's row has its own editor).
    const decideButtons = screen.getAllByRole("button", { name: "Decide" })
    expect(decideButtons).toHaveLength(2)
    fireEvent.click(decideButtons[0])

    const decisionSelect = screen.getByLabelText("Recruiter decision")
    const notesInput = screen.getByLabelText("Recruiter notes")
    fireEvent.change(decisionSelect, { target: { value: "SHORTLISTED" } })
    fireEvent.change(notesInput, { target: { value: "Strong technical performance after manual review." } })
    fireEvent.click(screen.getByRole("button", { name: /save decision/i }))

    await vi.waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
        attemptId: "attempt-AAA", // the row whose editor was used
        payload: { decision: "SHORTLISTED", notes: "Strong technical performance after manual review." },
      })
    )
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastError).not.toHaveBeenCalled()
  })

  it("D3. API failure surfaces an error toast and keeps the editor open", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("Unable to save the recruiter decision."))
    mockHookReturn.data = makeResponse([makeCandidate()])
    renderSection()

    fireEvent.click(screen.getByRole("button", { name: "Decide" }))
    fireEvent.click(screen.getByRole("button", { name: /save decision/i }))

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("Unable to save the recruiter decision."))
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Recruiter decision")).toBeInTheDocument() // editor still open
  })

  it("D4. system recommendation and recruiter decision remain visibly separate", () => {
    mockHookReturn.data = makeResponse([
      makeCandidate({
        recommendation: {
          code: "NOT_RECOMMENDED_BOTH",
          label: "Not recommended (both)",
          reason: "Failing score with severe integrity findings.",
        },
        recruiter_decision: "SHORTLISTED", // human override — valid by design
        recruiter_notes: "Recruiter has final authority.",
        reviewed_at: "2026-08-30T12:00:00Z",
      }),
    ])
    renderSection()

    // Both are present, distinct, and neither replaced the other.
    expect(screen.getByText("Not recommended (both)")).toBeInTheDocument()
    expect(screen.getByText("SHORTLISTED")).toBeInTheDocument()
    expect(screen.getByText("Recruiter has final authority.")).toBeInTheDocument()
    // The banner states the separation rule.
    expect(screen.getByText(/never alters the system recommendation/i)).toBeInTheDocument()
  })

  it("D5. Cancel closes the editor without calling the API", () => {
    mockHookReturn.data = makeResponse([makeCandidate()])
    renderSection()

    fireEvent.click(screen.getByRole("button", { name: "Decide" }))
    expect(screen.getByLabelText("Recruiter decision")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByLabelText("Recruiter decision")).not.toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
