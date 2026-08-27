/**
 * Exercises the audio VAD debug instrumentation with ENABLE_AUDIO_DEBUG forced
 * on (the shipped value is `false`).
 *
 * Two things are asserted:
 *   1. The expected diagnostic lines are emitted — start-up snapshot, per-frame
 *      metrics, state transitions, closed segments, the fired block, teardown —
 *      so the human Chrome procedure is looking for output that actually exists.
 *   2. Turning the flag on does NOT change any detection outcome, and nothing
 *      resembling audio content reaches the console.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/proctoring.config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/proctoring.config")>()
  return { ...actual, ENABLE_AUDIO_DEBUG: true }
})

import {
  createAudioAnomalyEvaluator,
  startAudioMonitor,
  type AudioEvaluatorConfig,
  type AudioMonitorDeps,
} from "@/lib/audio-detection"
import {
  AUDIO_CALIBRATION_MS,
  AUDIO_COOLDOWN_MS,
  AUDIO_ENTER_MULTIPLIER,
  AUDIO_EXIT_MULTIPLIER,
  AUDIO_FFT_SIZE,
  AUDIO_FRAME_MS,
  AUDIO_MIN_ACTIVITY_MS,
  AUDIO_MIN_ENTER_RMS,
  AUDIO_MIN_EXIT_RMS,
  AUDIO_PAUSE_TOLERANCE_MS,
  AUDIO_SUSTAINED_MS,
} from "@/lib/proctoring.config"

/**
 * Fast evaluator config, mirroring `audio-detection.test.ts`:
 *   5 calibration frames · 3 frames promote · 10 voiced frames fire ·
 *   the 6th quiet frame closes a segment.
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
/** Digital silence → floor clamps to minNoiseFloor, ENTER 0.02, EXIT 0.012. */
const SILENT = 0
const LOUD = 0.4

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

/** Every console.log argument list, flattened to strings. */
function lines(): string[] {
  return logSpy.mock.calls.map((call: unknown[]) =>
    call.map((arg: unknown) => String(arg)).join(" ")
  )
}

function audioLines(): string[] {
  return lines().filter((l) => l.startsWith("[AUDIO DEBUG]"))
}

/**
 * Fake browser surface with a realistic-enough audio track that the start-up
 * snapshot can read label / readyState / getSettings, and a float analyser that
 * synthesises a square wave at the requested level.
 */
function makeHarness(overrides: Partial<AudioMonitorDeps> = {}) {
  let currentLevel = 0
  let clock = 1_000
  let sampler: (() => void) | null = null
  const state = { trackStops: 0, contextClosed: 0, intervalsCleared: 0 }

  const track = {
    label: "Fake Microphone Array",
    readyState: "live",
    enabled: true,
    muted: false,
    getSettings: () => ({
      sampleRate: 48_000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }),
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

  const destination = {}
  const source = { connect: () => {}, disconnect: () => {} }

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
    /** One frame at `level`, without advancing the clock. */
    tick: (level: number) => {
      currentLevel = level
      sampler?.()
    },
    /** `count` frames at `level`, advancing one frame period each. */
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
function fastOptions(harness: ReturnType<typeof makeHarness>, onAnomaly = () => {}) {
  return {
    onAnomaly,
    deps: harness.deps,
    evaluator: createAudioAnomalyEvaluator(CFG),
    frameMs: FRAME_MS,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Start-up snapshot — asserted against the SHIPPED config, so the monitor is
// started with no overrides here.
// ─────────────────────────────────────────────────────────────────────────────

describe("start-up snapshot", () => {
  it("logs the microphone and its browser-side processing", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })
    expect(result.ok).toBe(true)

    const out = audioLines()
    expect(out.some((l) => l.includes("microphone started"))).toBe(true)
    expect(out.some((l) => l.includes('device="Fake Microphone Array"'))).toBe(true)
    expect(out.some((l) => l.includes("readyState=live"))).toBe(true)
    expect(out.some((l) => l.includes("muted=false"))).toBe(true)
    // Browser-side processing gates the signal between words, which is what
    // defeated the previous duty-cycle detector — it must stay visible.
    expect(out.some((l) => l.includes("echoCancellation=true"))).toBe(true)
    expect(out.some((l) => l.includes("noiseSuppression=true"))).toBe(true)
    expect(out.some((l) => l.includes("autoGainControl=true"))).toBe(true)
    expect(out.some((l) => l.includes("sampleRate=48000"))).toBe(true)

    if (result.ok) result.handle.stop()
  })

  it("logs the data path and the analyser's coverage of the frame period", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })

    const line = audioLines().find((l) => l.includes("dataPath="))
    expect(line).toBeDefined()
    expect(line).toContain("dataPath=float32")
    expect(line).toContain(`fftSize=${AUDIO_FFT_SIZE}`)
    expect(line).toContain(`frameMs=${AUDIO_FRAME_MS}`)

    // 8192 @ 48kHz = 170.7ms of audio per 125ms frame. Coverage below 1.0 would
    // mean audio falling between frames, unseen.
    const coverage = Number(/coverage=([\d.]+)x/.exec(line ?? "")?.[1])
    expect(coverage).toBeGreaterThanOrEqual(1)
    expect(line).toContain("analyserWindowMs=170.7")

    if (result.ok) result.handle.stop()
  })

  it("logs the effective VAD configuration so the live values are auditable", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })

    const block = audioLines().join("\n")
    expect(block).toContain(`calibrationMs=${AUDIO_CALIBRATION_MS}`)
    expect(block).toContain(
      `calibrationFrames=${Math.round(AUDIO_CALIBRATION_MS / AUDIO_FRAME_MS)}`
    )
    expect(block).toContain("noisePercentile=0.5")
    expect(block).toContain(`enterMult=${AUDIO_ENTER_MULTIPLIER}`)
    expect(block).toContain(`exitMult=${AUDIO_EXIT_MULTIPLIER}`)
    expect(block).toContain(`minEnter=${AUDIO_MIN_ENTER_RMS}`)
    expect(block).toContain(`minExit=${AUDIO_MIN_EXIT_RMS}`)
    expect(block).toContain(`minActivityMs=${AUDIO_MIN_ACTIVITY_MS}`)
    expect(block).toContain(`sustainedMs=${AUDIO_SUSTAINED_MS}`)
    expect(block).toContain(`pauseToleranceMs=${AUDIO_PAUSE_TOLERANCE_MS}`)
    expect(block).toContain(`cooldownMs=${AUDIO_COOLDOWN_MS}`)

    if (result.ok) result.handle.stop()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Per-frame instrumentation
