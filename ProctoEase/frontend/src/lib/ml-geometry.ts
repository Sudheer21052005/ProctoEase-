/**
 * Pure geometry and temporal helpers for head pose and object classification.
 * No DOM, no ML imports — safe for Vitest "node" environment.
 *
 * NAMING HONESTY: the `gaze_away` detector estimates HEAD PITCH from facial
 * landmarks (1 nose tip, 10 forehead centre, 152 chin, 33/263 outer eye
 * corners). It is NOT eye tracking — MediaPipe's iris landmarks (468-477)
 * are neither requested nor used. The public violation type keeps its
 * historical name because it is mirrored in the backend catalog.
 *
 * Metric design notes (measured against a real Chrome session, 28 Aug 2026):
 *  - Yaw is well-conditioned: as the head turns, the nose offset from the
 *    eye midpoint grows while the interocular span foreshortens, so the
 *    ratio grows super-linearly. Resting |yawRatio| <= 0.131; weakest
 *    deliberate turn measured 0.322.
 *  - The old pitch metric (fractional nose position between forehead and
 *    chin) is kept as a DIAGNOSTIC ONLY: its numerator and denominator
 *    foreshorten together, bounding the range to ~+/-0.1, and measured
 *    resting drift overlapped the genuine-signal range, so no threshold
 *    can separate the classes.
 *  - The decision metric is vertical foreshortening: projected faceHeight
 *    shrinks ~cos(pitch) while interocular is pitch-invariant, so the
 *    relative deviation of their ratio from a per-session calibrated
 *    baseline has real dynamic range. The ratio IS confounded by yaw, so
 *    pitch is only evaluated while the head is roughly frontal
 *    (GAZE_PITCH_MAX_YAW).
 */

import {
  HEAD_YAW_RATIO_THRESHOLD,
  GAZE_FH_DEVIATION_THRESHOLD,
  GAZE_PITCH_MAX_YAW,
  GAZE_CALIBRATION_MIN_SAMPLES,
  OBJECT_CONFIDENCE_THRESHOLD,
  PHONE_CLASSES,
  UNAUTHORIZED_CLASSES,
} from "@/lib/proctoring.config"

/** Minimal landmark shape used by the geometry helpers. */
export interface Landmark {
  x: number
  y: number
  z?: number
}

/** COCO-SSD prediction shape (subset). */
export interface Prediction {
  class: string
  score: number
  bbox?: [number, number, number, number]
}

/** Result of face orientation evaluation. */
export interface FaceOrientationResult {
  valid: boolean
  /** Signed nose-offset / interocular ratio. Positive = nose right of the eye midpoint. */
  yawRatio: number
  /** faceHeight / interocular — the vertical-foreshortening pitch metric. */
  fhRatio: number
  /** (fhRatio - fhBaseline) / fhBaseline; 0 when uncalibrated. */
  fhDeviation: number
  /**
   * DIAGNOSTIC ONLY — fractional nose position between forehead and chin.
   * Wired to NO decision (see module header). Kept because it is needed to
   * interpret calibration behaviour in Chrome sessions.
   */
  pitchRatio: number
  /** Raw interocular span (logged for debugging). */
  interocular: number
  /** Raw projected face height (logged for debugging). */
  faceHeight: number
  /** True only when a valid per-session fhBaseline was supplied. */
  calibrated: boolean
  headTurned: boolean
  gazeAway: boolean
}

/** Result of object classification. */
export interface ObjectClassificationResult {
  phoneDetected: boolean
  unauthorizedObjectDetected: boolean
  detectedObjects: string[]
}

/** Shared invalid result — always returned as a fresh copy. */
function invalidOrientation(): FaceOrientationResult {
  return {
    valid: false,
    yawRatio: 0,
    fhRatio: 0,
    fhDeviation: 0,
    pitchRatio: 0,
    interocular: 0,
    faceHeight: 0,
    calibrated: false,
    headTurned: false,
    gazeAway: false,
  }
}

/** Inter-ocular distance helper. */
function interocularDistance(landmarks: Landmark[]): number {
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]
  if (!leftEye || !rightEye) return 0
  return Math.abs(rightEye.x - leftEye.x)
}

/** Face height helper (chin - forehead). */
function faceHeight(landmarks: Landmark[]): number {
  const forehead = landmarks[10]
  const chin = landmarks[152]
  if (!forehead || !chin) return 0
  return Math.abs(chin.y - forehead.y)
}

/** |yawRatio| gate for head_turned, applied to raw or smoothed ratios. */
export function isHeadTurned(yawRatio: number): boolean {
  return Math.abs(yawRatio) > HEAD_YAW_RATIO_THRESHOLD
}

/**
 * head-pitch (gaze_away) decision on raw or smoothed per-frame values.
 * Fires only when calibrated and only while the head is roughly frontal —
 * the foreshortening ratio is confounded by yaw.
 */
export function isGazeAway(calibrated: boolean, yawRatio: number, fhDeviation: number): boolean {
  if (!calibrated) return false
  if (Math.abs(yawRatio) >= GAZE_PITCH_MAX_YAW) return false
  return Math.abs(fhDeviation) > GAZE_FH_DEVIATION_THRESHOLD
}

