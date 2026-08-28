import { describe, it, expect } from "vitest"
import {
  medianOf3,
  computeBaseline,
  updateSustainState,
  initialSustainState,
} from "@/lib/ml-geometry"
import {
  GAZE_ARM_FRAMES,
  GAZE_CALIBRATION_MIN_SAMPLES,
  GAZE_GRACE_MS,
  GAZE_JITTER_TOLERANCE_FRAMES,
  GAZE_PITCH_GRACE_MS,
  GAZE_PITCH_TOLERANCE_FRAMES,
} from "@/lib/proctoring.config"

// Yaw-shaped config, exactly as the hook passes it for head_turned.
const YAW_CFG = {
  graceMs: GAZE_GRACE_MS,
  armFrames: GAZE_ARM_FRAMES,
  toleranceFrames: GAZE_JITTER_TOLERANCE_FRAMES,
} as const

// Pitch-shaped config, exactly as the hook passes it for gaze_away.
const PITCH_CFG = {
  graceMs: GAZE_PITCH_GRACE_MS,
  armFrames: GAZE_ARM_FRAMES,
  toleranceFrames: GAZE_PITCH_TOLERANCE_FRAMES,
} as const

// A fixed tick cadence — 500 ms, the ML_FACE_SCAN_MS cadence. Explicit
// numeric timestamps only; no Date.now(), no timers.
const TICK_MS = 500

describe("ml-temporal — medianOf3", () => {
  it("isolated spike is suppressed: [0.02, 0.32, 0.02] -> 0.02", () => {
    // Mirrors the observed log spikes (0.322/0.358 returning to ~0.02).
    expect(medianOf3([0.02, 0.32, 0.02])).toBe(0.02)
    expect(medianOf3([0.358, 0.02, 0.02])).toBe(0.02)
    expect(medianOf3([0.02, 0.02, 0.358])).toBe(0.02)
  })

  it("sustained step passes through: [0.35, 0.35, 0.35] -> 0.35", () => {
    expect(medianOf3([0.35, 0.35, 0.35])).toBe(0.35)
    expect(medianOf3([-0.4, -0.4, -0.4])).toBe(-0.4)
  })

  it("partial window during pre-fill: median of what exists", () => {
    expect(medianOf3([0.32])).toBe(0.32)
    expect(medianOf3([0.02, 0.32])).toBe(0.17) // mean of the two middle values
  })

  it("empty buffer -> NaN (callers must not feed an empty buffer to decisions)", () => {
    expect(Number.isNaN(medianOf3([]))).toBe(true)
  })
})

describe("ml-temporal — updateSustainState arming", () => {
  it("a single above-threshold frame does NOT arm the timer", () => {
    const r = updateSustainState(initialSustainState(), true, 0, YAW_CFG)
    expect(r.state.startMs).toBeNull()
    expect(r.state.aboveRun).toBe(1)
    expect(r.fired).toBe(false)
  })

  it(`arming requires ${GAZE_ARM_FRAMES} CONSECUTIVE above-threshold frames`, () => {
    // 1 above, 1 below, 1 above, 1 above -> armed on the 4th frame only.
    let s = initialSustainState()
    s = updateSustainState(s, true, 0, YAW_CFG).state
    s = updateSustainState(s, false, TICK_MS, YAW_CFG).state // resets aboveRun
    s = updateSustainState(s, true, 2 * TICK_MS, YAW_CFG).state
    expect(s.startMs).toBeNull() // aboveRun 1 again — not armed
    s = updateSustainState(s, true, 3 * TICK_MS, YAW_CFG).state
    expect(s.startMs).toBe(3 * TICK_MS) // 2 consecutive — armed now
  })
})

