import api from "./axios"

export interface RiskWeightsUpdate {
  tab_switch?: number
  fullscreen_exit?: number
  keyboard_block?: number
  copy_paste?: number
  right_click?: number
  inactivity?: number
  no_face?: number
  multiple_faces?: number
  audio_anomaly?: number
  browser_devtools?: number
  custom?: number
  rapid_tab_switching?: number
  suspicious_activity_burst?: number
  bulk_paste_detected?: number
  impossible_answer_speed?: number
  face_inconsistency?: number
  periodic_check?: number
}

export interface RiskScore {
  id: string
  attempt_id: string
  tenant_id: string
  overall_score: number
  risk_level: string
  breakdown: Record<string, unknown> | null
  event_counts: Record<string, number> | null
  total_events: number
  computed_at: string
}

export interface RiskSummary {
  attempt_id: string
  overall_score: number
  risk_level: string
  total_events: number
  computed_at: string
}

export const riskApi = {
  computeAttemptRisk: (attemptId: string, weights?: RiskWeightsUpdate) =>
    api.post<RiskScore>(`/attempts/${attemptId}/risk`, weights ?? {}).then((r) => r.data),

  getAttemptRisk: (attemptId: string) =>
    api.get<RiskScore | null>(`/attempts/${attemptId}/risk`).then((r) => r.data),

  listExamRiskScores: (examId: string) =>
    api.get<RiskSummary[]>(`/exams/${examId}/risk-scores`).then((r) => r.data),
}
