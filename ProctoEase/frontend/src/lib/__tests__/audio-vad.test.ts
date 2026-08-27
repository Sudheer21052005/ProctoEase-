/**
 * STEP 7 test matrix for the adaptive energy VAD (`lib/audio-detection.ts`).
 *
 * Fifteen synthetic signals are pushed through the real evaluator and the real
 * `startAudioMonitor` wiring. No microphone and no browser are involved: levels
 * are numbers, so every case is deterministic and every assertion is about the
 * detector's decisions rather than about audio.
 *
 * Naming note: these test SUSTAINED AUDIO ACTIVITY, not speech recognition. A
 * case called "normal speech" is a synthetic level profile shaped like speech;
 * the detector cannot tell it from any other sound at the same level, which is
 * exactly what case 11 pins down.
 */

import { describe, expect, it, vi } from "vitest"

import {
  createAudioAnomalyEvaluator,
  startAudioMonitor,
  type AudioAnomalyDecision,
  type AudioEvaluatorConfig,
  type AudioMonitorDeps,
} from "@/lib/audio-detection"
import {
  AUDIO_COOLDOWN_MS,
  AUDIO_FRAME_MS,
  AUDIO_MIN_ENTER_RMS,
  AUDIO_SUSTAINED_MS,
} from "@/lib/proctoring.config"

// ─────────────────────────────────────────────────────────────────────────────
// Signal levels, taken from the captured Chrome session so the synthetic cases
// sit where the real measurements sat.
//
//   silence / noise floor  ~0.0055 (8-bit) — real float floor is lower
//   quiet speech            0.040 – 0.079  (this is the band the OLD fixed
//                                           0.08 threshold cut through)
//   normal speech           0.10  – 0.28
//   loud speech             0.35  – 0.52
// ─────────────────────────────────────────────────────────────────────────────

const FLOOR = 0.0055
const VERY_QUIET = 0.030 // whisper: above the floor, below the old 0.08 bar
const QUIET = 0.055
const NORMAL = 0.150
const LOUD = 0.420

const CFG = { frameMs: AUDIO_FRAME_MS }
const FRAMES_PER_SEC = 1_000 / AUDIO_FRAME_MS

/** Frames needed to hold a level for `ms`. */
function framesFor(ms: number): number {
  return Math.ceil(ms / AUDIO_FRAME_MS)
}

/**
 * Drive the evaluator with a level sequence, returning every decision.
 * The clock advances by exactly one frame per push, matching the sampler.
 */
function run(levels: number[], overrides: Partial<AudioEvaluatorConfig> = {}) {
  const evaluator = createAudioAnomalyEvaluator({ ...CFG, ...overrides })
  const decisions: AudioAnomalyDecision[] = []
  let clock = 0
  for (const level of levels) {
    decisions.push(evaluator.push(level, clock))
    clock += AUDIO_FRAME_MS
  }
  return {
    decisions,
    fires: decisions.filter((d) => d.fire),
    reasons: decisions.map((d) => (d.fire ? "FIRE" : d.reason)),
    last: decisions[decisions.length - 1],
  }
}

/** `count` frames at `level`. */
function hold(level: number, count: number): number[] {
  return Array.from({ length: count }, () => level)
}

/** Enough quiet frames to complete calibration and settle the noise floor. */
function calibration(level = FLOOR): number[] {
  return hold(level, framesFor(4_000))
}

// ─────────────────────────────────────────────────────────────────────────────

