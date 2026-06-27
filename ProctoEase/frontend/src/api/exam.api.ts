import api from "./axios"
import type { Exam, ExamCreateRequest } from "@/types"

export type ExamIngestionMode = "manual" | "pdf" | "json"

export interface IngestionQuestionPreview {
  question_text: string
  question_type: string
  points: number
  options_count: number
}

export interface ExamIngestionPreview {
  title: string
  description: string | null
  duration_minutes: number
  is_published: boolean
  question_count: number
  questions: IngestionQuestionPreview[]
}

export interface ExamIngestionResponse {
  created: boolean
  mode: ExamIngestionMode
  exam: Exam | null
  preview: ExamIngestionPreview
}

export interface ExamIngestionJsonRequest {
  mode: ExamIngestionMode
  payload: Record<string, unknown>
  preview_only?: boolean
}

export interface ExamUpdateRequest {
  title?: string
  description?: string | null
  duration_minutes?: number
  is_published?: boolean
}

export const examApi = {
  create: (data: ExamCreateRequest) =>
    api.post<Exam>("/exams/", data).then((r) => r.data),

  createViaIngestionJson: (data: ExamIngestionJsonRequest) =>
    api.post<ExamIngestionResponse>("/exams/create", data).then((r) => r.data),

  createViaIngestionForm: (data: FormData) =>
    api
      .post<ExamIngestionResponse>("/exams/create", data)
      .then((r) => r.data),

  list: () => api.get<Exam[]>("/exams/").then((r) => r.data),

  getById: (id: string) =>
    api.get<Exam>(`/exams/${id}`).then((r) => r.data),

  update: (id: string, data: ExamUpdateRequest) =>
    api.patch<Exam>(`/exams/${id}`, data).then((r) => r.data),
}
