/**
 * Sustained voice / audio activity detection (Web Audio API).
 *
 * WHAT THIS IS: a browser-side voice/audio ACTIVITY heuristic. It measures how
 * loud the microphone is relative to the room's own measured noise floor and
 * raises `audio_anomaly` when that energy stays elevated for long enough to
 * look like someone talking.
 *
 * WHAT THIS IS NOT: speech recognition. There is no speech-to-text, no
 * transcription, no keyword spotting, no acoustic model, no recording, and no
 * audio leaves the browser. The detector cannot tell you WHAT was said, or
 * distinguish a voice from any other sustained sound of similar loudness — a
 * television, a fan ramping up or a long stretch of typing can trigger it.
 *
 * ── Detection model: adaptive energy VAD ────────────────────────────────────
 *
 *   microphone → frames → RMS → noise-floor calibration → adaptive thresholds
 *   → activity state machine (hysteresis) → minimum duration → pause tolerance
 *   → cooldown → anomaly
 *
 *   1. CALIBRATE. For the first `calibrationMs`, collect per-frame RMS and take
 *      a percentile (median) as the room's noise floor. Detection is disarmed
 *      until this completes.
 *   2. ADAPT. enter = max(minEnterRms, floor × enterMultiplier);
 *      exit  = max(minExitRms,  floor × exitMultiplier).
 *      The absolute minimums stop a very quiet room from producing a
 *      hair-trigger threshold. The floor is re-estimated from a trailing window
 *      of frames seen while NOT in a segment, so a fan starting mid-exam raises
 *      the bar, while sustained talking cannot inflate the floor and blind the
 *      detector.
 *   3. STATE. idle → candidate (rms > enter) → speaking (voiced ≥ minActivityMs)
 *      Separate enter/exit thresholds give hysteresis: once speaking, the level
 *      only has to stay above the LOWER bar to keep the segment alive.
 *   4. MINIMUM DURATION. A segment must contain an UNBROKEN run of at least
 *      `minActivityMs` of above-exit audio before it counts as activity at all.
 *      A tap, click or single cough is too short. An impulse train — keyboard
 *      typing, repeated tapping — accumulates plenty of total energy but never
 *      produces a continuous run, so it is discarded too. Requiring a run
 *      rather than a duty-cycle RATIO is deliberate; see below.
 *   5. PAUSE TOLERANCE. A quiet run shorter than `pauseToleranceMs` does not
 *      end the segment, so "hello … [pause] … I am answering" is ONE segment.
 *   6. FIRE when voiced time in the segment reaches `sustainedMs`, then hold
 *      for `cooldownMs`.
 *
 * ── Why this replaced the previous detector ─────────────────────────────────
 *
 * The old model was a duty cycle: fire when ≥60% of a 12-sample window exceeded
 * a FIXED RMS of 0.08. A captured Chrome session showed why that misses real
 * speech: Chrome's noise suppression and the headset's own gate drop the level
 * to the noise floor between words, so continuous talking produced 6–7 loud
 * samples out of 12 — and with 12 samples, 60% quantises to "at least 8", so
 * 7/12 = 0.583 failed. Every anomaly that did fire landed on exactly 8/12.
 * Meanwhile real quiet speech measured 0.040–0.079, i.e. just under the fixed
 * 0.08 bar, against a noise floor of ~0.0055 — a 10× gap the fixed threshold
 * cut straight through.
 *
 * This is why the new model has NO duty-cycle ratio anywhere in its decision
 * path. Gated Bluetooth speech genuinely does drop to the noise floor between
 * words, so ANY "fraction of the window must be loud" rule rejects it. Short
 * noises are rejected by requiring a contiguous run instead, which speech
 * satisfies and impulse trains do not.
 *
 * ── Design references (principles only; no code was copied) ─────────────────
 *
 *   - rhasspy/rhasspy-silence, "energy VAD": derive the decision threshold from
 *     audio observed at start-up rather than hard-coding a level.
 *   - ricky0123/vad: separate positive/negative speech thresholds, a minimum
 *     number of speech frames, and a "redemption" period that lets a short dip
 *     be absorbed instead of ending the utterance.
 *   - linto-ai/WebVoiceSDK: noise-relative rather than absolute decisions, so
 *     the detector survives a low signal-to-noise input.
 *   - Classic percentile / minimum-statistics noise-floor estimation: estimate
 *     the floor from non-speech frames using a robust statistic.
 *
 * The decision logic (`createAudioAnomalyEvaluator`) is pure and clock-injected
 * so it is unit-testable without a browser; `startAudioMonitor` is the thin
 * Web Audio wiring around it.
 */

