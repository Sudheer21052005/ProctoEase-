/**
 * Guards the contract that `audio_anomaly` travels the EXISTING violation
 * pipeline rather than a parallel one:
 *
 *   audio_anomaly → canonical catalog → gate rules → proctoring store
 *
 * The frontend catalog mirrors `app/config/violation_guidelines.py`, and the
 * backend rejects any event_type outside it, so a drift here is a runtime
 * failure at exam time. These assertions are the cheap early warning.
 */

import { beforeEach, describe, expect, it } from "vitest"

import {
  BASE_VIOLATION_TYPES,
  CANONICAL_VIOLATION_TYPES,
  NON_GATING_VIOLATION_TYPES,
  countsTowardGate,
} from "@/lib/proctoring.catalog"
import { MAX_VIOLATIONS } from "@/lib/constants"
import { MAX_VIOLATIONS as CONFIG_MAX_VIOLATIONS } from "@/lib/proctoring.config"
import { useProctoringStore } from "@/stores/proctoring.store"

describe("audio_anomaly in the canonical violation catalog", () => {
  it("is a canonical type", () => {
    expect(CANONICAL_VIOLATION_TYPES).toContain("audio_anomaly")
  })

  it("is a BASE type, matching the backend catalog", () => {
    // Backend BASE_VIOLATIONS contains audio_anomaly; if this moves to DERIVED
    // the mirror has drifted from app/config/violation_guidelines.py.
    expect(BASE_VIOLATION_TYPES).toContain("audio_anomaly")
  })

  it("counts toward the termination gate", () => {
    expect(countsTowardGate("audio_anomaly")).toBe(true)
    expect(NON_GATING_VIOLATION_TYPES.has("audio_anomaly")).toBe(false)
  })

  it("does not introduce a duplicate catalog entry", () => {
    const audioEntries = CANONICAL_VIOLATION_TYPES.filter((t) => t === "audio_anomaly")
    expect(audioEntries).toHaveLength(1)
    // And no duplicates anywhere in the catalog.
    expect(new Set(CANONICAL_VIOLATION_TYPES).size).toBe(CANONICAL_VIOLATION_TYPES.length)
  })

  it("fits the backend event_type column (String(30))", () => {
    for (const type of CANONICAL_VIOLATION_TYPES) {
      expect(type.length).toBeLessThanOrEqual(30)
    }
  })
})

describe("audio_anomaly through the existing proctoring store", () => {
  beforeEach(() => {
    useProctoringStore.getState().reset()
  })

  it("is recorded in history and consumes the violation budget", () => {
    const store = useProctoringStore.getState()
    store.addViolation("audio_anomaly", "Sustained speech or background noise detected")

    const next = useProctoringStore.getState()
    expect(next.violations).toHaveLength(1)
    expect(next.violations[0].type).toBe("audio_anomaly")
    expect(next.violationCount).toBe(1)
    // Unlike periodic_check, the candidate is warned.
    expect(next.showWarning).toBe(true)
    expect(next.warningMessage).toContain(`1/${MAX_VIOLATIONS}`)
  })

  it("reaches the termination gate after MAX_VIOLATIONS events", () => {
    const store = useProctoringStore.getState()
    for (let i = 0; i < MAX_VIOLATIONS; i++) {
      store.addViolation("audio_anomaly", "noise")
    }
    expect(useProctoringStore.getState().violationCount).toBe(MAX_VIOLATIONS)
    expect(useProctoringStore.getState().isMaxViolations()).toBe(true)
  })

  it("still exempts periodic_check from the gate (Phase 1 regression guard)", () => {
    const store = useProctoringStore.getState()
    store.addViolation("periodic_check", "routine snapshot")

    const next = useProctoringStore.getState()
    expect(next.violations).toHaveLength(1)
    expect(next.violationCount).toBe(0)
    expect(next.showWarning).toBe(false)
  })
})

describe("MAX_VIOLATIONS centralisation", () => {
  it("resolves to the same value through both import paths", () => {
    // constants.ts now re-exports from proctoring.config.ts; a divergence here
    // would mean two competing gate limits.
    expect(MAX_VIOLATIONS).toBe(CONFIG_MAX_VIOLATIONS)
    expect(MAX_VIOLATIONS).toBe(12)
  })
})