/** Relative deviation of fhRatio from a calibrated baseline (pure). */
export function computeFhDeviation(fhRatio: number, fhBaseline: number | null): number {
  if (fhBaseline === null || !Number.isFinite(fhBaseline) || fhBaseline <= 0) return 0
  return (fhRatio - fhBaseline) / fhBaseline
}

/**
 * Evaluate face orientation from MediaPipe landmarks.
 *
 * @param landmarks MediaPipe normalized landmarks (x, y in 0..1 relative to
 *        the image).
 * @param fhBaseline Optional per-session calibrated fhRatio baseline. When
 *        absent/null, pitch is DISARMED (calibrated=false, fhDeviation=0,
 *        gazeAway=false) regardless of the face's actual pose.
 */
export function evaluateFaceOrientation(
  landmarks: Landmark[],
  fhBaseline?: number | null
): FaceOrientationResult {
  // Required indices: 1 (nose tip), 10 (forehead), 33 (left eye), 152 (chin), 263 (right eye)
  const requiredIdx = [1, 10, 33, 152, 263]
  for (const idx of requiredIdx) {
    if (!landmarks[idx]) {
      return invalidOrientation()
    }
  }

  const interocular = interocularDistance(landmarks)
  const fh = faceHeight(landmarks)
  // The !(x > 0) forms also catch NaN inputs, so no ratio below can produce
  // NaN or Infinity.
  if (!Number.isFinite(interocular) || !Number.isFinite(fh) || interocular <= 0 || fh <= 0) {
    return invalidOrientation()
  }

  const leftEye = landmarks[33]!
  const rightEye = landmarks[263]!

  // Yaw: ratio of the nose-tip offset from the eye midpoint to the
  // interocular span (which foreshortens as the head turns — the
  // amplification that makes this metric well-conditioned).
  const eyeMidX = (leftEye.x + rightEye.x) / 2
  const yawRatio = (landmarks[1]!.x - eyeMidX) / interocular

  // Pitch: vertical foreshortening relative to the calibrated baseline.
  // `calibrated` is a property of the supplied baseline, not of the pose —
  // a face sitting exactly at baseline has fhDeviation 0 and is still
  // calibrated.
  const fhRatio = fh / interocular
  const baseline: number | null =
    typeof fhBaseline === "number" && Number.isFinite(fhBaseline) && fhBaseline > 0
      ? fhBaseline
      : null
  const calibrated = baseline !== null
  const fhDeviation = computeFhDeviation(fhRatio, baseline)

  // Diagnostic only — fractional nose position between forehead and chin.
  // Wired to NO decision.
  const faceMidY = (landmarks[10].y + landmarks[152].y) / 2
  const pitchRatio = (landmarks[1].y - faceMidY) / fh

  return {
    valid: true,
    yawRatio,
    fhRatio,
    fhDeviation,
    pitchRatio,
    interocular,
    faceHeight: fh,
    calibrated,
    headTurned: isHeadTurned(yawRatio),
    gazeAway: isGazeAway(calibrated, yawRatio, fhDeviation),
  }
}

/**
 * Sane range for a calibrated fhRatio baseline (faceHeight / interocular).
 * A frontal human face projects a vertical span between 1x and 5x its
 * outer-eye-corner span; outside that range the "face" is a tracking
 * artifact and must not centre the pitch detector.
 */
export const FH_BASELINE_CLAMP = { min: 1.0, max: 5.0 } as const

/**
 * Sane range for a pitchRatio baseline (diagnostic only): the fractional
 * nose position between forehead and chin is bounded to +/-0.5 by
 * construction.
 */
export const PITCH_BASELINE_CLAMP = { min: -0.5, max: 0.5 } as const

/**
 * Robust per-session baseline: MEDIAN of the calibration samples, clamped
 * to the given sane range. A momentary look-away during calibration shifts
 * the median by one sample's worth instead of dragging a mean.
 *
 * Returns NaN when fewer than GAZE_CALIBRATION_MIN_SAMPLES finite samples
 * were collected — callers must treat NaN as "not calibrated" and keep the
 * detector disarmed.
 */
export function computeBaseline(
  samples: number[],
  clamp?: { min: number; max: number }
): number {
  const finite = samples.filter((s) => Number.isFinite(s))
  if (finite.length < GAZE_CALIBRATION_MIN_SAMPLES) return Number.NaN
  const sorted = [...finite].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2
  if (!Number.isFinite(median)) return Number.NaN
  if (clamp) return Math.min(clamp.max, Math.max(clamp.min, median))
  return median
}

/**
 * Median of a (short) smoothing buffer. A window of 3 kills isolated
 * single-frame spikes at their source while passing sustained steps through
 * unchanged. Even-length buffers return the mean of the two middle values
 * (pre-fill behaviour). Empty buffer -> NaN.
 */