import {
  AUDIO_CALIBRATION_MS,
  AUDIO_COOLDOWN_MS,
  AUDIO_ENTER_MULTIPLIER,
  AUDIO_EXIT_MULTIPLIER,
  AUDIO_FFT_SIZE,
  AUDIO_FRAME_MS,
  AUDIO_MAX_NOISE_FLOOR,
  AUDIO_MIN_ACTIVITY_MS,
  AUDIO_MIN_ENTER_RMS,
  AUDIO_MIN_EXIT_RMS,
  AUDIO_MIN_NOISE_FLOOR,
  AUDIO_NOISE_PERCENTILE,
  AUDIO_NOISE_WINDOW_MS,
  AUDIO_PAUSE_TOLERANCE_MS,
  AUDIO_SMOOTHING_TIME_CONSTANT,
  AUDIO_SUSTAINED_MS,
  ENABLE_AUDIO_DEBUG,
} from "@/lib/proctoring.config"

// ─────────────────────────────────────────────────────────────────────────────
// Debug instrumentation (see ENABLE_AUDIO_DEBUG — ships off)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Console output for audio diagnosis, off unless ENABLE_AUDIO_DEBUG is set.
 *
 * Only derived numbers and browser-reported device metadata pass through here.
 * The analyser buffer itself is never logged, stored or sent anywhere — it is
 * reduced to a single RMS float by `computeRms`/`computeRmsFloat` before any of
 * this runs.
 */
function audioDebugLog(message: string) {
  if (!ENABLE_AUDIO_DEBUG) return
  console.log(message)
}

