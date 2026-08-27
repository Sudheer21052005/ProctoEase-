/**
 * Unit contract for the adaptive-energy VAD primitives and the Web Audio wiring
 * (`lib/audio-detection.ts`).
 *
 * Scope split: the behavioural signal matrix — silence, whispering, typing,
 * coughs, taps, fans, cooldown — lives in `audio-vad.test.ts`. This file covers
 * the pieces that matrix is built out of:
 *   1. `percentileOfSorted`, `computeRms`, `computeRmsFloat`, `classifyMediaError`
 *   2. calibration, the adaptive-threshold arithmetic and its clamps
 *   3. the hysteresis contract — ENTER starts a segment, EXIT sustains one
 *   4. the pause-tolerance boundary and the closed-segment summary
 *   5. `startAudioMonitor`: failure paths, analyser setup, the 8-bit fallback,
 *      teardown
 *   6. invariants between the SHIPPED config constants
 *
 * These tests measure ENERGY decisions, not speech. Nothing here implies the
 * detector knows what was said.
 */

import { describe, expect, it, vi } from "vitest"

import {
  classifyMediaError,
  computeRms,
  computeRmsFloat,
  createAudioAnomalyEvaluator,
  percentileOfSorted,
  startAudioMonitor,
  type AudioAnomalyDecision,
  type AudioEvaluatorConfig,
  type AudioMonitorDeps,
  type VoiceActivityState,
} from "@/lib/audio-detection"
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
  AUDIO_PAUSE_TOLERANCE_MS,
  AUDIO_SMOOTHING_TIME_CONSTANT,
  AUDIO_SUSTAINED_MS,
} from "@/lib/proctoring.config"

/**
 * Deliberately explicit and much faster than the shipped values, so a config
 * change cannot silently make a test vacuous and so each case stays a handful
 * of frames rather than hundreds.
 *
 *   calibrationFrames = 500 / 100 = 5
 *   minActivityMs     = 300 → 3 contiguous frames promote to `speaking`
 *   sustainedMs       = 1000 → 10 voiced frames fire
 *   pauseToleranceMs  = 500 → the 6th quiet frame closes the segment
 */
const CFG: Partial<AudioEvaluatorConfig> = {
  frameMs: 100,
  calibrationMs: 500,
  noisePercentile: 0.5,
  noiseWindowMs: 2_000,
  minNoiseFloor: 0.0005,
  maxNoiseFloor: 0.05,
  enterMultiplier: 5,
  exitMultiplier: 2.5,
  minEnterRms: 0.02,
  minExitRms: 0.012,
  minActivityMs: 300,
  sustainedMs: 1_000,
  pauseToleranceMs: 500,
  cooldownMs: 5_000,
}

const FRAME_MS = 100
const CAL_FRAMES = 5

/** Calibrating on this leaves floor 0.01 → ENTER 0.05, EXIT 0.025. */
const ROOM = 0.01
/** Below EXIT: counts as silence. */
const SILENT = 0.001
/** Between EXIT and ENTER: can sustain a segment but never start one. */
const BETWEEN = 0.035
/** Above ENTER. */
const VOICE = 0.08