export function medianOf3(buf: number[]): number {
  if (buf.length === 0) return Number.NaN
  const sorted = [...buf].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure sustain reducer — the temporal core shared by head_turned/gaze_away
// ─────────────────────────────────────────────────────────────────────────────

export interface SustainState {
  /** When the above-threshold condition armed (ms epoch); null = disarmed. */
  startMs: number | null
  /** Consecutive above-threshold frames. Reset by any below-threshold frame. */
  aboveRun: number
  /** Consecutive below-threshold frames. Reset by any above-threshold frame. */
  belowRun: number
}

export interface SustainConfig {
  /** Sustained above-threshold time required before firing, in ms. */
  graceMs: number
  /** Consecutive above-threshold frames required to arm the timer. */
  armFrames: number
  /** Consecutive below-threshold frames tolerated before the timer clears. */
  toleranceFrames: number
}

export function initialSustainState(): SustainState {
  return { startMs: null, aboveRun: 0, belowRun: 0 }
}

/**
 * Feed one frame's above/below decision in; get the next state plus whether
 * the detector FIRES on this frame.
 *
 * Semantics:
 *  - aboveRun/belowRun count CONSECUTIVE frames (each above frame resets
 *    belowRun and vice versa), so scattered single spikes never accumulate.
 *  - The timer arms only after `armFrames` consecutive above frames; a
 *    single above frame cannot arm it.
 *  - An armed timer survives up to `toleranceFrames` consecutive below
 *    frames; the next below frame after that clears it and resets both runs.
 *  - fired is true on the single frame where nowMs - startMs >= graceMs.
 *    The timer then RE-ARMS FROM THE FIRING TIMESTAMP: a repeat violation
 *    requires the condition to stay (or return and stay) above for another
 *    full graceMs. This is deliberate and replaces the old undocumented
 *    `start = now + grace` future-timestamp re-arm; the outer snapshot
 *    throttle remains the real cooldown between emissions.
 */
export function updateSustainState(
  prev: SustainState,
  isAbove: boolean,
  nowMs: number,
  cfg: SustainConfig
): { state: SustainState; fired: boolean; durationMs: number } {
  if (isAbove) {
    const aboveRun = prev.aboveRun + 1
    let startMs = prev.startMs
    if (startMs === null && aboveRun >= cfg.armFrames) {
      startMs = nowMs
    }
    if (startMs !== null && nowMs - startMs >= cfg.graceMs) {
      return {
        state: { startMs: nowMs, aboveRun, belowRun: 0 },
        fired: true,
        durationMs: nowMs - startMs,
      }
    }
    return { state: { startMs, aboveRun, belowRun: 0 }, fired: false, durationMs: 0 }
  }

  const belowRun = prev.belowRun + 1
  if (belowRun > cfg.toleranceFrames) {
    return { state: initialSustainState(), fired: false, durationMs: 0 }
  }
  return { state: { startMs: prev.startMs, aboveRun: 0, belowRun }, fired: false, durationMs: 0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// Object detection helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Consecutive-tick counters for the object detectors. */
export interface ObjectTickState {
  phoneTicks: number
  unauthorizedTicks: number
}

export function initialObjectTickState(): ObjectTickState {
  return { phoneTicks: 0, unauthorizedTicks: 0 }
}

/**
 * Consecutive-tick gate for object events, with the precedence rule encoded:
 * unauthorized_object is suppressed while a phone is detected (one physical
 * cause -> one event), so unauthorized ticks only accumulate on phone-free
 * positive ticks.
 *
 * emitPhone/emitUnauthorized are LEVEL signals (true on every tick at or
 * past the gate); the caller's snapshot throttle is the emission cooldown.
 */
export function updateObjectTicks(
  prev: ObjectTickState,
  detection: { phoneDetected: boolean; unauthorizedObjectDetected: boolean },
  consecutiveTicks: number
): { state: ObjectTickState; emitPhone: boolean; emitUnauthorized: boolean } {
  const phoneTicks = detection.phoneDetected ? prev.phoneTicks + 1 : 0
  const unauthorizedActive = detection.unauthorizedObjectDetected && !detection.phoneDetected
  const unauthorizedTicks = unauthorizedActive ? prev.unauthorizedTicks + 1 : 0
  return {
    state: { phoneTicks, unauthorizedTicks },
    emitPhone: detection.phoneDetected && phoneTicks >= consecutiveTicks,
    emitUnauthorized: unauthorizedActive && unauthorizedTicks >= consecutiveTicks,
  }
}

/**
 * Classify COCO-SSD predictions into phone / unauthorized / other.
 * Precedence: phoneDetected takes priority over unauthorizedObjectDetected.
 */
export function classifyObjectPredictions(predictions: Array<{ class: string; score: number }>): {
  phoneDetected: boolean
  unauthorizedObjectDetected: boolean
  detectedObjects: string[]
} {
  const detectedObjects = predictions
    .filter((p) => p.score > OBJECT_CONFIDENCE_THRESHOLD)
    .map((p) => p.class.toLowerCase())

  const phoneDetected = detectedObjects.some((obj) =>
    PHONE_CLASSES.some((c) => obj.includes(c))
  )

  const unauthorizedObjectDetected = detectedObjects.some((obj) =>
    UNAUTHORIZED_CLASSES.some((c) => obj.includes(c))
  )

  return { phoneDetected, unauthorizedObjectDetected, detectedObjects }
}