describe("VAD matrix: silence and non-speech", () => {
  it("1. silence never fires", () => {
    const { fires, last } = run([...calibration(), ...hold(FLOOR, framesFor(30_000))])

    expect(fires).toHaveLength(0)
    expect(last.metrics.state).toBe("idle")
    // The floor tracks the actual input rather than sitting at a fixed guess.
    expect(last.metrics.noiseFloor).toBeCloseTo(FLOOR, 4)
  })

  it("9. keyboard typing does not fire", () => {
    // ~4 keystrokes/sec: one frame of transient, then back to the floor. Each
    // click is above ENTER, and over 20s it accumulates far more than 3s of
    // above-exit time — but never an unbroken 400 ms run, so it never promotes
    // out of `candidate`. This is what the contiguous-run rule buys.
    const typing: number[] = []
    for (let i = 0; i < framesFor(20_000); i++) {
      typing.push(i % 2 === 0 ? 0.14 : FLOOR)
    }
    const { fires, decisions } = run([...calibration(), ...typing])

    expect(fires).toHaveLength(0)
    const states = new Set(decisions.map((d) => d.metrics.state))
    expect(states.has("candidate")).toBe(true)
    expect(states.has("speaking")).toBe(false)
    // Accumulated voiced time alone would have been enough to fire.
    const maxVoiced = Math.max(...decisions.map((d) => d.metrics.voicedMs))
    expect(maxVoiced).toBeGreaterThan(AUDIO_SUSTAINED_MS)
  })

  it("9b. promotion requires a contiguous run, not an accumulated total", () => {
    const { decisions } = run([
      ...calibration(),
      // 3 frames on, 1 off, repeated: the run resets before reaching 400 ms.
      ...Array.from({ length: framesFor(20_000) }, (_, i) => (i % 4 === 3 ? FLOOR : 0.20)),
    ])

    // 3 frames = 375 ms < AUDIO_MIN_ACTIVITY_MS, so no promotion and no fire.
    expect(decisions.filter((d) => d.fire)).toHaveLength(0)
    expect(Math.max(...decisions.map((d) => d.metrics.runMs))).toBe(375)

    // One more contiguous frame per burst clears 400 ms and it does fire.
    const { fires } = run([
      ...calibration(),
      ...Array.from({ length: framesFor(20_000) }, (_, i) => (i % 5 === 4 ? FLOOR : 0.20)),
    ])
    expect(fires.length).toBeGreaterThanOrEqual(1)
  })

  it("10. continuous fan noise does not fire — the floor adapts to it", () => {
    // A steady 0.018 hum: calibration measures it, so ENTER moves above it.
    const fan = 0.018
    const { fires, last } = run([...calibration(fan), ...hold(fan, framesFor(60_000))])

    expect(fires).toHaveLength(0)
    expect(last.metrics.noiseFloor).toBeCloseTo(fan, 4)
    expect(last.metrics.enterThreshold).toBeGreaterThan(fan)
  })

  it("10b. a fan starting mid-exam raises the floor instead of firing forever", () => {
    const fan = 0.019
    // Calibrate on true silence, then the fan switches on and never stops.
    const { fires, last } = run([...calibration(), ...hold(fan, framesFor(90_000))])

    // 0.019 is below AUDIO_MIN_ENTER_RMS, so it never opens a segment at all
    // and every frame keeps feeding the noise-floor estimate.
    expect(AUDIO_MIN_ENTER_RMS).toBeGreaterThan(fan)
    expect(fires).toHaveLength(0)
    expect(last.metrics.noiseFloor).toBeCloseTo(fan, 4)
  })
})

describe("VAD matrix: short transients are rejected", () => {
  it("7. one cough does not fire", () => {
    // A cough is loud but ~250 ms — under AUDIO_MIN_ACTIVITY_MS.
    const { fires, reasons } = run([
      ...calibration(),
      ...hold(0.38, framesFor(250)),
      ...hold(FLOOR, framesFor(5_000)),
    ])

    expect(fires).toHaveLength(0)
    // It opened a segment, then the segment was discarded as a transient.
    expect(reasons).toContain("candidate")
    expect(reasons).toContain("segment_ended")
  })

  it("7b. a discarded transient is reported as unqualified", () => {
    const { decisions } = run([
      ...calibration(),
      ...hold(0.38, framesFor(250)),
      ...hold(FLOOR, framesFor(5_000)),
    ])

    const closed = decisions.map((d) => (d.fire ? undefined : d.closedSegment)).filter(Boolean)
    expect(closed).toHaveLength(1)
    expect(closed[0]!.qualified).toBe(false)
    expect(closed[0]!.voicedMs).toBeLessThan(AUDIO_SUSTAINED_MS)
  })

  it("8. one desk tap does not fire", () => {
    // A tap is a single-frame impulse, even a very loud one.
    const { fires } = run([
      ...calibration(),
      ...hold(0.90, 1),
      ...hold(FLOOR, framesFor(5_000)),
    ])

    expect(fires).toHaveLength(0)
  })

  it("8b. several separated taps still do not fire", () => {
    const taps: number[] = []
    for (let i = 0; i < 12; i++) {
      taps.push(...hold(0.85, 1), ...hold(FLOOR, framesFor(2_000)))
    }
    const { fires } = run([...calibration(), ...taps])

    expect(fires).toHaveLength(0)
  })
})

