/**
 * Canonical frontend violation catalog — single source of truth.
 *
 * This MUST stay in sync with the backend catalog in
 * `app/config/violation_guidelines.py`:
 *   BASE_VIOLATIONS + DERIVED_VIOLATIONS = CANONICAL_VIOLATION_TYPES
 *
 * The backend rejects any event_type outside that catalog
 * (`proctoring_service.normalize_event_type` raises BadRequest), so any type
 * added here without a matching backend entry will fail at runtime.
 *
 * Both `stores/proctoring.store.ts` and `hooks/useProctoring.ts` consume the
 * types below. Do not redeclare this union anywhere else.
 */

/** Mirrors backend BASE_VIOLATIONS (app/config/violation_guidelines.py). */
export const BASE_VIOLATION_TYPES = [
  "tab_switch",
  "fullscreen_exit",
  "keyboard_block",
  "copy_paste",
  "right_click",
  "browser_devtools",
  "inactivity",
  "multiple_faces",
  "no_face",
  "audio_anomaly",
  "custom",
] as const

/** Mirrors backend DERIVED_VIOLATIONS (app/config/violation_guidelines.py). */
export const DERIVED_VIOLATION_TYPES = [
  "rapid_tab_switching",
  "suspicious_activity_burst",
  "bulk_paste_detected",
  "impossible_answer_speed",
  "face_inconsistency",
  "periodic_check",
  "gaze_away",
  "head_turned",
  "phone_detected",
  "unauthorized_object",
] as const

export const CANONICAL_VIOLATION_TYPES = [
  ...BASE_VIOLATION_TYPES,
  ...DERIVED_VIOLATION_TYPES,
] as const

export type CanonicalViolationType = (typeof CANONICAL_VIOLATION_TYPES)[number]

/**
 * Benign/observational event types. These are still recorded in the event
 * history and still feed the risk engine (periodic_check carries weight 0.05),
 * but they must NOT consume the exam-termination budget.
 *
 * Mirrors backend NON_GATING_VIOLATIONS.
 */
export const NON_GATING_VIOLATION_TYPES: ReadonlySet<CanonicalViolationType> =
  new Set<CanonicalViolationType>(["periodic_check"])

/** True when a violation type counts toward the MAX_VIOLATIONS termination gate. */
export function countsTowardGate(type: CanonicalViolationType): boolean {
  return !NON_GATING_VIOLATION_TYPES.has(type)
}