/** Fixed-width numeric formatting so the frame log stays scannable. */
function fmt(value: number, places = 4): string {
  return Number.isFinite(value) ? value.toFixed(places) : "NaN"
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure evaluator
// ─────────────────────────────────────────────────────────────────────────────

export interface AudioEvaluatorConfig {
  /** Gap between frames in ms; every duration below is counted in whole frames. */
  frameMs: number
  /** Quiet period at start-up used to measure the noise floor. */
  calibrationMs: number
  /** Percentile of quiet frames taken as the noise floor (0.5 = median). */
  noisePercentile: number
  /** Trailing span of non-segment frames kept for floor re-estimation. */
  noiseWindowMs: number
  /** Lower clamp on the measured noise floor. */
  minNoiseFloor: number
  /** Upper clamp on the measured noise floor. */
  maxNoiseFloor: number
  /** Noise-floor multiple at which activity STARTS. */
  enterMultiplier: number
  /** Noise-floor multiple below which activity STOPS (< enterMultiplier). */
  exitMultiplier: number
  /** Absolute floor under the adaptive ENTER threshold. */
  minEnterRms: number
  /** Absolute floor under the adaptive EXIT threshold. */
  minExitRms: number
  /** Voiced time before a segment counts as activity (rejects taps/coughs). */
  minActivityMs: number
  /** Voiced time in one segment that fires an anomaly. */
  sustainedMs: number
  /** Quiet run tolerated inside a segment before it closes. */
  pauseToleranceMs: number
  /**
   * Minimum gap between two fired anomalies, in ms. This rate-limits EVENTS,
   * not audio: an open segment keeps accumulating voiced time while the
   * cooldown holds, so the next event reports the whole accumulated duration
   * rather than restarting from zero.
   */
  cooldownMs: number
}

export const DEFAULT_AUDIO_EVALUATOR_CONFIG: AudioEvaluatorConfig = {
  frameMs: AUDIO_FRAME_MS,
  calibrationMs: AUDIO_CALIBRATION_MS,
  noisePercentile: AUDIO_NOISE_PERCENTILE,
  noiseWindowMs: AUDIO_NOISE_WINDOW_MS,
  minNoiseFloor: AUDIO_MIN_NOISE_FLOOR,
  maxNoiseFloor: AUDIO_MAX_NOISE_FLOOR,
  enterMultiplier: AUDIO_ENTER_MULTIPLIER,
  exitMultiplier: AUDIO_EXIT_MULTIPLIER,
  minEnterRms: AUDIO_MIN_ENTER_RMS,
  minExitRms: AUDIO_MIN_EXIT_RMS,
  minActivityMs: AUDIO_MIN_ACTIVITY_MS,
  sustainedMs: AUDIO_SUSTAINED_MS,
  pauseToleranceMs: AUDIO_PAUSE_TOLERANCE_MS,
  cooldownMs: AUDIO_COOLDOWN_MS,
}

/** Where the activity state machine currently sits. */
export type VoiceActivityState =
  /** Still measuring the noise floor; detection disarmed. */
  | "calibrating"
  /** Below the enter threshold. Frames here feed the noise-floor estimate. */
  | "idle"
  /** Above enter, but not yet past `minActivityMs` — could still be a transient. */
  | "candidate"
  /** Confirmed voice activity, accumulating toward `sustainedMs`. */
  | "speaking"

export type AudioAnomalyReason =
  /** Noise floor not measured yet. */
  | "calibrating"
  /** Quiet; no segment open. */
  | "idle"
  /** Segment open but still under `minActivityMs`. */
  | "candidate"
  /** Confirmed activity, but voiced time has not reached `sustainedMs`. */
  | "not_sustained"
  /** The pause tolerance expired and the segment just closed. */
  | "segment_ended"
  /** Enough voiced time, but a previous event is still cooling down. */
  | "cooldown"

export interface AudioAnomalyDetails {
  /** Loudest normalised RMS seen in the segment. */
  peakLevel: number
  /** Mean normalised RMS across the segment's voiced frames. */
  averageLevel: number
  /** Voiced frames / total frames in the segment. */
  activityRatio: number
  /** Voiced time accumulated when the anomaly fired. */
  durationMs: number
  /** Wall-clock span of the segment, including tolerated pauses. */
  segmentMs: number
  /** ENTER threshold in force, echoed for the event detail payload. */
  threshold: number
  /** EXIT threshold in force. */
  exitThreshold: number
  /** Measured room noise floor the thresholds were derived from. */
  noiseFloor: number
}

/**
 * Observational snapshot after a `push`. Purely diagnostic — the decision logic
 * never reads these back, they exist so ENABLE_AUDIO_DEBUG can show why the
 * detector did or did not fire. Every field is a plain number or boolean; no
 * audio is retained.
 */
export interface AudioFrameMetrics {
  /** Normalised RMS of the frame just pushed, after the NaN/negative guard. */
  rms: number
  /** Activity state after this frame. */
  state: VoiceActivityState
  /** Whether the frame cleared the ENTER threshold. */
  aboveEnter: boolean
  /** Whether the frame cleared the (lower) EXIT threshold. */
  aboveExit: boolean
  /** Current measured noise floor. */
  noiseFloor: number
  /** Current adaptive ENTER threshold. */
  enterThreshold: number
  /** Current adaptive EXIT threshold. */
  exitThreshold: number
  /** Voiced time accumulated in the open segment. */
  voicedMs: number
  /** Current unbroken above-EXIT run; promotion to `speaking` needs minActivityMs. */
  runMs: number
  /** Length of the current tolerated pause. */
  pauseMs: number
  /** Wall-clock length of the open segment, pauses included. */
  segmentMs: number
  /** Voiced frames in the open segment. */
  voicedFrames: number
  /** Total frames in the open segment. */
  segmentFrames: number
  /** voicedFrames / segmentFrames, 0 when no segment is open. */
  activityRatio: number
  /** Frames collected so far toward calibration. */
  calibrationFrames: number
  /** Quiet frames currently backing the noise-floor estimate. */
  noiseSamples: number
}

/** Summary of a segment that has just closed. Diagnostic only. */
export interface ClosedSegment {
  voicedMs: number
  segmentMs: number
  voicedFrames: number
  segmentFrames: number
  peakLevel: number
  averageLevel: number
  /** Whether it ever reached `minActivityMs` (false = discarded transient). */
  qualified: boolean
}

export type AudioAnomalyDecision =
  | ({ fire: true; metrics: AudioFrameMetrics; closedSegment?: undefined } & AudioAnomalyDetails)
  | {
      fire: false
      reason: AudioAnomalyReason
      metrics: AudioFrameMetrics
      closedSegment?: ClosedSegment
    }

export interface AudioAnomalyEvaluator {
  /** Feed one frame's level; returns whether a violation should be raised. */
  push: (level: number, now: number) => AudioAnomalyDecision
  /** Drop all state: noise floor, open segment and cooldown. */
  reset: () => void
  /** Frames of calibration required before detection arms. */
  calibrationFrames: number
  /** Current floor/thresholds/state, for the start-up debug snapshot. */
  snapshot: () => {
    state: VoiceActivityState
    noiseFloor: number
    enterThreshold: number
    exitThreshold: number
  }
}

/**
 * Linear-interpolated percentile of an ASCENDING-sorted array.
 * `p` is a fraction: 0 = minimum, 0.5 = median, 1 = maximum.
 */
export function percentileOfSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const clamped = Math.min(1, Math.max(0, p))
  const idx = (sorted.length - 1) * clamped
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/**
 * Build a stateful-but-clock-injected evaluator. `now` is supplied by the
 * caller on every `push`, so tests drive time explicitly.
 */
export function createAudioAnomalyEvaluator(
  overrides: Partial<AudioEvaluatorConfig> = {}
): AudioAnomalyEvaluator {
  const config = { ...DEFAULT_AUDIO_EVALUATOR_CONFIG, ...overrides }

  const calibrationFrames = Math.max(1, Math.round(config.calibrationMs / config.frameMs))
  const noiseWindowFrames = Math.max(
    calibrationFrames,
    Math.round(config.noiseWindowMs / config.frameMs)
  )

  // Noise-floor estimation.
  let calibrationBuffer: number[] = []
  let noiseBuffer: number[] = []
  let noiseFloor = 0
  let calibrated = false

  // Activity state machine.
  let state: VoiceActivityState = "calibrating"
  let voicedMs = 0
  let runMs = 0
  let pauseMs = 0
  let segmentMs = 0
  let voicedFrames = 0
  let segmentFrames = 0
  let segmentPeak = 0
  let voicedSum = 0
  let qualified = false

  let lastFiredAt: number | null = null

  const clampFloor = (value: number) =>
    Math.min(config.maxNoiseFloor, Math.max(config.minNoiseFloor, value))

  const enterThreshold = () =>
    Math.max(config.minEnterRms, noiseFloor * config.enterMultiplier)
  const exitThreshold = () => Math.max(config.minExitRms, noiseFloor * config.exitMultiplier)

  /** Re-estimate the floor from the quiet-frame buffer using the percentile. */
  const recomputeNoiseFloor = () => {
    const sorted = [...noiseBuffer].sort((a, b) => a - b)
    noiseFloor = clampFloor(percentileOfSorted(sorted, config.noisePercentile))
  }

  /** Admit a non-segment frame to the trailing noise buffer. */
  const observeQuietFrame = (rms: number) => {
    noiseBuffer.push(rms)
    if (noiseBuffer.length > noiseWindowFrames) {
      noiseBuffer = noiseBuffer.slice(noiseBuffer.length - noiseWindowFrames)
    }
    recomputeNoiseFloor()
  }

  const clearSegment = () => {
    voicedMs = 0
    runMs = 0
    pauseMs = 0
    segmentMs = 0
    voicedFrames = 0
    segmentFrames = 0
    segmentPeak = 0
    voicedSum = 0
    qualified = false
  }

  const describeSegment = (): ClosedSegment => ({
    voicedMs,
    segmentMs,
    voicedFrames,
    segmentFrames,
    peakLevel: segmentPeak,
    averageLevel: voicedFrames > 0 ? voicedSum / voicedFrames : 0,
    qualified,
  })

  const buildMetrics = (rms: number, above: { enter: boolean; exit: boolean }): AudioFrameMetrics => ({
    rms,
    state,
    aboveEnter: above.enter,
    aboveExit: above.exit,
    noiseFloor,
    enterThreshold: enterThreshold(),
    exitThreshold: exitThreshold(),
    voicedMs,
    runMs,
    pauseMs,
    segmentMs,
    voicedFrames,
    segmentFrames,
    activityRatio: segmentFrames > 0 ? voicedFrames / segmentFrames : 0,
    calibrationFrames: calibrationBuffer.length,
    noiseSamples: noiseBuffer.length,
  })

  return {
    calibrationFrames,

    snapshot: () => ({
      state,
      noiseFloor,
      enterThreshold: enterThreshold(),
      exitThreshold: exitThreshold(),
    }),

    push(level: number, now: number): AudioAnomalyDecision {
      // Guard against NaN/negative levels from a stalled analyser.
      const rms = Number.isFinite(level) && level > 0 ? level : 0

      // ── Stage 1: calibration ────────────────────────────────────────────
      if (!calibrated) {
        calibrationBuffer.push(rms)
        if (calibrationBuffer.length >= calibrationFrames) {
          noiseBuffer = calibrationBuffer.slice(-noiseWindowFrames)
          recomputeNoiseFloor()
          calibrated = true
          state = "idle"
        }
        return {
          fire: false,
          reason: "calibrating",
          metrics: buildMetrics(rms, { enter: false, exit: false }),
        }
      }

      const enter = enterThreshold()
      const exit = exitThreshold()
      const above = { enter: rms > enter, exit: rms > exit }

      // ── Stage 2: no segment open ────────────────────────────────────────
      if (state === "idle") {
        if (!above.enter) {
          // Quiet, and not part of any utterance: this is what the noise floor
          // is made of.
          observeQuietFrame(rms)
          return { fire: false, reason: "idle", metrics: buildMetrics(rms, above) }
        }

        // Open a segment. It is only a CANDIDATE until it survives
        // minActivityMs, so a tap cannot become voice activity.
        state = "candidate"
        segmentFrames = 1
        segmentMs = config.frameMs
        voicedFrames = 1
        voicedMs = config.frameMs
        runMs = config.frameMs
        voicedSum = rms
        segmentPeak = rms
        pauseMs = 0
        if (runMs >= config.minActivityMs) {
          state = "speaking"
          qualified = true
        }
        return {
          fire: false,
          reason: state === "speaking" ? "not_sustained" : "candidate",
          metrics: buildMetrics(rms, above),
        }
      }

      // ── Stage 3: a segment is open (candidate | speaking) ───────────────
      segmentFrames += 1
      segmentMs += config.frameMs

      if (above.exit) {
        // Hysteresis: staying alive only needs the LOWER threshold.
        voicedFrames += 1
        voicedMs += config.frameMs
        runMs += config.frameMs
        voicedSum += rms
        if (rms > segmentPeak) segmentPeak = rms
        pauseMs = 0
        // Promotion needs an UNBROKEN run, not just accumulated total. A train
        // of isolated impulses — keyboard clicks, repeated taps — accumulates
        // plenty of voiced time but never produces a continuous run, so it
        // stays a candidate and cannot fire. Voiced syllables and words do.
        if (state === "candidate" && runMs >= config.minActivityMs) {
          state = "speaking"
          qualified = true
        }
      } else {
        runMs = 0
        pauseMs += config.frameMs
        if (pauseMs > config.pauseToleranceMs) {
          // Pause tolerance exhausted — the utterance is over.
          const closedSegment = describeSegment()
          clearSegment()
          state = "idle"
          // The frame that closed the segment is quiet, so it is also a valid
          // noise-floor observation.
          observeQuietFrame(rms)
          return {
            fire: false,
            reason: "segment_ended",
            metrics: buildMetrics(rms, above),
            closedSegment,
          }
        }
      }

      // ── Stage 4: sustained-duration decision ───────────────────────────
      if (state === "speaking" && voicedMs >= config.sustainedMs) {
        if (lastFiredAt !== null && now - lastFiredAt < config.cooldownMs) {
          return { fire: false, reason: "cooldown", metrics: buildMetrics(rms, above) }
        }

        const details: AudioAnomalyDetails = {
          peakLevel: segmentPeak,
          averageLevel: voicedFrames > 0 ? voicedSum / voicedFrames : 0,
          activityRatio: segmentFrames > 0 ? voicedFrames / segmentFrames : 0,
          durationMs: voicedMs,
          segmentMs,
          threshold: enter,
          exitThreshold: exit,
          noiseFloor,
        }
        const metrics = buildMetrics(rms, above)

        lastFiredAt = now
        // Keep the segment OPEN (talking has not stopped) but restart the
        // voiced accumulator, so a further event needs another full
        // `sustainedMs` of voice on top of the cooldown. The old detector
        // cleared its whole window here and went blind for 3 s instead.
        voicedMs = 0
        voicedFrames = 0
        voicedSum = 0
        segmentPeak = 0
        segmentFrames = 0
        segmentMs = 0

        return { fire: true, ...details, metrics }
      }

      return {
        fire: false,
        reason: state === "candidate" ? "candidate" : "not_sustained",
        metrics: buildMetrics(rms, above),
      }
    },

    reset() {
      calibrationBuffer = []
      noiseBuffer = []
      noiseFloor = 0
      calibrated = false
      state = "calibrating"
      clearSegment()
      lastFiredAt = null
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser wiring
// ─────────────────────────────────────────────────────────────────────────────

/** Why the monitor could not start. Surfaced so the caller can degrade. */
export type AudioMonitorFailure =
  /** No getUserMedia or no AudioContext in this browser. */
  | "unsupported"
  /** The candidate (or policy) refused microphone access. */
  | "permission_denied"
  /** Permission is fine but there is no usable input device. */
  | "no_device"
  /** Anything else — analyser construction, stream with no audio track, etc. */
  | "error"

export interface AudioMonitorHandle {
  /** Tear down the analyser, the AudioContext, the stream and the timer. */
  stop: () => void
}

export type AudioMonitorResult =
  | { ok: true; handle: AudioMonitorHandle }
  | { ok: false; reason: AudioMonitorFailure; error?: unknown }

/**
 * Injectable browser surface. Defaults to the real APIs; tests pass fakes so
 * the wiring (permission failure, teardown) can be exercised in plain Node.
 */
export interface AudioMonitorDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createAudioContext: () => AudioContext
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval: (id: ReturnType<typeof setInterval>) => void
  now: () => number
}

function defaultDeps(): AudioMonitorDeps | null {
  const AudioContextCtor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext

  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    !AudioContextCtor
  ) {
    return null
  }

  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createAudioContext: () => new AudioContextCtor(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    now: () => Date.now(),
  }
}

/** Map a getUserMedia rejection onto a stable failure reason. */
export function classifyMediaError(error: unknown): AudioMonitorFailure {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : ""

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "permission_denied"
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no_device"
    default:
      return "error"
  }
}

/**
 * Normalised RMS (0..1) of one 8-bit analyser read.
 *
 * `getByteTimeDomainData` centres samples on 128, so (byte-128)/128 maps the
 * waveform to -1..1 and the root mean square of that is the level.
 *
 * FALLBACK ONLY. 8-bit quantisation puts a floor of roughly 1/128 = 0.0078 on
 * what can be measured — the captured session's "silence" read a constant
 * ~0.0055, which is the quantiser's own dither, not the room. An adaptive
 * threshold needs to resolve the real floor, so `computeRmsFloat` is preferred
 * whenever `getFloatTimeDomainData` exists.
 */
export function computeRms(timeDomain: Uint8Array): number {
  if (timeDomain.length === 0) return 0
  let sumSquares = 0
  for (let i = 0; i < timeDomain.length; i++) {
    const centred = (timeDomain[i] - 128) / 128
    sumSquares += centred * centred
  }
  return Math.sqrt(sumSquares / timeDomain.length)
}

/**
 * Normalised RMS (0..1) of one 32-bit float analyser read.
 *
 * `getFloatTimeDomainData` already returns samples centred on 0 in roughly
 * -1..1, so this is a straight root mean square with no requantisation. For
 * signals well above the 8-bit floor it agrees with `computeRms` to within the
 * quantisation error, so the levels measured by either path are comparable.
 */
export function computeRmsFloat(timeDomain: Float32Array): number {
  if (timeDomain.length === 0) return 0
  let sumSquares = 0
  for (let i = 0; i < timeDomain.length; i++) {
    const sample = timeDomain[i]
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / timeDomain.length)
  return Number.isFinite(rms) ? rms : 0
}

export interface StartAudioMonitorOptions {
  /** Called once per detected anomaly. */
  onAnomaly: (details: AudioAnomalyDetails) => void
  /** Evaluator overrides — mainly for tests. */
  evaluator?: AudioAnomalyEvaluator
  /** Frame cadence; defaults to AUDIO_FRAME_MS. */
  frameMs?: number
  /** Browser API overrides — mainly for tests. */
  deps?: AudioMonitorDeps
}

/**
 * Request the microphone and start sampling. Resolves with a handle whose
 * `stop()` releases every resource, or with a failure reason — it never
 * throws, so a denied microphone cannot break exam start.
 */
export async function startAudioMonitor({
  onAnomaly,
  evaluator = createAudioAnomalyEvaluator(),
  frameMs = AUDIO_FRAME_MS,
  deps,
}: StartAudioMonitorOptions): Promise<AudioMonitorResult> {
  const api = deps ?? defaultDeps()
  if (!api) {
    return { ok: false, reason: "unsupported" }
  }

  let stream: MediaStream
  try {
    stream = await api.getUserMedia({ audio: true, video: false })
  } catch (error) {
    const reason = classifyMediaError(error)
    audioDebugLog(`[AUDIO DEBUG] microphone unavailable reason=${reason}`)
    return { ok: false, reason, error }
  }

  if (stream.getAudioTracks().length === 0) {
    audioDebugLog("[AUDIO DEBUG] microphone unavailable reason=no_device (stream had no audio track)")
    stream.getTracks().forEach((t) => t.stop())
    return { ok: false, reason: "no_device" }
  }

  let audioContext: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  // Idempotent teardown: every resource is released and nulled exactly once,
  // in reverse order of acquisition.
  const stop = () => {
    if (stopped) return
    stopped = true

    if (timer !== null) {
      api.clearInterval(timer)
      timer = null
    }
    try {
      source?.disconnect()
    } catch {
      // A disconnected node throws on some engines; teardown must not fail.
    }
    try {
      analyser?.disconnect()
    } catch {
      // as above
    }
    source = null
    analyser = null

    stream.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        // ignore
      }
    })

    const ctx = audioContext
    audioContext = null
    if (ctx && ctx.state !== "closed") {
      void Promise.resolve(ctx.close()).catch(() => {})
    }

    evaluator.reset()
    audioDebugLog(`[AUDIO DEBUG] microphone stopped timestamp=${api.now()}`)
  }

  try {
    audioContext = api.createAudioContext()
    analyser = audioContext.createAnalyser()
    analyser.fftSize = AUDIO_FFT_SIZE
    analyser.smoothingTimeConstant = AUDIO_SMOOTHING_TIME_CONSTANT
    source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)
    // Deliberately NOT connected to ctx.destination — that would echo the
    // candidate's own microphone back through their speakers.
  } catch (error) {
    stop()
    return { ok: false, reason: "error", error }
  }

  // Prefer 32-bit float samples; fall back to the 8-bit path on engines that
  // only implement getByteTimeDomainData.
  const readFloat =
    typeof (analyser as AnalyserNode).getFloatTimeDomainData === "function"
  const floatBuffer = readFloat ? new Float32Array(analyser.fftSize) : null
  const byteBuffer = readFloat ? null : new Uint8Array(analyser.fftSize)

  if (ENABLE_AUDIO_DEBUG) {
    // One-off start-up snapshot. Answers "is the expected input device live,
    // is the browser processing the signal before we see it, and does each
    // frame actually cover the time between frames?" — the device label is a
    // hardware name reported by the browser, not audio.
    const track = stream.getAudioTracks()[0]
    const settings: MediaTrackSettings = track.getSettings?.() ?? {}
    const sampleRate = settings.sampleRate ?? audioContext.sampleRate
    const analyserWindowMs = sampleRate ? (analyser.fftSize / sampleRate) * 1000 : 0
    audioDebugLog("[AUDIO DEBUG] microphone started")
    audioDebugLog(
      `[AUDIO DEBUG]   device="${track.label || "(unlabelled)"}"` +
        ` readyState=${track.readyState} enabled=${track.enabled} muted=${track.muted}`
    )
    audioDebugLog(
      `[AUDIO DEBUG]   sampleRate=${sampleRate}` +
        ` channels=${settings.channelCount ?? "?"}` +
        ` echoCancellation=${settings.echoCancellation ?? "?"}` +
        ` noiseSuppression=${settings.noiseSuppression ?? "?"}` +
        ` autoGainControl=${settings.autoGainControl ?? "?"}`
    )
    audioDebugLog(
      `[AUDIO DEBUG]   dataPath=${readFloat ? "float32" : "uint8"}` +
        ` fftSize=${analyser.fftSize} analyserWindowMs=${fmt(analyserWindowMs, 1)}` +
        ` frameMs=${frameMs}` +
        ` coverage=${fmt(analyserWindowMs / frameMs, 2)}x`
    )
    audioDebugLog(
      `[AUDIO DEBUG]   calibrationMs=${AUDIO_CALIBRATION_MS}` +
        ` calibrationFrames=${evaluator.calibrationFrames}` +
        ` noisePercentile=${AUDIO_NOISE_PERCENTILE}` +
        ` noiseWindowMs=${AUDIO_NOISE_WINDOW_MS}` +
        ` enterMult=${AUDIO_ENTER_MULTIPLIER} exitMult=${AUDIO_EXIT_MULTIPLIER}` +
        ` minEnter=${AUDIO_MIN_ENTER_RMS} minExit=${AUDIO_MIN_EXIT_RMS}`
    )
    audioDebugLog(
      `[AUDIO DEBUG]   minActivityMs=${AUDIO_MIN_ACTIVITY_MS}` +
        ` sustainedMs=${AUDIO_SUSTAINED_MS}` +
        ` pauseToleranceMs=${AUDIO_PAUSE_TOLERANCE_MS}` +
        ` cooldownMs=${AUDIO_COOLDOWN_MS}`
    )
  }

  // Debug-only running maxima, so "the microphone is too quiet" can be settled
  // from the latest line instead of scrolling the whole log.
  let sessionPeak = 0
  let lastTickAt: number | null = null
  let lastState: VoiceActivityState | null = null

  timer = api.setInterval(() => {
    if (stopped || !analyser) return

    let rms: number
    if (floatBuffer) {
      analyser.getFloatTimeDomainData(floatBuffer)
      rms = computeRmsFloat(floatBuffer)
    } else {
      analyser.getByteTimeDomainData(byteBuffer!)
      rms = computeRms(byteBuffer!)
    }

    const now = api.now()
    const decision = evaluator.push(rms, now)

    if (ENABLE_AUDIO_DEBUG) {
      const m = decision.metrics
      if (m.rms > sessionPeak) sessionPeak = m.rms
      const dt = lastTickAt === null ? 0 : now - lastTickAt
      lastTickAt = now

      // State transitions are the low-volume summary: they show calibration
      // completing and each utterance starting, without reading every frame.
      if (m.state !== lastState) {
        audioDebugLog(
          `[AUDIO DEBUG] state ${lastState ?? "(init)"} -> ${m.state}` +
            ` noiseFloor=${fmt(m.noiseFloor, 5)} enter=${fmt(m.enterThreshold)}` +
            ` exit=${fmt(m.exitThreshold)} noiseSamples=${m.noiseSamples}` +
            ` timestamp=${now}`
        )
        lastState = m.state
      }

      audioDebugLog(
        `[AUDIO DEBUG] rms=${fmt(m.rms)} state=${m.state}` +
          ` floor=${fmt(m.noiseFloor, 5)} enter=${fmt(m.enterThreshold)}` +
          ` exit=${fmt(m.exitThreshold)}` +
          ` voiced=${m.voicedMs}ms run=${m.runMs}ms pause=${m.pauseMs}ms seg=${m.segmentMs}ms` +
          ` frames=${m.voicedFrames}/${m.segmentFrames} ratio=${fmt(m.activityRatio, 2)}` +
          ` peak=${fmt(sessionPeak)} dt=${dt}ms` +
          (decision.fire ? " -> FIRE" : ` (${decision.reason})`)
      )

      if (!decision.fire && decision.closedSegment) {
        const s = decision.closedSegment
        audioDebugLog(
          `[AUDIO DEBUG]   segment closed voicedMs=${s.voicedMs} segmentMs=${s.segmentMs}` +
            ` frames=${s.voicedFrames}/${s.segmentFrames}` +
            ` peak=${fmt(s.peakLevel)} avg=${fmt(s.averageLevel)}` +
            ` qualified=${s.qualified}`
        )
      }
    }

    if (decision.fire) {
      if (ENABLE_AUDIO_DEBUG) {
        audioDebugLog("[AUDIO DEBUG] ANOMALY FIRED")
        audioDebugLog(
          `[AUDIO DEBUG]   voicedMs=${decision.durationMs} segmentMs=${decision.segmentMs}` +
            ` activityRatio=${fmt(decision.activityRatio, 2)}`
        )
        audioDebugLog(
          `[AUDIO DEBUG]   peakLevel=${fmt(decision.peakLevel)}` +
            ` averageLevel=${fmt(decision.averageLevel)}` +
            ` noiseFloor=${fmt(decision.noiseFloor, 5)}`
        )
        audioDebugLog(
          `[AUDIO DEBUG]   enterThreshold=${fmt(decision.threshold)}` +
            ` exitThreshold=${fmt(decision.exitThreshold)} timestamp=${now}`
        )
      }
      onAnomaly({
        peakLevel: decision.peakLevel,
        averageLevel: decision.averageLevel,
        activityRatio: decision.activityRatio,
        durationMs: decision.durationMs,
        segmentMs: decision.segmentMs,
        threshold: decision.threshold,
        exitThreshold: decision.exitThreshold,
        noiseFloor: decision.noiseFloor,
      })
    }
  }, frameMs)

  return { ok: true, handle: { stop } }
}