describe("VAD matrix: sustained voice activity fires", () => {
  it("2. very quiet speech (whisper) fires — the old fixed 0.08 missed this", () => {
    // 0.030 is well under the retired AUDIO_RMS_THRESHOLD of 0.08.
    expect(VERY_QUIET).toBeLessThan(0.08)

    const { fires } = run([...calibration(), ...hold(VERY_QUIET, framesFor(20_000))])

    expect(fires.length).toBeGreaterThanOrEqual(1)
  })

  it("3. quiet normal speech fires", () => {
    expect(QUIET).toBeLessThan(0.08)

    const { fires } = run([...calibration(), ...hold(QUIET, framesFor(20_000))])

    expect(fires.length).toBeGreaterThanOrEqual(1)
  })

  it("4. normal speech fires once within ~3s of voiced audio", () => {
    const speech = hold(NORMAL, framesFor(AUDIO_SUSTAINED_MS) + 2)
    const { fires, reasons } = run([...calibration(), ...speech])

    expect(fires).toHaveLength(1)
    expect(fires[0].fire && fires[0].durationMs).toBeGreaterThanOrEqual(AUDIO_SUSTAINED_MS)
    // Detection latency: the fire lands at the first frame after 3s of voice.
    const fireIndex = reasons.indexOf("FIRE")
    const speechStart = calibration().length
    expect((fireIndex - speechStart) / FRAMES_PER_SEC).toBeLessThanOrEqual(3.2)
  })

  it("5. loud speech fires", () => {
    const { fires } = run([...calibration(), ...hold(LOUD, framesFor(5_000))])

    expect(fires).toHaveLength(1)
    expect(fires[0].fire && fires[0].peakLevel).toBeCloseTo(LOUD, 4)
  })

  it("6. speech with short pauses counts as ONE segment", () => {
    // "hello" … 1s pause … "I am answering" — the pause is inside tolerance,
    // so voiced time carries across it instead of restarting.
    const withPauses = [
      ...hold(NORMAL, framesFor(1_500)),
      ...hold(FLOOR, framesFor(1_000)),
      ...hold(NORMAL, framesFor(1_500)),
      ...hold(FLOOR, framesFor(1_000)),
      ...hold(NORMAL, framesFor(1_500)),
    ]
    const { fires, decisions } = run([...calibration(), ...withPauses])

    expect(fires).toHaveLength(1)
    // One segment: no segment ever closed before the fire.
    const fireIndex = decisions.findIndex((d) => d.fire)
    const closedBeforeFire = decisions
      .slice(0, fireIndex)
      .some((d) => !d.fire && d.closedSegment !== undefined)
    expect(closedBeforeFire).toBe(false)
    // And the wall-clock span exceeds the voiced time, because pauses count
    // toward the segment but not toward the 3s bar.
    expect(fires[0].fire && fires[0].segmentMs).toBeGreaterThan(
      fires[0].fire ? fires[0].durationMs : 0
    )
  })

  it("6b. a pause longer than tolerance splits the segment and prevents firing", () => {
    // 2s of voice, a 3s gap, 2s of voice: neither half reaches 3s alone.
    const { fires, decisions } = run([
      ...calibration(),
      ...hold(NORMAL, framesFor(2_000)),
      ...hold(FLOOR, framesFor(3_000)),
      ...hold(NORMAL, framesFor(2_000)),
    ])

    expect(fires).toHaveLength(0)
    const closed = decisions.map((d) => (d.fire ? undefined : d.closedSegment)).filter(Boolean)
    expect(closed).toHaveLength(1)
    expect(closed[0]!.qualified).toBe(true)
  })

  it("11. sustained non-speech audio ALSO fires — an energy detector cannot tell", () => {
    // A television or a fan ramping to speech level is indistinguishable from a
    // voice to this detector. Pinned as a test so the limitation is documented
    // in code rather than only in prose.
    const television = hold(0.22, framesFor(10_000))
    const { fires } = run([...calibration(), ...television])

    expect(fires.length).toBeGreaterThanOrEqual(1)
  })
})

describe("VAD matrix: cooldown", () => {
  it("12. continuous talking is rate-limited by the cooldown", () => {
    // 60s of unbroken speech. Voiced time crosses 3s every 3s, but the cooldown
    // allows at most one event per AUDIO_COOLDOWN_MS.
    const { fires } = run([...calibration(), ...hold(NORMAL, framesFor(60_000))])

    const maxPossible = Math.floor(60_000 / AUDIO_COOLDOWN_MS) + 1
    expect(fires.length).toBeGreaterThanOrEqual(1)
    expect(fires.length).toBeLessThanOrEqual(maxPossible)
  })

  it("12b. a second event needs both the cooldown AND fresh voiced audio", () => {
    const evaluator = createAudioAnomalyEvaluator(CFG)
    let clock = 0
    const push = (level: number) => {
      const d = evaluator.push(level, clock)
      clock += AUDIO_FRAME_MS
      return d
    }

    for (const level of calibration()) push(level)

    let fires = 0
    for (let i = 0; i < framesFor(AUDIO_SUSTAINED_MS) + 2; i++) {
      if (push(NORMAL).fire) fires += 1
    }
    expect(fires).toBe(1)

    // Immediately after firing, more speech is suppressed.
    for (let i = 0; i < framesFor(AUDIO_SUSTAINED_MS) + 2; i++) {
      if (push(NORMAL).fire) fires += 1
    }
    expect(fires).toBe(1)
  })
})

