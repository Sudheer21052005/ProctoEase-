import api from "./axios"

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface ProctoringEvent {
  id: string
  attempt_id: string
  event_type: string
  detail: Record<string, unknown> | null
  snapshot_path: string | null
  snapshot_url: string | null
  severity: number
  is_active: boolean
  created_at: string
  tenant_id: string
}

export interface ViolationCount {
  attempt_id: string
  total: number
  by_type: Record<string, number>
}

export interface ViolationGuideline {
  severity: "low" | "medium" | "high" | "critical"
  description: string
  impact: string
  recommended_action: string
}

export const proctoringApi = {
  listAttemptEvents: (attemptId: string) =>
    api.get<ProctoringEvent[]>(`/attempts/${attemptId}/events`).then((r) => r.data),

  listAttemptEventsPaged: (attemptId: string, page = 1, pageSize = 100) =>
    api
      .get<PaginatedResponse<ProctoringEvent>>(`/attempts/${attemptId}/events/paged`, {
        params: { page, page_size: pageSize },
      })
      .then((r) => r.data),

  getAttemptViolationCount: (attemptId: string) =>
    api
      .get<ViolationCount>(`/attempts/${attemptId}/events/count`)
      .then((r) => r.data),

  getViolationGuidelines: () =>
    api
      .get<Record<string, ViolationGuideline>>("/proctoring/violation-guidelines")
      .then((r) => r.data),
}
