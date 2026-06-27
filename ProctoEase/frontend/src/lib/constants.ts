export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1"

export const ROLES = {
  ADMIN: "admin",
  RECRUITER: "recruiter",
  CANDIDATE: "candidate",
} as const

export const ATTEMPT_STATUSES = {
  STARTED: "started",
  SUBMITTED: "submitted",
  EVALUATED: "evaluated",
} as const

export const MAX_VIOLATIONS = 12
