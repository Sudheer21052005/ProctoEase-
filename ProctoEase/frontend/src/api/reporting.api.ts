import api from "./axios"
import { API_BASE_URL } from "@/lib/constants"

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

export const reportingApi = {
  dashboard: () =>
    api.get<TenantDashboard>("/dashboard").then((r) => r.data),

  examAnalytics: (examId: string) =>
    api.get<ExamAnalytics>(`/exams/${examId}/analytics`).then((r) => r.data),

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
}
