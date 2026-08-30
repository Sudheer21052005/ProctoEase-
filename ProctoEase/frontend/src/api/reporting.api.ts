import api from "./axios"

/* ── Reporting types (aligned with backend schemas) ── */
export interface RiskDistribution {
  low: number
  medium: number
  high: number
  critical: number
}

export interface TenantDashboard {
  total_exams: number
  published_exams: number
  total_attempts: number
  completed_attempts: number
  unique_candidates: number
  average_risk_score: number | null
  risk_distribution: RiskDistribution
  total_proctoring_events: number
  total_code_submissions: number
  total_plagiarism_reports: number
}

export interface StatusBreakdown {
  started: number
  submitted: number
  evaluated: number
}

export interface ExamAnalytics {
  exam_id: string
  exam_title: string
  total_attempts: number
  completion_rate: number
  avg_duration_minutes: number | null
  avg_risk_score: number | null
  max_risk_score: number | null
  status_breakdown: StatusBreakdown
  total_proctoring_events: number
  total_code_submissions: number
  flagged_plagiarism_pairs: number
}

export interface QuestionStats {
  question_id: string
  question_text: string
  question_type: string
  total_submissions: number
  accepted_submissions: number
  success_rate: number
  avg_execution_time_sec: number | null
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

/* ── Exam-wide candidate evaluation (Phase B endpoint) ──
 * Snake_case, consumed verbatim from app/schemas/exam_evaluation.py. The
 * recommendation is produced by the backend's deterministic engine; the
 * frontend NEVER recomputes it. */
export type RecommendationCode =
  | "MANUAL_REVIEW"
  | "NOT_RECOMMENDED_ACADEMIC"
  | "NOT_RECOMMENDED_BOTH"
  | "INTEGRITY_REVIEW"
  | "SHORTLIST"
  | "STRONG_SHORTLIST"

export type RiskLevel = "low" | "medium" | "high" | "critical"

export interface RecommendationOut {
  code: RecommendationCode
  label: string
  reason: string
}

export interface CandidateEvaluation {
  // Identity
  attempt_id: string
  candidate_id: string
  candidate_name: string | null
  candidate_email: string | null
  // Attempt status & timing
  status: string // started | submitted | evaluated
  started_at: string | null
  submitted_at: string | null
  duration_minutes: number | null
  // Score breakdown (null when the attempt has no graded answers yet)
  total_score: number | null
  max_score: number
  percentage: number | null
  objective_score: number | null
  objective_max_score: number
  coding_score: number | null
  coding_max_score: number
  // Persisted risk (never recomputed here)
  risk_score: number | null
  risk_level: RiskLevel | null
  risk_available: boolean
  // Violation severity counts (excludes benign periodic_check)
  total_violations: number
  high_violations: number
  critical_violations: number
  // Severe-integrity gate used by the recommendation engine
  severe_integrity: boolean
  // System recommendation (deterministic 7-rule engine)
  recommendation: RecommendationOut
}

export interface ExamEvaluationResponse {
  exam_id: string
  exam_title: string
  total_attempts: number
  max_score: number
  objective_max_score: number
  coding_max_score: number
  // Engine benchmarks (NOT a per-exam pass mark)
  passing_score_pct: number
  borderline_max_pct: number
  excellence_score_pct: number
  candidates: CandidateEvaluation[]
}

export const reportingApi = {
  dashboard: () =>
    api.get<TenantDashboard>("/dashboard").then((r) => r.data),

  examAnalytics: (examId: string) =>
    api.get<ExamAnalytics>(`/exams/${examId}/analytics`).then((r) => r.data),

  examEvaluation: (examId: string) =>
    api.get<ExamEvaluationResponse>(`/exams/${examId}/evaluation`).then((r) => r.data),

  examQuestionStats: (examId: string, page = 1, pageSize = 10) =>
    api
      .get<PaginatedResponse<QuestionStats>>(`/exams/${examId}/question-stats`, {
        params: { page, page_size: pageSize },
      })
      .then((r) => r.data),

  exportExamCsv: async (examId: string) => {
    const response = await api.get(`/exams/${examId}/export/csv`, {
      responseType: "blob",
    })
    const url = window.URL.createObjectURL(
      new Blob([response.data], { type: "text/csv" })
    )
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", `exam-${examId}-results.csv`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },

  exportDashboardCsv: async () => {
    const response = await api.get(`/dashboard/export/csv`, {
      responseType: "blob",
    })
    const url = window.URL.createObjectURL(
      new Blob([response.data], { type: "text/csv" })
    )
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", "dashboard-export.csv")
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },

  /**
   * Download the Candidate Integrity Report PDF for a single exam attempt.
   *
   * Safety contract:
   *  - Only triggers a browser download when the server responds with HTTP 200
   *    AND the response Content-Type is application/pdf AND the blob is non-empty.
   *  - Error responses (4xx/5xx) are read as JSON/text and surfaced as typed
   *    Error objects so callers can show meaningful messages without ever saving
   *    an error blob as a .pdf.
   */
  downloadIntegrityReportPdf: async (attemptId: string): Promise<void> => {
    // Axios throws for non-2xx when validateStatus is default, but blob
    // responseType means the thrown error's response.data is also a Blob.
    // We use validateStatus: () => true so we always get the raw response
    // and can inspect status + Content-Type ourselves.
    const response = await api.get(
      `/attempts/${attemptId}/integrity-report/pdf`,
      {
        responseType: "blob",
        validateStatus: () => true,   // never throw on status
      }
    )

    const { status, data: blob, headers } = response

    // --- Error path: decode the blob body and throw with a clean message ---
    if (status !== 200) {
      let detail = ""
      try {
        const text = await (blob as Blob).text()
        const parsed = JSON.parse(text) as { detail?: string; error_code?: string }
        detail = parsed.detail || parsed.error_code || ""
      } catch {
        /* ignore — blob is not parseable JSON */
      }

      if (status === 401) {
        throw new Error(detail || "Not authorized. Please log in again.")
      }
      if (status === 403) {
        throw new Error(
          detail || "You do not have permission to download this report."
        )
      }
      if (status === 404) {
        throw new Error(detail || "The attempt or report was not found.")
      }
      if (status === 500) {
        throw new Error(
          detail || "The integrity report could not be generated on the server."
        )
      }
      throw new Error(
        detail || `Unable to download the integrity report (HTTP ${status}).`
      )
    }

    // --- Validate Content-Type: must be application/pdf ---
    const contentType: string = (headers["content-type"] as string) || ""
    if (!contentType.includes("application/pdf")) {
      // Server returned 200 but with wrong content type — do not download.
      throw new Error(
        "The server returned an unexpected content type. The report was not downloaded."
      )
    }

    // --- Validate blob is non-empty ---
    const pdfBlob = blob as Blob
    if (pdfBlob.size === 0) {
      throw new Error("The server returned an empty response. The report was not downloaded.")
    }

    // --- Safe to trigger browser download ---
    const url = window.URL.createObjectURL(
      new Blob([pdfBlob], { type: "application/pdf" })
    )
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", `integrity-report-${attemptId}.pdf`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },
}
