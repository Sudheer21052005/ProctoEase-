import { describe, it, expect } from "vitest"
import {
  evaluateFaceOrientation,
  classifyObjectPredictions,
  isHeadTurned,
  isGazeAway,
  computeFhDeviation,
  computeBaseline,
  updateObjectTicks,
  initialObjectTickState,
} from "@/lib/ml-geometry"
import {
  GAZE_PITCH_MAX_YAW,
  OBJECT_CONSECUTIVE_TICKS,
} from "@/lib/proctoring.config"
import * as config from "@/lib/proctoring.config"
import { makeLandmarks, makePitchedFace, noseXForYawRatio } from "./ml-geometry.test.utils"

/**
 * Fixture geometry: interocular = 0.16, faceHeight = 0.40, so the neutral
 * fhRatio baseline is 0.40 / 0.16 = 2.5.
 */
const NEUTRAL_FH_BASELINE = 2.5

describe("ml-geometry — evaluateFaceOrientation", () => {
  it("forward-facing neutral face with a correct baseline -> valid, calibrated, headTurned false, gazeAway false", () => {
    const r = evaluateFaceOrientation(makeLandmarks(), NEUTRAL_FH_BASELINE)
    expect(r.valid).toBe(true)
    expect(r.calibrated).toBe(true)
    expect(r.headTurned).toBe(false)
    expect(r.gazeAway).toBe(false)
    expect(r.fhDeviation).toBeCloseTo(0, 6)
  })

  it("NEUTRAL-CONSISTENCY GUARD: the fixture's neutral face and the baseline derived from its own samples agree", () => {
    // This is the test that would have caught the shipped bug: the old
    // config asserted a pitch neutral of 0.100 while the fixture produces
    // pitchRatio = 0.000 exactly, and the old "neutral" test passed with
    // only 0.03 of margin against a 0.13 threshold. Here the baseline is
    // DERIVED from the fixture (via the production computeBaseline path)
    // and must agree with it.
    const neutral = evaluateFaceOrientation(makeLandmarks())
    expect(neutral.valid).toBe(true)
    expect(neutral.fhRatio).toBeCloseTo(NEUTRAL_FH_BASELINE, 6)

    const derived = config.GAZE_CALIBRATION_MIN_SAMPLES // ensure the derivation is legal
    expect(derived).toBeGreaterThan(0)
    const samples = Array.from({ length: 10 }, () => neutral.fhRatio)
    const baseline = computeBaseline(samples)
    expect(baseline).toBeCloseTo(neutral.fhRatio, 6)

    const r = evaluateFaceOrientation(makeLandmarks(), baseline)
    expect(Math.abs(r.fhDeviation)).toBeLessThan(0.02) // stated tolerance
    expect(r.gazeAway).toBe(false)

    // Diagnostic channel sanity: the fixture's fractional nose position
    // must sit near 0 — a large offset here means fixture and baseline
    // systems disagree (the exact failure mode of the old constant).
    expect(Math.abs(neutral.pitchRatio)).toBeLessThanOrEqual(0.05)
  })

  it("deliberate yaw left (nose shifted toward left eye) -> headTurned true, negative yawRatio", () => {
    const lm = makeLandmarks({ 1: { x: 0.44, y: 0.50 } }) // nose moved toward left eye (0.42)
    const r = evaluateFaceOrientation(lm, NEUTRAL_FH_BASELINE)
    expect(r.valid).toBe(true)
    expect(r.headTurned).toBe(true)
    expect(r.yawRatio).toBeLessThan(0)
  })

  it("deliberate yaw right (nose shifted toward right eye) -> headTurned true, positive yawRatio", () => {
    const lm = makeLandmarks({ 1: { x: 0.56, y: 0.50 } }) // nose moved toward right eye (0.58)
    const r = evaluateFaceOrientation(lm, NEUTRAL_FH_BASELINE)
    expect(r.valid).toBe(true)
    expect(r.headTurned).toBe(true)
    expect(r.yawRatio).toBeGreaterThan(0)
  })

  it("yaw sign symmetry: equal-magnitude left/right yaws give opposite yawRatios and identical booleans", () => {
    const left = evaluateFaceOrientation(makeLandmarks({ 1: { x: noseXForYawRatio(-0.35), y: 0.5 } }), NEUTRAL_FH_BASELINE)
    const right = evaluateFaceOrientation(makeLandmarks({ 1: { x: noseXForYawRatio(0.35), y: 0.5 } }), NEUTRAL_FH_BASELINE)
    expect(left.yawRatio).toBeCloseTo(-right.yawRatio, 6)
    expect(left.headTurned).toBe(right.headTurned)
    expect(left.headTurned).toBe(true)
  })

  it("REALISTIC measured magnitudes: |yawRatio| 0.131 -> false; 0.322 -> true", () => {
    // 0.131 = measured resting maximum; 0.322 = weakest deliberate turn
    // from the 28 Aug 2026 Chrome session.
    const resting = evaluateFaceOrientation(makeLandmarks({ 1: { x: noseXForYawRatio(0.131), y: 0.5 } }), NEUTRAL_FH_BASELINE)
    expect(resting.yawRatio).toBeCloseTo(0.131, 3)
    expect(resting.headTurned).toBe(false)

    const turned = evaluateFaceOrientation(makeLandmarks({ 1: { x: noseXForYawRatio(0.322), y: 0.5 } }), NEUTRAL_FH_BASELINE)
    expect(turned.yawRatio).toBeCloseTo(0.322, 3)
    expect(turned.headTurned).toBe(true)
  })

  it("realistic pitch excursion -> gazeAway true ONLY when calibrated", () => {
    // 15% projected-height shrink: a deliberate look-down at desk level.
    const lm = makePitchedFace(0.15)
    const calibratedResult = evaluateFaceOrientation(lm, NEUTRAL_FH_BASELINE)
    expect(calibratedResult.calibrated).toBe(true)
    expect(calibratedResult.fhDeviation).toBeCloseTo(-0.15, 3)
    expect(calibratedResult.gazeAway).toBe(true)

    const uncalibratedResult = evaluateFaceOrientation(lm)
    expect(uncalibratedResult.calibrated).toBe(false)
    expect(uncalibratedResult.gazeAway).toBe(false)
  })

  it("uncalibrated input -> gazeAway false regardless of magnitude", () => {
    const extreme = makePitchedFace(0.5) // 50% shrink — far beyond any resting pose
    expect(evaluateFaceOrientation(extreme).gazeAway).toBe(false)
    expect(evaluateFaceOrientation(extreme, null).gazeAway).toBe(false)
    expect(evaluateFaceOrientation(extreme, undefined).gazeAway).toBe(false)
  })

  it("pitch suppressed when |yawRatio| > GAZE_PITCH_MAX_YAW (no double-firing with head_turned)", () => {
    // Strong turn (yawRatio 0.322) AND 15% height shrink together.
    const lm = makePitchedFace(0.15, noseXForYawRatio(0.322))
    const r = evaluateFaceOrientation(lm, NEUTRAL_FH_BASELINE)
    expect(r.headTurned).toBe(true)
    expect(r.gazeAway).toBe(false)
    expect(isGazeAway(true, GAZE_PITCH_MAX_YAW, 0.5)).toBe(false) // at the boundary
    expect(isGazeAway(true, GAZE_PITCH_MAX_YAW - 0.001, 0.5)).toBe(true)
  })

  it("boundary just below yaw threshold -> headTurned false", () => {
    // interocular 0.16, threshold 0.25 -> yawOffset must be <= 0.04 -> nose.x <= 0.54
    const lm = makeLandmarks({ 1: { x: 0.5399, y: 0.50 } }) // ratio 0.2494
    const r = evaluateFaceOrientation(lm, NEUTRAL_FH_BASELINE)
    expect(r.valid).toBe(true)
    expect(r.headTurned).toBe(false)
  })

  it("boundary just above yaw threshold -> headTurned true", () => {
    const lm = makeLandmarks({ 1: { x: 0.5401, y: 0.50 } }) // ratio 0.2506
    const r = evaluateFaceOrientation(lm, NEUTRAL_FH_BASELINE)
    expect(r.valid).toBe(true)
    expect(r.headTurned).toBe(true)
  })

  it("fhDeviation exactly at threshold -> gazeAway false; just beyond -> true", () => {
    // 12% shrink gives |fhDeviation| = 0.12 exactly: not STRICTLY greater.
    expect(evaluateFaceOrientation(makePitchedFace(0.12), NEUTRAL_FH_BASELINE).gazeAway).toBe(false)
    expect(evaluateFaceOrientation(makePitchedFace(0.121), NEUTRAL_FH_BASELINE).gazeAway).toBe(true)
    // Pure decision function, same boundaries.
    expect(isGazeAway(true, 0, 0.12)).toBe(false)
    expect(isGazeAway(true, 0, 0.1201)).toBe(true)
    expect(isGazeAway(false, 0, 9)).toBe(false)
  })

  it("computeFhDeviation returns 0 for missing/invalid baselines", () => {
    expect(computeFhDeviation(2.5, null)).toBe(0)
    expect(computeFhDeviation(2.5, 0)).toBe(0)
    expect(computeFhDeviation(2.5, Number.NaN)).toBe(0)
    expect(computeFhDeviation(2.5, -1)).toBe(0)
    expect(computeFhDeviation(2.2, 2.5)).toBeCloseTo(-0.12, 6)
  })

  it("scale invariance: identical pose at half face size -> identical ratios and booleans", () => {
    const scale = (pt: { x: number; y: number }) => ({ x: 0.5 + (pt.x - 0.5) * 0.5, y: 0.5 + (pt.y - 0.5) * 0.5 })
    const baseTurned = makeLandmarks({ 1: { x: 0.56, y: 0.50 } }) // yaw right
    const basePitched = makePitchedFace(0.15)
    for (const base of [baseTurned, basePitched]) {
      const scaled = base.map(scale)
      const r1 = evaluateFaceOrientation(base, NEUTRAL_FH_BASELINE)
      const r2 = evaluateFaceOrientation(scaled, NEUTRAL_FH_BASELINE)
      expect(r2.fhRatio).toBeCloseTo(r1.fhRatio, 6) // ratio metrics are scale-free
      expect(r2.yawRatio).toBeCloseTo(r1.yawRatio, 6)
      expect(r2.headTurned).toBe(r1.headTurned)
      expect(r2.gazeAway).toBe(r1.gazeAway)
    }
  })

  it("missing landmark(s) -> valid false, no fire", () => {
    const lm = makeLandmarks({ 33: undefined as any }) // missing left eye
    const r = evaluateFaceOrientation(lm, NEUTRAL_FH_BASELINE)
    expect(r.valid).toBe(false)
    expect(r.headTurned).toBe(false)
    expect(r.gazeAway).toBe(false)
    expect(r.calibrated).toBe(false)
  })

  it("degenerate zero-width face (interocular <= 0) -> valid false, no fire, no NaN/Infinity", () => {
    const lm = makeLandmarks({ 33: { x: 0.5, y: 0.45 }, 263: { x: 0.5, y: 0.45 } }) // eyes same x
    const r = evaluateFaceOrientation(lm, NEUTRAL_FH_BASELINE)
    expect(r.valid).toBe(false)
    expect(r.headTurned).toBe(false)
    expect(r.gazeAway).toBe(false)
    expect(Number.isFinite(r.yawRatio)).toBe(true)
    expect(Number.isFinite(r.fhRatio)).toBe(true)
    expect(Number.isFinite(r.fhDeviation)).toBe(true)
    expect(Number.isFinite(r.pitchRatio)).toBe(true)
  })

  it("degenerate zero-height face (faceHeight <= 0) -> valid false, no fire, no NaN/Infinity", () => {
    const lm = makeLandmarks({ 10: { x: 0.5, y: 0.5 }, 152: { x: 0.5, y: 0.5 } }) // forehead == chin
    const r = evaluateFaceOrientation(lm, NEUTRAL_FH_BASELINE)
    expect(r.valid).toBe(false)
    expect(r.headTurned).toBe(false)
    expect(r.gazeAway).toBe(false)
    expect(Number.isFinite(r.pitchRatio)).toBe(true)
    expect(Number.isFinite(r.fhRatio)).toBe(true)
  })

  it("fhRatio is finite and > 0 for a valid face", () => {
    const r = evaluateFaceOrientation(makeLandmarks(), NEUTRAL_FH_BASELINE)
    expect(r.valid).toBe(true)
    expect(Number.isFinite(r.fhRatio)).toBe(true)
    expect(r.fhRatio).toBeGreaterThan(0)
    expect(r.interocular).toBeCloseTo(0.16, 6)
    expect(r.faceHeight).toBeCloseTo(0.4, 6)
  })

  it("isHeadTurned mirrors the configured yaw threshold boundary", () => {
    expect(isHeadTurned(config.HEAD_YAW_RATIO_THRESHOLD)).toBe(false) // strict >
    expect(isHeadTurned(config.HEAD_YAW_RATIO_THRESHOLD + 0.0001)).toBe(true)
    expect(isHeadTurned(-config.HEAD_YAW_RATIO_THRESHOLD - 0.0001)).toBe(true)
  })
})