// ─────────────────────────────────────────────────────────────────────────────

describe("per-frame instrumentation", () => {
  it("logs one metrics line per frame with every field", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness))

    logSpy.mockClear()
    harness.tick(SILENT)

    // The very first frame also emits a state-transition line.
    const out = audioLines()
    const frameLines = out.filter((l) => l.includes("rms="))
    expect(frameLines).toHaveLength(1)

    for (const field of [
      "rms=",
      "state=calibrating",
      "floor=",
      "enter=",
      "exit=",
      "voiced=0ms",
      "run=0ms",
      "pause=0ms",
      "seg=0ms",
      "frames=0/0",
      "ratio=",
      "peak=",
      "dt=",
    ]) {
      expect(frameLines[0]).toContain(field)
    }
    expect(frameLines[0]).toContain("(calibrating)")

    if (result.ok) result.handle.stop()
  })

  it("shows the adaptive thresholds it derived, not a fixed number", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness))

    harness.feed(SILENT, CAL_FRAMES)
    logSpy.mockClear()
    harness.tick(SILENT)

    // floor clamped to minNoiseFloor 0.0005 → ENTER 0.02, EXIT 0.012 from the
    // absolute minimums.
    const line = audioLines().find((l) => l.includes("rms="))
    expect(line).toContain("floor=0.00050")
    expect(line).toContain("enter=0.0200")
    expect(line).toContain("exit=0.0120")
    expect(line).toContain("state=idle")

    if (result.ok) result.handle.stop()
  })

  it("tracks a running session peak so a weak microphone is obvious", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness))

    harness.feed(SILENT, 1)
    harness.feed(0.3, 1)
    logSpy.mockClear()
    harness.tick(SILENT)

    // The latest line still remembers the loudest frame of the session.
    expect(audioLines().find((l) => l.includes("rms="))).toContain("peak=0.3000")

    if (result.ok) result.handle.stop()
  })

  it("reports the inter-frame gap, which is how a stalled main thread shows up", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness))

    harness.tick(SILENT)
    // ML model load blocked the main thread for 3.7s in the captured session;
    // dt is how that becomes visible.
    harness.advance(3_675)
    logSpy.mockClear()
    harness.tick(SILENT)

    expect(audioLines().find((l) => l.includes("rms="))).toContain("dt=3675ms")

    if (result.ok) result.handle.stop()
  })

  it("logs a state transition line when calibration completes", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness))

    harness.feed(SILENT, CAL_FRAMES)

    const out = audioLines()
    expect(out.some((l) => l.includes("state (init) -> calibrating"))).toBe(true)

    const armed = out.find((l) => l.includes("state calibrating -> idle"))
    expect(armed).toBeDefined()
    expect(armed).toContain("noiseFloor=0.00050")
    expect(armed).toContain("enter=0.0200")
    expect(armed).toContain("exit=0.0120")
    expect(armed).toContain(`noiseSamples=${CAL_FRAMES}`)
    expect(armed).toContain("timestamp=")

    if (result.ok) result.handle.stop()
  })

  it("logs each state transition exactly once, not once per frame", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness))

    harness.feed(SILENT, CAL_FRAMES)
    harness.feed(LOUD, 10)

    const transitions = audioLines().filter((l) => l.includes("state ") && l.includes(" -> "))
    // (init)->calibrating, calibrating->idle, idle->candidate, candidate->speaking
    expect(transitions).toHaveLength(4)
    expect(transitions[2]).toContain("state idle -> candidate")
    expect(transitions[3]).toContain("state candidate -> speaking")

    if (result.ok) result.handle.stop()
  })

  it("logs a closed-segment summary when a transient is discarded", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness))

    harness.feed(SILENT, CAL_FRAMES)
    logSpy.mockClear()
    harness.feed(LOUD, 2) // 200ms < minActivityMs 300 → never promoted
    harness.feed(SILENT, 6) // the 6th quiet frame exceeds the pause tolerance

    const closed = audioLines().find((l) => l.includes("segment closed"))
    expect(closed).toBeDefined()
    expect(closed).toContain("voicedMs=200")
    expect(closed).toContain("segmentMs=800")
    expect(closed).toContain("frames=2/8")
    expect(closed).toContain("peak=0.4000")
    expect(closed).toContain("qualified=false")
    expect(audioLines().some((l) => l.includes("(segment_ended)"))).toBe(true)

    if (result.ok) result.handle.stop()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Anomaly and teardown
