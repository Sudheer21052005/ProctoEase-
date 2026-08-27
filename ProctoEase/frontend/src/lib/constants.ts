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

/**
 * Re-exported for backwards compatibility. The value now lives in
 * `lib/proctoring.config.ts` alongside every other proctoring tunable —
 * change it there, not here.
 */
export { MAX_VIOLATIONS } from "@/lib/proctoring.config"
