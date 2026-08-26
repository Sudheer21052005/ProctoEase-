import api from "./axios"

export interface QuestionOption {
  label: string
  text: string
}

/**
 * A public ("sample") test case for a code question.
 * Backend shape — app/api/v1/questions.py builds these as
 * {"input": tc["input"], "expected": tc["expected"]} for test cases flagged
 * is_public, and exposes them via QuestionReadCandidate.public_test_cases.
 * Hidden cases are never sent to the candidate.
 */
export interface PublicTestCase {
  input: string
  expected: unknown
}

/* ── Question types aligned with backend QuestionRead / QuestionReadCandidate ── */
export interface BackendQuestion {
  id: string
  exam_id: string
  question_text: string
  question_type: "mcq" | "multi_select" | "true_false" | "code"
  options: QuestionOption[] | null
  points: number
  order_index: number
  correct_answer?: unknown
  is_active?: boolean
  tenant_id?: string
  created_at?: string
  /** Candidate view only (code questions). Absent for recruiter/admin responses. */
  public_test_cases?: PublicTestCase[] | null
}

export interface QuestionCreateRequest {
  question_text: string
  question_type: BackendQuestion["question_type"]
  options?: QuestionOption[] | null
  correct_answer?: unknown
  points: number
  order_index: number
}

export const questionApi = {
  listForExam: (examId: string) =>
    api.get<BackendQuestion[]>(`/exams/${examId}/questions`).then((r) => r.data),

  createForExam: (examId: string, data: QuestionCreateRequest) =>
    api.post<BackendQuestion>(`/exams/${examId}/questions`, data).then((r) => r.data),

  deleteById: (questionId: string) =>
    api.delete(`/questions/${questionId}`).then((r) => r.data),
}
