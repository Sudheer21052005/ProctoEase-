import api from "./axios"
import type { ExamAttempt } from "@/types"

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

/* ── Answer types ── */
export interface AnswerSubmit {
  question_id: string
  selected_option_ids?: string[] | null
  text_answer?: string | null
  language_id?: number | null
}

export interface AnswerRead {
  question_id: string
  selected_option_ids?: string[] | null
  text_answer?: string | null
  language_id?: number | null
  is_correct?: boolean | null
  points_earned?: number | null
  cases_passed?: number | null
  total_cases?: number | null
}

export interface AnswersResponse {
  attempt_id: string
  answers: AnswerRead[]
  total_score?: number | null
  max_score?: number | null
}

export interface AttemptCreatePayload {
  verification_image_base64?: string
}

export const attemptApi = {
  create: (examId: string, payload?: AttemptCreatePayload) =>
    api.post<ExamAttempt>(`/exams/${examId}/attempts`, payload || {}).then((r) => r.data),

  listMine: () =>
    api.get<ExamAttempt[]>("/attempts/me").then((r) => r.data),

  listExamAttempts: (examId: string) =>
    api.get<ExamAttempt[]>(`/exams/${examId}/attempts`).then((r) => r.data),

  listExamAttemptsPaged: (examId: string, page = 1, pageSize = 20) =>
    api
      .get<PaginatedResponse<ExamAttempt>>(`/exams/${examId}/attempts/paged`, {
        params: { page, page_size: pageSize },
      })
      .then((r) => r.data),

  submit: (attemptId: string) =>
    api.patch<ExamAttempt>(`/attempts/${attemptId}/submit`).then((r) => r.data),

  saveAnswers: (attemptId: string, answers: AnswerSubmit[]) =>
    api
      .post(`/attempts/${attemptId}/answers`, { answers })
      .then((r) => r.data),

  getAnswers: (attemptId: string) =>
    api
      .get<AnswersResponse>(`/attempts/${attemptId}/answers`)
      .then((r) => r.data),
}