describe("ml-geometry — classifyObjectPredictions", () => {
  it("phone prediction above threshold -> phoneDetected true", () => {
    const preds = [{ class: "cell phone", score: 0.8 }]
    const r = classifyObjectPredictions(preds)
    expect(r.phoneDetected).toBe(true)
    expect(r.unauthorizedObjectDetected).toBe(false)
    expect(r.detectedObjects).toEqual(["cell phone"])
  })

  it("phone prediction below threshold -> phoneDetected false", () => {
    const preds = [{ class: "cell phone", score: 0.3 }] // below 0.45
    const r = classifyObjectPredictions(preds)
    expect(r.phoneDetected).toBe(false)
    expect(r.unauthorizedObjectDetected).toBe(false)
  })

  it("book above threshold -> unauthorizedObjectDetected true", () => {
    const preds = [{ class: "book", score: 0.7 }]
    const r = classifyObjectPredictions(preds)
    expect(r.phoneDetected).toBe(false)
    expect(r.unauthorizedObjectDetected).toBe(true)
    expect(r.detectedObjects).toEqual(["book"])
  })

  it("irrelevant class (person, chair) -> neither", () => {
    const preds = [{ class: "person", score: 0.9 }, { class: "chair", score: 0.8 }]
    const r = classifyObjectPredictions(preds)
    expect(r.phoneDetected).toBe(false)
    expect(r.unauthorizedObjectDetected).toBe(false)
  })

  it("empty predictions array -> neither, no crash", () => {
    const r = classifyObjectPredictions([])
    expect(r.phoneDetected).toBe(false)
    expect(r.unauthorizedObjectDetected).toBe(false)
    expect(r.detectedObjects).toEqual([])
  })

  it("phone AND book together -> both detected at the pure layer (precedence handled upstream)", () => {
    const preds = [{ class: "cell phone", score: 0.8 }, { class: "book", score: 0.7 }]
    const r = classifyObjectPredictions(preds)
    expect(r.phoneDetected).toBe(true)
    expect(r.unauthorizedObjectDetected).toBe(true) // both detected; precedence handled upstream
  })

  it("removed class (keyboard) -> unauthorizedObjectDetected false", () => {
    const preds = [{ class: "keyboard", score: 0.9 }]
    const r = classifyObjectPredictions(preds)
    expect(r.phoneDetected).toBe(false)
    expect(r.unauthorizedObjectDetected).toBe(false)
  })

  it("removed routine desk classes (mouse, tv, monitor) -> unauthorizedObjectDetected false", () => {
    const preds = [
      { class: "mouse", score: 0.9 },
      { class: "tv", score: 0.85 },
      { class: "monitor", score: 0.8 }, // not a COCO class, but must never match
    ]
    const r = classifyObjectPredictions(preds)
    expect(r.unauthorizedObjectDetected).toBe(false)
    expect(r.phoneDetected).toBe(false)
  })
})

