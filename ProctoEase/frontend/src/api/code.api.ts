import api from "./axios"

/* ── Code submission types ── */
export interface CodeSubmitRequest {
  source_code: string
  language_id: number
  stdin?: string | null
  question_id?: string
}

export type CodeSubmissionStatus =
  | "queued"
  | "processing"
  | "accepted"
  | "wrong_answer"
  | "runtime_error"
  | "time_limit_exceeded"
  | "memory_limit_exceeded"
  | "compilation_error"

export interface CodeSubmission {
  id: string
  attempt_id: string
  question_id: string | null
  language_id: number
  language_name: string
  source_code: string
  stdin: string | null
  status: CodeSubmissionStatus
  stdout: string | null
  stderr: string | null
  compile_output: string | null
  exit_code: number | null
  time_sec: number | null
  memory_kb: number | null
  created_at: string
  tenant_id: string
}

export interface Language {
  id: number
  name: string
}

export const NON_TERMINAL_STATUSES: CodeSubmissionStatus[] = [
  "queued",
  "processing",
]

export function isTerminalCodeStatus(status: CodeSubmissionStatus): boolean {
  return !NON_TERMINAL_STATUSES.includes(status)
}

export const codeApi = {
  submit: (attemptId: string, data: CodeSubmitRequest) =>
    api
      .post<CodeSubmission>(`/attempts/${attemptId}/code`, data)
      .then((r) => r.data),

  getResult: (submissionId: string) =>
    api.get<CodeSubmission>(`/code/${submissionId}`).then((r) => r.data),

  listSubmissions: (attemptId: string) =>
    api
      .get<CodeSubmission[]>(`/attempts/${attemptId}/code`)
      .then((r) => r.data),

  listLanguages: () =>
    api.get<Language[]>("/code/languages").then((r) => r.data),
}