describe("VAD matrix: wiring, failure and cleanup", () => {
  /**
   * Fake browser surface. The analyser synthesises a square wave at the
   * requested level, so `computeRmsFloat` sees a real waveform.
   */
  function makeHarness(overrides: Partial<AudioMonitorDeps> = {}) {
    let currentLevel = 0
    let clock = 1_000
    let sampler: (() => void) | null = null
    const state = { trackStops: 0, contextClosed: 0, intervalsCleared: 0 }

    const track = {
      label: "Fake Microphone",
      readyState: "live",
      enabled: true,
      muted: false,
      getSettings: () => ({ sampleRate: 48_000, channelCount: 1 }),
      stop: () => {
        state.trackStops += 1
      },
    }

    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream

    const analyser = {
      fftSize: 32,
      smoothingTimeConstant: 0.8,
      getFloatTimeDomainData: (buffer: Float32Array) => {
        for (let i = 0; i < buffer.length; i++) {
          buffer[i] = i % 2 === 0 ? -currentLevel : currentLevel
        }
      },
      disconnect: () => {},
    }

    const source = { connect: () => {}, disconnect: () => {} }

    const audioContext = {
      state: "running" as AudioContextState,
      sampleRate: 48_000,
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
      setInterval: (fn) => {
        sampler = fn
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval: () => {
        state.intervalsCleared += 1
        sampler = null
      },
      now: () => clock,
      ...overrides,
    }

    return {
      deps,
      state,
      isSampling: () => sampler !== null,
      /** Hold `level` for `ms` of frames. */
      feed: (level: number, ms: number) => {
        currentLevel = level
        for (let i = 0; i < framesFor(ms); i++) {
          sampler?.()
          clock += AUDIO_FRAME_MS
        }
      },
    }
  }

  it("13. an unavailable microphone degrades instead of throwing", async () => {
    for (const [name, expected] of [
      ["NotAllowedError", "permission_denied"],
      ["NotFoundError", "no_device"],
      ["AbortError", "error"],
    ] as const) {
      const harness = makeHarness({
        getUserMedia: () => Promise.reject(Object.assign(new Error(name), { name })),
      })
      const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe(expected)
    }
  })

  it("13b. a stream with no audio track is released, not left open", async () => {
    let stopped = 0
    const track = { stop: () => (stopped += 1) }
    const harness = makeHarness({
      getUserMedia: () =>
        Promise.resolve({
          getAudioTracks: () => [],
          getTracks: () => [track],
        } as unknown as MediaStream),
    })
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no_device")
    expect(stopped).toBe(1)
  })

  it("14. stop() releases the AudioContext, analyser, stream and timer exactly once", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(harness.isSampling()).toBe(true)

    result.handle.stop()
    result.handle.stop() // idempotent

    expect(harness.state.intervalsCleared).toBe(1)
    expect(harness.state.trackStops).toBe(1)
    expect(harness.state.contextClosed).toBe(1)
    expect(harness.isSampling()).toBe(false)
  })

  it("14b. no anomaly can fire after stop()", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly, deps: harness.deps })
    if (!result.ok) throw new Error("monitor failed to start")

    harness.feed(FLOOR, 4_000)
    result.handle.stop()
    harness.feed(LOUD, 30_000)

    expect(onAnomaly).not.toHaveBeenCalled()
  })

  it("15. exactly one anomaly reaches the pipeline callback for one utterance", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly, deps: harness.deps })
    if (!result.ok) throw new Error("monitor failed to start")

    harness.feed(FLOOR, 4_000) // calibrate
    expect(onAnomaly).not.toHaveBeenCalled()

    harness.feed(NORMAL, AUDIO_SUSTAINED_MS + 500) // one utterance
    expect(onAnomaly).toHaveBeenCalledTimes(1)

    // The payload the hook forwards to reportViolation: numbers only.
    const details = onAnomaly.mock.calls[0][0]
    expect(Object.keys(details).sort()).toEqual([
      "activityRatio",
      "averageLevel",
      "durationMs",
      "exitThreshold",
      "noiseFloor",
      "peakLevel",
      "segmentMs",
      "threshold",
    ])
    for (const value of Object.values(details)) {
      expect(typeof value).toBe("number")
      expect(Number.isFinite(value)).toBe(true)
    }

    result.handle.stop()
  })
})