describe("ml-temporal — updateSustainState firing", () => {
  it("sustained above for graceMs -> fired true EXACTLY ONCE, with duration", () => {
    let s = initialSustainState()
    // Frame 0: aboveRun=1 (not armed). Frame 1: aboveRun=2 -> armed at 500.
    s = updateSustainState(s, true, 0, YAW_CFG).state
    const armed = updateSustainState(s, true, TICK_MS, YAW_CFG)
    expect(armed.fired).toBe(false)
    s = armed.state
    expect(s.startMs).toBe(TICK_MS)

    // Stay above; the frame where elapsed >= graceMs fires.
    let firedCount = 0
    let duration = 0
    for (let i = 2; i <= 10; i++) {
      const r = updateSustainState(s, true, i * TICK_MS, YAW_CFG)
      s = r.state
      if (r.fired) {
        firedCount += 1
        duration = r.durationMs
      }
    }
    // graceMs 3000 from arm at 500 -> fires at 3500 (frame 7). Frames 8-10
    // are the re-armed window and must NOT fire again.
    expect(firedCount).toBe(1)
    expect(duration).toBe(GAZE_GRACE_MS)
    expect(s.startMs).toBe(7 * TICK_MS) // re-armed from the firing timestamp
  })

  it("documented re-arm semantics: after firing, a repeat needs another full graceMs", () => {
    let s = initialSustainState()
    s = updateSustainState(s, true, 0, YAW_CFG).state
    s = updateSustainState(s, true, TICK_MS, YAW_CFG).state
    const fire = updateSustainState(s, true, TICK_MS + GAZE_GRACE_MS, YAW_CFG)
    expect(fire.fired).toBe(true)
    s = fire.state

    // Immediately after re-arm: graceMs later fires again only if still above.
    const tooSoon = updateSustainState(s, true, TICK_MS + GAZE_GRACE_MS + GAZE_GRACE_MS / 2, YAW_CFG)
    expect(tooSoon.fired).toBe(false)
    const again = updateSustainState(s, true, TICK_MS + 2 * GAZE_GRACE_MS, YAW_CFG)
    expect(again.fired).toBe(true)
  })

  it("TOLERANCE IS CONSECUTIVE, NOT CUMULATIVE: alternating above/below frames never fire", () => {
    // This is the direct regression guard for defect E.1, where below-frame
    // counters were never reset on an above frame and accumulated forever.
    // 60 seconds of alternation across both configs: every below frame
    // resets aboveRun to 0, so the timer never even arms.
    let yaw = initialSustainState()
    let pitch = initialSustainState()
    for (let i = 0; i < 120; i++) {
      const t = i * TICK_MS
      yaw = updateSustainState(yaw, i % 2 === 0, t, YAW_CFG).state
      pitch = updateSustainState(pitch, i % 2 === 0, t, PITCH_CFG).state
      expect(yaw.startMs).toBeNull()
      expect(pitch.startMs).toBeNull()
    }
  })

  it(`toleranceFrames below-frames tolerated; below frame #${GAZE_JITTER_TOLERANCE_FRAMES + 1} clears the timer`, () => {
    // Arm (2 consecutive above), then feed below frames one at a time.
    let s = initialSustainState()
    s = updateSustainState(s, true, 0, YAW_CFG).state
    s = updateSustainState(s, true, TICK_MS, YAW_CFG).state
    expect(s.startMs).toBe(TICK_MS)

    // tolerance 2: one, then two below frames keep the armed timer alive...
    s = updateSustainState(s, false, 2 * TICK_MS, YAW_CFG).state
    expect(s.startMs).toBe(TICK_MS)
    s = updateSustainState(s, false, 3 * TICK_MS, YAW_CFG).state
    expect(s.startMs).toBe(TICK_MS)

    // ...and an above frame inside the tolerance window resumes the SAME run
    // (it does NOT reset startMs). The condition then fires once the total
    // time above+tolerated reaches graceMs: arm 500 -> fire 3500.
    const resumed = updateSustainState(s, true, 7 * TICK_MS, YAW_CFG)
    expect(resumed.fired).toBe(true)
    expect(resumed.durationMs).toBe(6 * TICK_MS) // 3500 - 500

    // Third consecutive below frame (tolerance 2 -> belowRun 3 > 2) clears.
    let s2 = initialSustainState()
    s2 = updateSustainState(s2, true, 0, YAW_CFG).state
    s2 = updateSustainState(s2, true, TICK_MS, YAW_CFG).state
    s2 = updateSustainState(s2, false, 2 * TICK_MS, YAW_CFG).state
    s2 = updateSustainState(s2, false, 3 * TICK_MS, YAW_CFG).state
    s2 = updateSustainState(s2, false, 4 * TICK_MS, YAW_CFG).state
    expect(s2.startMs).toBeNull()
    expect(s2.aboveRun).toBe(0)
    expect(s2.belowRun).toBe(0)
  })

  it("pitch config uses its own grace and tolerance values", () => {
    let s = initialSustainState()
    s = updateSustainState(s, true, 0, PITCH_CFG).state
    const armed = updateSustainState(s, true, TICK_MS, PITCH_CFG).state
    expect(armed.startMs).toBe(TICK_MS)

    // tolerance 1: the FIRST below frame does not clear, the second does.
    let s2 = armed
    s2 = updateSustainState(s2, false, 2 * TICK_MS, PITCH_CFG).state
    expect(s2.startMs).toBe(TICK_MS)
    s2 = updateSustainState(s2, false, 3 * TICK_MS, PITCH_CFG).state
    expect(s2.startMs).toBeNull()

    // Fired once at graceMs 4000 from arm at 500.
    let s3 = armed
    const fire = updateSustainState(s3, true, TICK_MS + GAZE_PITCH_GRACE_MS, PITCH_CFG)
    expect(fire.fired).toBe(true)
    expect(fire.durationMs).toBe(GAZE_PITCH_GRACE_MS)
  })
})

describe("ml-temporal — computeBaseline", () => {
  it(`median of samples; refuses to calibrate below ${GAZE_CALIBRATION_MIN_SAMPLES} samples`, () => {
    const ok = [2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5] // exactly 8
    expect(computeBaseline(ok)).toBe(2.5)
    const tooFew = ok.slice(1)
    expect(Number.isNaN(computeBaseline(tooFew))).toBe(true)
    expect(Number.isNaN(computeBaseline([]))).toBe(true)
  })

  it("robust to a single outlier (median, not mean)", () => {
    const samples = [2.5, 2.52, 2.49, 2.51, 2.5, 2.5, 2.5, 2.5, 25.0] // one wild sample
    const b = computeBaseline(samples)
    // Mean would be ~3.06; the median stays in the resting band.
    expect(b).toBeCloseTo(2.5, 2)
    expect(b).toBeLessThan(2.6)
  })

  it("even sample count averages the two middle values", () => {
    const samples = [2.4, 2.6, 2.4, 2.6, 2.4, 2.6, 2.4, 2.6]
    expect(computeBaseline(samples)).toBe(2.5)
  })

  it("clamps a pathological median into the sane range", () => {
    const clamp = { min: 1.0, max: 5.0 }
    expect(computeBaseline([10, 10, 10, 10, 10, 10, 10, 10], clamp)).toBe(5.0)
    expect(computeBaseline([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2], clamp)).toBe(1.0)
    expect(computeBaseline([2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5], clamp)).toBe(2.5)
  })

  it("non-finite samples are discarded before the minimum-count check", () => {
    const samples = [2.5, Number.NaN, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5] // 7 finite
    expect(Number.isNaN(computeBaseline(samples))).toBe(true)
    const samples2 = [...samples, 2.5] // 8 finite
    expect(computeBaseline(samples2)).toBe(2.5)
  })
})