describe("ml-geometry — object consecutive-tick gate and precedence", () => {
  it("single positive tick -> no fire; second consecutive tick -> fire", () => {
    let t = updateObjectTicks(initialObjectTickState(), { phoneDetected: true, unauthorizedObjectDetected: false }, OBJECT_CONSECUTIVE_TICKS)
    expect(t.emitPhone).toBe(false)
    t = updateObjectTicks(t.state, { phoneDetected: true, unauthorizedObjectDetected: false }, OBJECT_CONSECUTIVE_TICKS)
    expect(t.emitPhone).toBe(true)
    expect(t.state.phoneTicks).toBe(2)
  })

  it("positive-negative-positive -> no fire (ticks are consecutive, not cumulative)", () => {
    let t = initialObjectTickState()
    const phone = { phoneDetected: true, unauthorizedObjectDetected: false }
    const none = { phoneDetected: false, unauthorizedObjectDetected: false }
    t = updateObjectTicks(t, phone, OBJECT_CONSECUTIVE_TICKS).state
    t = updateObjectTicks(t, none, OBJECT_CONSECUTIVE_TICKS).state
    const r = updateObjectTicks(t, phone, OBJECT_CONSECUTIVE_TICKS)
    expect(r.state.phoneTicks).toBe(1)
    expect(r.emitPhone).toBe(false)
  })

  it("unauthorized_object has the same consecutive-tick gate", () => {
    let t = updateObjectTicks(initialObjectTickState(), { phoneDetected: false, unauthorizedObjectDetected: true }, OBJECT_CONSECUTIVE_TICKS)
    expect(t.emitUnauthorized).toBe(false)
    t = updateObjectTicks(t.state, { phoneDetected: false, unauthorizedObjectDetected: true }, OBJECT_CONSECUTIVE_TICKS)
    expect(t.emitUnauthorized).toBe(true)
  })

  it("PRECEDENCE: unauthorized_object is suppressed while a phone is detected", () => {
    const both = { phoneDetected: true, unauthorizedObjectDetected: true }
    let t = updateObjectTicks(initialObjectTickState(), both, OBJECT_CONSECUTIVE_TICKS)
    expect(t.state.phoneTicks).toBe(1)
    expect(t.state.unauthorizedTicks).toBe(0) // phone wins; unauthorized never accumulates
    t = updateObjectTicks(t.state, both, OBJECT_CONSECUTIVE_TICKS)
    expect(t.emitPhone).toBe(true)
    expect(t.emitUnauthorized).toBe(false)
  })
})

