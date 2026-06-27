import api from "./axios"

export interface PlagiarismPair {
  id: string
  submission_a_id: string
  submission_b_id: string
  candidate_a_id: string
  candidate_b_id: string
  similarity_score: number
  is_flagged: boolean
  matching_tokens: number | null
  total_tokens_a: number | null
  total_tokens_b: number | null
  details: Record<string, unknown> | null
}

export interface PlagiarismReport {
  id: string
  exam_id: string
  status: "pending" | "processing" | "completed" | "failed"
  total_pairs: number
  flagged_pairs: number
  threshold: number
  created_at: string
  completed_at: string | null
  tenant_id: string
  pairs: PlagiarismPair[]
}

export interface PlagiarismSummary {
  id: string
  exam_id: string
  status: string
  total_pairs: number
  flagged_pairs: number
  threshold: number
  created_at: string
  completed_at: string | null
}

export const plagiarismApi = {
  triggerScan: (examId: string, threshold = 0.8) =>
    api
      .post<PlagiarismReport>(`/exams/${examId}/plagiarism`, { threshold })
      .then((r) => r.data),

  listReports: (examId: string) =>
    api
      .get<PlagiarismSummary[]>(`/exams/${examId}/plagiarism`)
      .then((r) => r.data),

  getReport: (reportId: string) =>
    api
      .get<PlagiarismReport>(`/exams/plagiarism/${reportId}`)
      .then((r) => r.data),
}