/** Clock-driving wrapper so each test reads as a sequence of levels. */
function driver(overrides: Partial<AudioEvaluatorConfig> = {}) {
  const evaluator = createAudioAnomalyEvaluator({ ...CFG, ...overrides })
  const decisions: AudioAnomalyDecision[] = []
  let clock = 0

  const push = (level: number): AudioAnomalyDecision => {
    const decision = evaluator.push(level, clock)
    clock += FRAME_MS
    decisions.push(decision)
    return decision
  }

  /** `count` frames at `level` (count >= 1); returns the last decision. */
  const hold = (level: number, count: number): AudioAnomalyDecision => {
    let last = push(level)
    for (let i = 1; i < count; i++) last = push(level)
    return last
  }

  return {
    evaluator,
    push,
    hold,
    decisions,
    calibrate: (level = ROOM) => hold(level, CAL_FRAMES),
    fires: () => decisions.filter((d) => d.fire),
    now: () => clock,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// percentileOfSorted
// ─────────────────────────────────────────────────────────────────────────────

describe("percentileOfSorted", () => {
  it("returns 0 for an empty sample", () => {
    expect(percentileOfSorted([], 0.5)).toBe(0)
  })

  it("returns the single value for a one-element sample", () => {
    expect(percentileOfSorted([0.42], 0)).toBe(0.42)
    expect(percentileOfSorted([0.42], 1)).toBe(0.42)
  })

  it("interpolates between neighbours", () => {
    expect(percentileOfSorted([0, 1], 0.5)).toBeCloseTo(0.5, 10)
    expect(percentileOfSorted([0, 10, 20, 30], 0.5)).toBeCloseTo(15, 10)
  })

  it("clamps p into 0..1 instead of indexing out of range", () => {
    const sample = [1, 2, 3]
    expect(percentileOfSorted(sample, -5)).toBe(1)
    expect(percentileOfSorted(sample, 5)).toBe(3)
  })

  it("is robust to a single outlier, unlike a mean", () => {
    // This is the reason the noise floor uses a percentile: one door slam during
    // calibration must not drag the baseline up with it.
    const sample = [0.01, 0.01, 0.01, 0.01, 0.9]
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length
    expect(percentileOfSorted(sample, 0.5)).toBeCloseTo(0.01, 10)
    expect(mean).toBeGreaterThan(0.15)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Calibration and adaptive thresholds
// ─────────────────────────────────────────────────────────────────────────────

describe("calibration", () => {
  it("derives its frame count from calibrationMs / frameMs", () => {
    expect(createAudioAnomalyEvaluator(CFG).calibrationFrames).toBe(CAL_FRAMES)
    expect(createAudioAnomalyEvaluator().calibrationFrames).toBe(
      Math.round(AUDIO_CALIBRATION_MS / AUDIO_FRAME_MS)
    )
  })

  it("never calibrates on fewer than one frame, however short the window", () => {
    const evaluator = createAudioAnomalyEvaluator({ ...CFG, calibrationMs: 0 })
    expect(evaluator.calibrationFrames).toBe(1)
  })

  it("keeps detection disarmed until the floor has been measured", () => {
    const d = driver()

    // Shouting through calibration must not raise an anomaly — there is no
    // baseline yet to compare it against.
    for (let i = 0; i < CAL_FRAMES - 1; i++) {
      const decision = d.push(0.9)
      expect(decision).toMatchObject({ fire: false, reason: "calibrating" })
      expect(decision.metrics.state).toBe("calibrating")
    }

    // The frame that completes calibration arms the detector.
    const last = d.push(0.9)
    expect(last).toMatchObject({ fire: false, reason: "calibrating" })
    expect(last.metrics.state).toBe("idle")
  })

  it("takes the percentile of the calibration frames as the floor", () => {
    const d = driver()
    d.hold(ROOM, CAL_FRAMES - 1)
    d.push(0.9) // one outlier

    const snap = d.evaluator.snapshot()
    expect(snap.state).toBe("idle")
    expect(snap.noiseFloor).toBeCloseTo(ROOM, 10)
    expect(snap.enterThreshold).toBeCloseTo(ROOM * 5, 10)
    expect(snap.exitThreshold).toBeCloseTo(ROOM * 2.5, 10)
  })

  it("counts calibration frames and noise samples in the metrics", () => {
    const d = driver()
    const third = d.hold(ROOM, 3)
    expect(third.metrics.calibrationFrames).toBe(3)
    expect(third.metrics.noiseSamples).toBe(0)

    const fifth = d.hold(ROOM, 2)
    expect(fifth.metrics.calibrationFrames).toBe(CAL_FRAMES)
    expect(fifth.metrics.noiseSamples).toBe(CAL_FRAMES)
  })
})

describe("adaptive thresholds", () => {
  it("scales both thresholds with the measured floor", () => {
    // The contract is whichever-is-larger: the multiplied floor, or the absolute
    // minimum. At 0.004 the minimums still win (0.004 × 2.5 = 0.01 < 0.012);
    // from ~0.005 upwards the room drives both thresholds.
    for (const floor of [0.004, 0.006, 0.01, 0.02]) {
      const d = driver()
      d.calibrate(floor)
      const snap = d.evaluator.snapshot()
      expect(snap.noiseFloor).toBeCloseTo(floor, 10)
      expect(snap.enterThreshold).toBeCloseTo(Math.max(0.02, floor * 5), 10)
      expect(snap.exitThreshold).toBeCloseTo(Math.max(0.012, floor * 2.5), 10)
    }

    // Above the crossover the adaptive leg is the one in force, so the detector
    // really is tracking the room rather than sitting on a constant.
    const loudRoom = driver()
    loudRoom.calibrate(0.02)
    expect(loudRoom.evaluator.snapshot().enterThreshold).toBeCloseTo(0.1, 10)
    expect(loudRoom.evaluator.snapshot().exitThreshold).toBeCloseTo(0.05, 10)
  })

  it("holds the absolute minimums in a near-silent room", () => {
    // A digitally silent or muted input measures ~0. Multiplying 0 by anything
    // is still 0, so without the absolute minimums the detector would fire on
    // its own quantisation noise. This is the guard.
    const d = driver()
    d.calibrate(0)

    const snap = d.evaluator.snapshot()
    expect(snap.noiseFloor).toBe(CFG.minNoiseFloor)
    expect(snap.enterThreshold).toBe(CFG.minEnterRms)
    expect(snap.exitThreshold).toBe(CFG.minExitRms)

    // And a level under the absolute minimum stays silent no matter how long
    // it runs.
    d.hold(0.01, 50)
    expect(d.fires()).toHaveLength(0)
  })

  it("clamps a loud calibration so the detector cannot be blinded", () => {
    // Talking through calibration would otherwise set a floor so high that
    // nothing is ever detected again.
    const d = driver()
    d.calibrate(0.3)

    const snap = d.evaluator.snapshot()
    expect(snap.noiseFloor).toBe(CFG.maxNoiseFloor)
    expect(snap.enterThreshold).toBeCloseTo(0.25, 10)
  })

  it("re-estimates the floor from quiet frames only, never from voiced ones", () => {
    const d = driver()
    d.calibrate(ROOM)
    const before = d.evaluator.snapshot().noiseFloor

    // 40 frames of continuous loud audio — more than the whole noise window.
    d.hold(0.4, 40)
    expect(d.evaluator.snapshot().noiseFloor).toBeCloseTo(before, 10)

    // Quiet frames DO move it: the trailing window fills with the new level.
    d.hold(0.02, 40)
    expect(d.evaluator.snapshot().noiseFloor).toBeCloseTo(0.02, 10)
  })

  it("bounds the trailing noise window so old audio is forgotten", () => {
    // noiseWindowMs / frameMs = 20 frames.
    const d = driver()
    d.calibrate(ROOM)
    const settled = d.hold(0.02, 60)
    expect(settled.metrics.noiseSamples).toBe(20)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Hysteresis
// ─────────────────────────────────────────────────────────────────────────────

describe("hysteresis", () => {
  it("will not open a segment on a level between EXIT and ENTER", () => {
    const d = driver()
    d.calibrate(ROOM)

    for (let i = 0; i < 3; i++) {
      const decision = d.push(BETWEEN)
      expect(decision).toMatchObject({ fire: false, reason: "idle" })
      expect(decision.metrics.aboveExit).toBe(true)
      expect(decision.metrics.aboveEnter).toBe(false)
      expect(decision.metrics.segmentFrames).toBe(0)
    }
  })

  it("keeps an open segment alive on the same level, all the way to a fire", () => {
    // Same level, opposite outcome: that difference IS the hysteresis. Once
    // speaking, only the lower bar has to be cleared, so a voice trailing off
    // mid-sentence does not fragment the utterance.
    const d = driver()
    d.calibrate(ROOM)
    d.hold(VOICE, 3) // 300ms contiguous → promoted to `speaking`

    const first = d.push(BETWEEN)
    expect(first.fire).toBe(false)
    expect(first.metrics.state).toBe("speaking")
    expect(first.metrics.aboveEnter).toBe(false)
    expect(first.metrics.aboveExit).toBe(true)
    expect(first.metrics.voicedMs).toBe(400)

    const fired = d.hold(BETWEEN, 6)
    expect(fired.fire).toBe(true)
    if (fired.fire) expect(fired.durationMs).toBe(1_000)
  })

  it("promotes to speaking only after a contiguous minActivityMs run", () => {
    const d = driver()
    d.calibrate(ROOM)

    const one = d.push(VOICE)
    expect(one.metrics.state).toBe("candidate")
    expect(one.metrics.runMs).toBe(100)
    expect(one).toMatchObject({ reason: "candidate" })

    const two = d.push(VOICE)
    expect(two.metrics.state).toBe("candidate")

    const three = d.push(VOICE)
    expect(three.metrics.state).toBe("speaking")
    expect(three.metrics.runMs).toBe(300)
    expect(three).toMatchObject({ reason: "not_sustained" })
  })

  it("resets the run on a quiet frame but keeps the accumulated voiced time", () => {
    const d = driver()
    d.calibrate(ROOM)
    d.hold(VOICE, 2) // runMs 200, voicedMs 200

    const gap = d.push(SILENT)
    expect(gap.metrics.runMs).toBe(0)
    expect(gap.metrics.voicedMs).toBe(200)
    expect(gap.metrics.pauseMs).toBe(100)
    expect(gap.metrics.state).toBe("candidate")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Pause tolerance and closed segments
// ─────────────────────────────────────────────────────────────────────────────

describe("pause tolerance", () => {
  it("tolerates a quiet run up to pauseToleranceMs, then closes the segment", () => {
    const d = driver()
    d.calibrate(ROOM)
    d.hold(VOICE, 3) // speaking, voicedMs 300, segmentFrames 3

    // 5 quiet frames = 500ms = exactly the tolerance: still one segment.
    for (let i = 1; i <= 5; i++) {
      const decision = d.push(SILENT)
      expect(decision.fire).toBe(false)
      if (!decision.fire) {
        expect(decision.reason).toBe("not_sustained")
        expect(decision.closedSegment).toBeUndefined()
      }
      expect(decision.metrics.pauseMs).toBe(i * 100)
      expect(decision.metrics.state).toBe("speaking")
    }

    // The 6th exceeds it and the utterance ends.
    const closing = d.push(SILENT)
    expect(closing.fire).toBe(false)
    if (closing.fire) return
    expect(closing.reason).toBe("segment_ended")
    expect(closing.metrics.state).toBe("idle")
    expect(closing.metrics.pauseMs).toBe(0)
    expect(closing.closedSegment).toMatchObject({
      voicedMs: 300,
      segmentMs: 900,
      voicedFrames: 3,
      segmentFrames: 9,
      qualified: true,
    })
    expect(closing.closedSegment?.peakLevel).toBeCloseTo(VOICE, 10)
    expect(closing.closedSegment?.averageLevel).toBeCloseTo(VOICE, 10)
  })

  it("marks a segment that never reached minActivityMs as unqualified", () => {
    const d = driver()
    d.calibrate(ROOM)
    d.hold(VOICE, 2) // 200ms < 300ms → still a candidate

    const closing = d.hold(SILENT, 6)
    expect(closing.fire).toBe(false)
    if (closing.fire) return
    expect(closing.reason).toBe("segment_ended")
    expect(closing.closedSegment?.qualified).toBe(false)
    expect(d.fires()).toHaveLength(0)
  })

  it("counts pauses toward the segment span but not toward the sustain bar", () => {
    const d = driver()
    d.calibrate(ROOM)

    // 5 voiced frames, a 5-frame tolerated pause, then 5 more voiced frames:
    // 1000ms of voice spread over 1500ms of wall clock.
    d.hold(VOICE, 5)
    d.hold(SILENT, 5)
    const fired = d.hold(VOICE, 5)

    expect(fired.fire).toBe(true)
    if (!fired.fire) return
    expect(fired.durationMs).toBe(1_000)
    expect(fired.segmentMs).toBe(1_500)
    expect(fired.activityRatio).toBeCloseTo(10 / 15, 10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Firing, cooldown, guards, reset
// ─────────────────────────────────────────────────────────────────────────────

describe("firing and cooldown", () => {
  it("reports the thresholds and floor it decided with", () => {
    const d = driver()
    d.calibrate(ROOM)
    const fired = d.hold(VOICE, 10)

    expect(fired.fire).toBe(true)
    if (!fired.fire) return
    expect(fired.noiseFloor).toBeCloseTo(ROOM, 10)
    expect(fired.threshold).toBeCloseTo(ROOM * 5, 10)
    expect(fired.exitThreshold).toBeCloseTo(ROOM * 2.5, 10)
    expect(fired.peakLevel).toBeCloseTo(VOICE, 10)
    expect(fired.durationMs).toBe(1_000)
  })

  it("blocks a re-fire during the cooldown with an explicit reason", () => {
    const d = driver()
    d.calibrate(ROOM)
    d.hold(VOICE, 10)

    const blocked = d.hold(VOICE, 10)
    expect(blocked).toMatchObject({ fire: false, reason: "cooldown" })
    expect(d.fires()).toHaveLength(1)
  })

  it("keeps the segment open after firing instead of going blind", () => {
    // The retired detector cleared its whole window on fire and could not see
    // anything for a further sustain window. Here the segment survives; only
    // the voiced accumulator restarts.
    const d = driver()
    d.calibrate(ROOM)
    const fired = d.hold(VOICE, 10)
    expect(fired.fire).toBe(true)

    const next = d.push(VOICE)
    expect(next.metrics.state).toBe("speaking")
    expect(next.metrics.voicedMs).toBe(100)
    expect(next.metrics.runMs).toBe(1_100)
  })

  it("treats NaN, negative and infinite levels as silence", () => {
    for (const bad of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const d = driver()
      d.calibrate(0)
      const decision = d.hold(bad, 40)
      expect(decision.metrics.rms).toBe(0)
      expect(decision.metrics.aboveEnter).toBe(false)
      expect(d.fires()).toHaveLength(0)
    }
  })

  it("clears the floor, the segment and the cooldown on reset", () => {
    const d = driver()
    d.calibrate(ROOM)
    expect(d.hold(VOICE, 10).fire).toBe(true)

    d.evaluator.reset()

    const snap = d.evaluator.snapshot()
    expect(snap.state).toBe("calibrating")
    expect(snap.noiseFloor).toBe(0)
    // With no floor the thresholds fall back to the absolute minimums.
    expect(snap.enterThreshold).toBe(CFG.minEnterRms)

    // Calibration is required again, and then a second event is allowed even
    // though the original cooldown has not elapsed in wall-clock terms.
    expect(d.push(VOICE)).toMatchObject({ fire: false, reason: "calibrating" })
    d.hold(ROOM, CAL_FRAMES - 1)
    expect(d.hold(VOICE, 10).fire).toBe(true)
    expect(d.now()).toBeLessThan(Number(CFG.cooldownMs))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Privacy guard on the diagnostic metrics
// ─────────────────────────────────────────────────────────────────────────────

describe("frame metrics", () => {
  const STATES: VoiceActivityState[] = ["calibrating", "idle", "candidate", "speaking"]

  it("exposes exactly the documented scalar fields", () => {
    const d = driver()
    d.calibrate(ROOM)
    const decision = d.push(VOICE)

    expect(Object.keys(decision.metrics).sort()).toEqual([
      "aboveEnter",
      "aboveExit",
      "activityRatio",
      "calibrationFrames",
      "enterThreshold",
      "exitThreshold",
      "noiseFloor",
      "noiseSamples",
      "pauseMs",
      "rms",
      "runMs",
      "segmentFrames",
      "segmentMs",
      "state",
      "voicedFrames",
      "voicedMs",
    ])
  })

  it("never carries a buffer or free-form text — only numbers, booleans and a state name", () => {
    // Privacy guard. Everything ENABLE_AUDIO_DEBUG can reach comes from here,
    // so if a typed array or an arbitrary string could appear in `metrics`,
    // raw audio would have become loggable.
    const d = driver()
    const levels = [0, ROOM, ROOM, ROOM, ROOM, VOICE, VOICE, VOICE, SILENT, SILENT]
    for (const level of levels) d.push(level)
    d.hold(SILENT, 8)

    for (const decision of d.decisions) {
      for (const [key, value] of Object.entries(decision.metrics)) {
        expect(ArrayBuffer.isView(value)).toBe(false)
        if (key === "state") {
          expect(STATES).toContain(value)
        } else {
          expect(["number", "boolean"]).toContain(typeof value)
        }
      }
    }
  })

  it("is present on every branch, including calibration and segment close", () => {
    const d = driver()
    d.hold(0, CAL_FRAMES)
    d.hold(VOICE, 3)
    d.hold(SILENT, 6)

    const reasons = d.decisions.map((decision) =>
      decision.fire ? "FIRE" : decision.reason
    )
    expect(new Set(reasons)).toEqual(
      new Set(["calibrating", "not_sustained", "candidate", "segment_ended"])
    )
    for (const decision of d.decisions) {
      expect(typeof decision.metrics.rms).toBe("number")
      expect(Number.isFinite(decision.metrics.enterThreshold)).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RMS helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("computeRmsFloat", () => {
  it("returns 0 for an empty buffer", () => {
    expect(computeRmsFloat(new Float32Array(0))).toBe(0)
  })

  it("returns 0 for digital silence", () => {
    expect(computeRmsFloat(new Float32Array(64))).toBe(0)
  })

  it("returns the amplitude of a square wave", () => {
    const buf = new Float32Array(64)
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? -0.25 : 0.25
    expect(computeRmsFloat(buf)).toBeCloseTo(0.25, 6)
  })

  it("scales monotonically with amplitude", () => {
    const at = (amplitude: number) => {
      const buf = new Float32Array(64)
      for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? -amplitude : amplitude
      return computeRmsFloat(buf)
    }
    expect(at(0.01)).toBeLessThan(at(0.1))
    expect(at(0.1)).toBeLessThan(at(0.8))
  })

  it("guards a stalled analyser that returns NaN", () => {
    const buf = new Float32Array([0.1, Number.NaN, 0.1])
    expect(computeRmsFloat(buf)).toBe(0)
  })

  it("resolves levels the 8-bit path cannot", () => {
    // 1 LSB of getByteTimeDomainData is 1/128 ≈ 0.0078, so a true floor below
    // that quantises away. This is why the float path is preferred: a real room
    // noise floor of 0.002 must not read as 0 or as the quantiser's dither.
    const buf = new Float32Array(64)
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? -0.002 : 0.002
    expect(computeRmsFloat(buf)).toBeCloseTo(0.002, 6)
    expect(computeRmsFloat(buf)).toBeLessThan(1 / 128)
  })
})

describe("computeRms (8-bit fallback)", () => {
  it("returns 0 for an empty buffer", () => {
    expect(computeRms(new Uint8Array(0))).toBe(0)
  })

  it("returns 0 for pure silence (all samples centred on 128)", () => {
    expect(computeRms(new Uint8Array(64).fill(128))).toBe(0)
  })

  it("returns 1 for a full-scale square wave", () => {
    const buf = new Uint8Array(64)
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? 0 : 255
    // (0-128)/128 = -1 and (255-128)/128 ≈ 0.992 → RMS ≈ 1
    expect(computeRms(buf)).toBeGreaterThan(0.99)
    expect(computeRms(buf)).toBeLessThanOrEqual(1)
  })

  it("scales monotonically with amplitude", () => {
    const at = (amplitude: number) => {
      const buf = new Uint8Array(64)
      for (let i = 0; i < buf.length; i++) {
        buf[i] = 128 + (i % 2 === 0 ? -amplitude : amplitude)
      }
      return computeRms(buf)
    }
    expect(at(8)).toBeLessThan(at(32))
    expect(at(32)).toBeLessThan(at(96))
  })

  it("agrees with the float path within one quantisation step", () => {
    // Backs the claim in the module docblock: levels measured by either path are
    // comparable well above the 8-bit floor, so the thresholds do not have to
    // change when a browser only offers the byte API.
    const level = 0.4
    const bytes = new Uint8Array(64)
    const floats = new Float32Array(64)
    const amplitude = Math.round(level * 128)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = 128 + (i % 2 === 0 ? -amplitude : amplitude)
      floats[i] = i % 2 === 0 ? -level : level
    }
    expect(Math.abs(computeRms(bytes) - computeRmsFloat(floats))).toBeLessThan(1 / 128)
  })
})

describe("classifyMediaError", () => {
  it("maps a denied permission", () => {
    expect(classifyMediaError({ name: "NotAllowedError" })).toBe("permission_denied")
    expect(classifyMediaError({ name: "SecurityError" })).toBe("permission_denied")
    expect(classifyMediaError({ name: "PermissionDeniedError" })).toBe("permission_denied")
  })

  it("maps a missing device", () => {
    expect(classifyMediaError({ name: "NotFoundError" })).toBe("no_device")
    expect(classifyMediaError({ name: "DevicesNotFoundError" })).toBe("no_device")
    expect(classifyMediaError({ name: "OverconstrainedError" })).toBe("no_device")
  })

  it("falls back to a generic error", () => {
    expect(classifyMediaError(new Error("boom"))).toBe("error")
    expect(classifyMediaError(undefined)).toBe("error")
    expect(classifyMediaError("nope")).toBe("error")
    expect(classifyMediaError(null)).toBe("error")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// startAudioMonitor — wiring, failure handling and teardown
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fake browser surface. `float: false` omits getFloatTimeDomainData so the
 * 8-bit fallback path is exercised for real.
 */
function makeHarness(
  options: {
    deps?: Partial<AudioMonitorDeps>
    float?: boolean
    audioTracks?: number
  } = {}
) {
  const float = options.float ?? true
  const state = {
    trackStops: 0,
    contextClosed: 0,
    sourceDisconnects: 0,
    analyserDisconnects: 0,
    intervalsCleared: 0,
    connectedToDestination: false,
    floatReads: 0,
    byteReads: 0,
    intervalMs: -1,
    bufferLength: -1,
  }

  let currentLevel = 0
  let clock = 1_000
  let sampler: (() => void) | null = null

  const tracks = Array.from({ length: options.audioTracks ?? 1 }, () => ({
    label: "Fake Microphone",
    readyState: "live",
    enabled: true,
    muted: false,
    getSettings: () => ({ sampleRate: 48_000, channelCount: 1 }),
    stop: () => {
      state.trackStops += 1
    },
  }))

  const stream = {
    getAudioTracks: () => tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream

  const analyser: Record<string, unknown> = {
    fftSize: 32,
    smoothingTimeConstant: 0.8,
    getByteTimeDomainData: (buffer: Uint8Array) => {
      state.byteReads += 1
      state.bufferLength = buffer.length
      const amplitude = Math.round(currentLevel * 128)
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = 128 + (i % 2 === 0 ? -amplitude : amplitude)
      }
    },
    disconnect: () => {
      state.analyserDisconnects += 1
    },
  }
  if (float) {
    analyser.getFloatTimeDomainData = (buffer: Float32Array) => {
      state.floatReads += 1
      state.bufferLength = buffer.length
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = i % 2 === 0 ? -currentLevel : currentLevel
      }
    }
  }

  const destination = {}

  const source = {
    connect: (target: unknown) => {
      if (target === destination) state.connectedToDestination = true
    },
    disconnect: () => {
      state.sourceDisconnects += 1
    },
  }

  const audioContext = {
    state: "running" as AudioContextState,
    sampleRate: 48_000,
    destination,
    createAnalyser: () => analyser as unknown as AnalyserNode,
    createMediaStreamSource: () => source as unknown as MediaStreamAudioSourceNode,
    close: () => {
      state.contextClosed += 1
      return Promise.resolve()
    },
  }

  const deps: AudioMonitorDeps = {
    getUserMedia: () => Promise.resolve(stream),
    createAudioContext: () => audioContext as unknown as AudioContext,
    setInterval: (fn, ms) => {
      sampler = fn
      state.intervalMs = ms
      return 1 as unknown as ReturnType<typeof setInterval>
    },
    clearInterval: () => {
      state.intervalsCleared += 1
      sampler = null
    },
    now: () => clock,
    ...options.deps,
  }

  return {
    deps,
    state,
    analyser,
    isSampling: () => sampler !== null,
    /** `count` frames at `level`, advancing the clock by one frame each. */
    feed: (level: number, count: number) => {
      currentLevel = level
      for (let i = 0; i < count; i++) {
        sampler?.()
        clock += FRAME_MS
      }
    },
    advance: (ms: number) => {
      clock += ms
    },
  }
}

/** Monitor options wired to the fast test config. */
function monitorOptions(harness: ReturnType<typeof makeHarness>, onAnomaly = () => {}) {
  return {
    onAnomaly,
    deps: harness.deps,
    evaluator: createAudioAnomalyEvaluator(CFG),
    frameMs: FRAME_MS,
  }
}

describe("startAudioMonitor", () => {
  it("reports unsupported when no browser APIs are injected or available", async () => {
    // No deps and no window/navigator in the node test environment.
    const result = await startAudioMonitor({ onAnomaly: () => {} })
    expect(result).toEqual({ ok: false, reason: "unsupported" })
  })

  it("fails gracefully when microphone permission is denied", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness({
      deps: {
        getUserMedia: () =>
          Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })),
      },
    })

    const result = await startAudioMonitor({ onAnomaly, deps: harness.deps })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("permission_denied")
    expect(onAnomaly).not.toHaveBeenCalled()
    // Nothing was acquired, so nothing should have been torn down.
    expect(harness.state.contextClosed).toBe(0)
    expect(harness.isSampling()).toBe(false)
  })

  it("fails gracefully when there is no microphone device", async () => {
    const harness = makeHarness({
      deps: {
        getUserMedia: () =>
          Promise.reject(Object.assign(new Error("none"), { name: "NotFoundError" })),
      },
    })
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_device")
  })

  it("releases the stream when it carries no audio track", async () => {
    const harness = makeHarness({ audioTracks: 0 })
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_device")
  })

  it("fails gracefully when the AudioContext cannot be built", async () => {
    const harness = makeHarness({
      deps: {
        createAudioContext: () => {
          throw new Error("no audio hardware")
        },
      },
    })
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("error")
    // The already-acquired stream must still be released.
    expect(harness.state.trackStops).toBe(1)
  })

  it("never routes the microphone back to the speakers", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })

    expect(result.ok).toBe(true)
    expect(harness.state.connectedToDestination).toBe(false)
    if (result.ok) result.handle.stop()
  })

  it("configures the analyser from the shipped config", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })
    expect(result.ok).toBe(true)

    // The fake starts at 32 / 0.8; the monitor must overwrite both.
    expect(harness.analyser.fftSize).toBe(AUDIO_FFT_SIZE)
    expect(harness.analyser.smoothingTimeConstant).toBe(AUDIO_SMOOTHING_TIME_CONSTANT)
    if (result.ok) result.handle.stop()
  })

  it("samples on the requested frame cadence with a full-window buffer", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor(monitorOptions(harness))
    expect(result.ok).toBe(true)

    expect(harness.state.intervalMs).toBe(FRAME_MS)
    harness.feed(0, 1)
    expect(harness.state.bufferLength).toBe(AUDIO_FFT_SIZE)

    if (result.ok) result.handle.stop()
  })

  it("prefers the float path when the analyser offers it", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness({ float: true })
    const result = await startAudioMonitor(monitorOptions(harness, onAnomaly))
    expect(result.ok).toBe(true)

    harness.feed(0, CAL_FRAMES)
    harness.feed(0.4, 10)

    expect(harness.state.floatReads).toBe(CAL_FRAMES + 10)
    expect(harness.state.byteReads).toBe(0)
    expect(onAnomaly).toHaveBeenCalledTimes(1)

    if (result.ok) result.handle.stop()
  })

  it("falls back to the 8-bit path and still detects", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness({ float: false })
    expect(harness.analyser.getFloatTimeDomainData).toBeUndefined()

    const result = await startAudioMonitor(monitorOptions(harness, onAnomaly))
    expect(result.ok).toBe(true)

    harness.feed(0, CAL_FRAMES)
    harness.feed(0.4, 10)

    expect(harness.state.byteReads).toBe(CAL_FRAMES + 10)
    expect(harness.state.floatReads).toBe(0)
    expect(onAnomaly).toHaveBeenCalledTimes(1)

    if (result.ok) result.handle.stop()
  })

  it("raises nothing while calibrating, then one event for one utterance", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness()
    const result = await startAudioMonitor(monitorOptions(harness, onAnomaly))
    expect(result.ok).toBe(true)

    // Loud audio during calibration is deliberately ignored.
    harness.feed(0.5, CAL_FRAMES)
    expect(onAnomaly).not.toHaveBeenCalled()

    harness.feed(0, 30) // let the floor settle back down
    expect(onAnomaly).not.toHaveBeenCalled()

    harness.feed(0.4, 12)
    expect(onAnomaly).toHaveBeenCalledTimes(1)

    if (result.ok) result.handle.stop()
  })

  it("applies the cooldown across the sampling loop", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness()
    const result = await startAudioMonitor(monitorOptions(harness, onAnomaly))

    harness.feed(0, CAL_FRAMES)
    harness.feed(0.4, 40)
    expect(onAnomaly).toHaveBeenCalledTimes(1)

    // Past the cooldown, a second event is allowed.
    harness.advance(Number(CFG.cooldownMs))
    harness.feed(0.4, 10)
    expect(onAnomaly).toHaveBeenCalledTimes(2)

    if (result.ok) result.handle.stop()
  })

  it("releases every resource on stop", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    result.handle.stop()

    expect(harness.state.intervalsCleared).toBe(1)
    expect(harness.state.sourceDisconnects).toBe(1)
    expect(harness.state.analyserDisconnects).toBe(1)
    expect(harness.state.trackStops).toBe(1)
    expect(harness.state.contextClosed).toBe(1)
    expect(harness.isSampling()).toBe(false)
  })

  it("is idempotent and stops sampling after stop", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness()
    const result = await startAudioMonitor(monitorOptions(harness, onAnomaly))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    harness.feed(0, CAL_FRAMES)
    result.handle.stop()
    result.handle.stop()
    result.handle.stop()

    // Resources released exactly once, not three times.
    expect(harness.state.intervalsCleared).toBe(1)
    expect(harness.state.trackStops).toBe(1)
    expect(harness.state.contextClosed).toBe(1)

    // A stale timer callback firing after teardown must be inert.
    harness.feed(0.5, 60)
    expect(onAnomaly).not.toHaveBeenCalled()
  })

  it("survives a node that throws on disconnect", async () => {
    const harness = makeHarness()
    harness.analyser.disconnect = () => {
      throw new Error("already disconnected")
    }
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(() => result.handle.stop()).not.toThrow()
    // Teardown continued past the throwing node.
    expect(harness.state.trackStops).toBe(1)
    expect(harness.state.contextClosed).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Shipped configuration invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("shipped audio config", () => {
  it("cannot fire on a single loud frame", () => {
    expect(AUDIO_MIN_ACTIVITY_MS).toBeGreaterThan(AUDIO_FRAME_MS)
    expect(AUDIO_SUSTAINED_MS).toBeGreaterThan(AUDIO_MIN_ACTIVITY_MS * 2)
  })

  it("keeps a real hysteresis band on both the adaptive and absolute legs", () => {
    expect(AUDIO_EXIT_MULTIPLIER).toBeLessThan(AUDIO_ENTER_MULTIPLIER)
    expect(AUDIO_MIN_EXIT_RMS).toBeLessThan(AUDIO_MIN_ENTER_RMS)
  })

  it("brackets the noise floor so neither clamp can disable detection", () => {
    expect(AUDIO_MIN_NOISE_FLOOR).toBeGreaterThan(0)
    expect(AUDIO_MIN_NOISE_FLOOR).toBeLessThan(AUDIO_MAX_NOISE_FLOOR)
    // Even at the loudest tolerated floor, ENTER stays inside the range ordinary
    // speech reaches (the captured session peaked at 0.52).
    expect(AUDIO_MAX_NOISE_FLOOR * AUDIO_ENTER_MULTIPLIER).toBeLessThanOrEqual(0.3)
  })

  it("tolerates pauses without letting one word masquerade as an utterance", () => {
    expect(AUDIO_PAUSE_TOLERANCE_MS).toBeLessThan(AUDIO_SUSTAINED_MS)
    expect(AUDIO_PAUSE_TOLERANCE_MS).toBeGreaterThan(AUDIO_MIN_ACTIVITY_MS)
  })

  it("rate-limits hard enough that talking cannot exhaust the violation budget", () => {
    expect(AUDIO_COOLDOWN_MS).toBeGreaterThan(AUDIO_SUSTAINED_MS * 2)
  })

  it("collects enough calibration frames for a percentile to mean anything", () => {
    expect(AUDIO_CALIBRATION_MS / AUDIO_FRAME_MS).toBeGreaterThanOrEqual(8)
  })

  it("reads at least one frame's worth of audio per frame", () => {
    // Coverage = analyser window / frame period. Below 1.0 there are gaps in the
    // timeline that no read ever sees, which is how the previous 2048/250ms
    // pairing measured only ~17% of the exam.
    //
    // 44.1k and 48k are the rates Chrome reports for microphone input here. A
    // 96 kHz device would halve the window to 85ms and drop coverage under 1 —
    // AUDIO_FFT_SIZE would have to rise to 16384 for that hardware.
    for (const sampleRate of [44_100, 48_000]) {
      const windowMs = (AUDIO_FFT_SIZE / sampleRate) * 1_000
      expect(windowMs).toBeGreaterThanOrEqual(AUDIO_FRAME_MS)
    }
  })
})