describe("ml-geometry — object gate timeline (regression for the revived scan interval)", () => {
  // The React effect-churn bug prevented the object-detection setInterval from
  // ever firing, so the gate's MULTI-TICK behaviour (the part that only matters
  // once the loop actually runs tick after tick) was never exercised end to
  // end. These lock that behaviour: a steady LEVEL signal while an item stays
  // visible, a clean re-arm when it leaves and returns, and a fresh unauthorized
  // gate after a phone clears. The effect lifecycle itself is not unit-testable
  // in this node/no-jsdom suite and remains human-verified in Chrome.
  const phone = { phoneDetected: true, unauthorizedObjectDetected: false }
  const none = { phoneDetected: false, unauthorizedObjectDetected: false }
  const book = { phoneDetected: false, unauthorizedObjectDetected: true }

  it("sustained detection emits on EVERY tick at/after the gate (LEVEL signal, not one-shot)", () => {
    let state = initialObjectTickState()
    const emissions: boolean[] = []
    for (let i = 1; i <= 6; i++) {
      const r = updateObjectTicks(state, phone, OBJECT_CONSECUTIVE_TICKS)
      state = r.state
      emissions.push(r.emitPhone)
    }
    // Suppressed until the gate, then true on every subsequent tick — this is
    // what keeps a persistently-visible phone re-emitting (throttled by the
    // hook's snapshot cooldown), instead of firing exactly once.
    expect(emissions.slice(0, OBJECT_CONSECUTIVE_TICKS - 1).some(Boolean)).toBe(false)
    expect(emissions.slice(OBJECT_CONSECUTIVE_TICKS - 1).every(Boolean)).toBe(true)
    expect(state.phoneTicks).toBe(6)
  })

  it("object leaves then returns -> gate re-arms and needs the full consecutive count again", () => {
    let state = initialObjectTickState()
    // First appearance reaches the gate.
    for (let i = 0; i < OBJECT_CONSECUTIVE_TICKS; i++) {
      state = updateObjectTicks(state, phone, OBJECT_CONSECUTIVE_TICKS).state
    }
    // Leaves for one tick: counter resets, no emission.
    const gap = updateObjectTicks(state, none, OBJECT_CONSECUTIVE_TICKS)
    expect(gap.emitPhone).toBe(false)
    expect(gap.state.phoneTicks).toBe(0)
    state = gap.state
    // Returns: the first tick back must NOT emit (re-arming from zero)...
    const back1 = updateObjectTicks(state, phone, OBJECT_CONSECUTIVE_TICKS)
    expect(back1.emitPhone).toBe(false)
    state = back1.state
    // ...and it emits again only once the gate is re-reached.
    let reFired = false
    for (let i = 1; i < OBJECT_CONSECUTIVE_TICKS; i++) {
      const r = updateObjectTicks(state, phone, OBJECT_CONSECUTIVE_TICKS)
      reFired = r.emitPhone
      state = r.state
    }
    expect(reFired).toBe(true)
  })

  it("phone -> book handover: the unauthorized gate arms fresh after the phone clears", () => {
    let state = initialObjectTickState()
    // Phone dominates: under precedence, unauthorized ticks never accumulate.
    for (let i = 0; i < OBJECT_CONSECUTIVE_TICKS; i++) {
      state = updateObjectTicks(state, phone, OBJECT_CONSECUTIVE_TICKS).state
    }
    expect(state.unauthorizedTicks).toBe(0)
    // Phone gone, book now visible: phone counter clears, unauthorized starts
    // from 1 and must still climb the full gate before emitting.
    const first = updateObjectTicks(state, book, OBJECT_CONSECUTIVE_TICKS)
    expect(first.state.phoneTicks).toBe(0)
    expect(first.emitUnauthorized).toBe(false)
    state = first.state
    let emitted = false
    for (let i = 1; i < OBJECT_CONSECUTIVE_TICKS; i++) {
      const r = updateObjectTicks(state, book, OBJECT_CONSECUTIVE_TICKS)
      emitted = r.emitUnauthorized
      state = r.state
    }
    expect(emitted).toBe(true)
  })
})

describe("ml-geometry — legacy constants removed", () => {
  it("legacy threshold constants are no longer exported from proctoring.config", () => {
    // Two competing threshold systems must not coexist with the live one.
    const cfg = config as unknown as Record<string, unknown>
    expect(cfg.GAZE_YAW_THRESHOLD).toBeUndefined()
    expect(cfg.GAZE_PITCH_THRESHOLD).toBeUndefined()
    expect(cfg.GAZE_PITCH_NEUTRAL_RATIO).toBeUndefined()
    expect(cfg.GAZE_PITCH_RATIO_THRESHOLD).toBeUndefined()
    // The live system must still be there.
    expect(typeof config.HEAD_YAW_RATIO_THRESHOLD).toBe("number")
    expect(typeof config.GAZE_FH_DEVIATION_THRESHOLD).toBe("number")
  })
})