// ─────────────────────────────────────────────────────────────────────────────

describe("anomaly and teardown logging", () => {
  it("logs the ANOMALY FIRED block with every decision input", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness, onAnomaly))

    harness.feed(SILENT, CAL_FRAMES)
    harness.feed(LOUD, 10)

    expect(onAnomaly).toHaveBeenCalledTimes(1)

    const out = audioLines()
    expect(out.some((l) => l.includes("ANOMALY FIRED"))).toBe(true)
    expect(out.some((l) => l.includes("-> FIRE"))).toBe(true)

    const block = out.join("\n")
    expect(block).toContain("voicedMs=1000")
    expect(block).toContain("segmentMs=1000")
    expect(block).toContain("activityRatio=1.00")
    expect(block).toContain("peakLevel=0.4000")
    expect(block).toContain("averageLevel=0.4000")
    expect(block).toContain("noiseFloor=0.00050")
    expect(block).toContain("enterThreshold=0.0200")
    expect(block).toContain("exitThreshold=0.0120")
    expect(block).toContain("timestamp=")

    if (result.ok) result.handle.stop()
  })

  it("logs microphone stopped exactly once on teardown", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    logSpy.mockClear()
    result.handle.stop()
    result.handle.stop()

    expect(audioLines().filter((l) => l.includes("microphone stopped"))).toHaveLength(1)
  })

  it("logs the failure reason when the microphone is refused", async () => {
    const harness = makeHarness({
      getUserMedia: () =>
        Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })),
    })
    const result = await startAudioMonitor({ onAnomaly: () => {}, deps: harness.deps })

    expect(result.ok).toBe(false)
    expect(
      audioLines().some((l) => l.includes("microphone unavailable reason=permission_denied"))
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The flag must be observational only
// ─────────────────────────────────────────────────────────────────────────────

describe("instrumentation is observational", () => {
  it("does not change detection outcomes when logging is on", async () => {
    const onAnomaly = vi.fn()
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness, onAnomaly))

    // Calibration + silence → nothing.
    harness.feed(SILENT, CAL_FRAMES + 10)
    expect(onAnomaly).not.toHaveBeenCalled()

    // Sustained → exactly one event, and continued talking is held off.
    harness.feed(LOUD, 40)
    expect(onAnomaly).toHaveBeenCalledTimes(1)

    // Past the cooldown → a second event.
    harness.advance(Number(CFG.cooldownMs))
    harness.feed(LOUD, 10)
    expect(onAnomaly).toHaveBeenCalledTimes(2)

    if (result.ok) result.handle.stop()
  })

  it("never logs audio content — only scalars and device metadata", async () => {
    const harness = makeHarness()
    const result = await startAudioMonitor(fastOptions(harness))

    harness.feed(SILENT, CAL_FRAMES)
    harness.feed(LOUD, 20)
    harness.feed(SILENT, 10)
    if (result.ok) result.handle.stop()

    // No console.log call may receive a typed array, ArrayBuffer, MediaStream or
    // AudioNode — the only permitted argument type is a string.
    for (const call of logSpy.mock.calls) {
      for (const arg of call as unknown[]) {
        expect(typeof arg).toBe("string")
        expect(ArrayBuffer.isView(arg)).toBe(false)
      }
    }

    // And no line may contain a long run of comma-separated numbers, which is
    // what a leaked sample buffer would look like.
    for (const line of audioLines()) {
      expect(line).not.toMatch(/\d{8,}(,\s*\d+){3,}/)
      expect(line.length).toBeLessThan(400)
    }
  })
})
