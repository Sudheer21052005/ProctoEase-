import type { Landmark } from "@/lib/ml-geometry"

/** Helper to create a minimal landmark set with only required indices populated. */
export function makeLandmarks(overrides: Partial<Record<number, { x: number; y: number }>> = {}): Landmark[] {
  // Base neutral forward-facing face (normalized coordinates)
  const base: Record<number, { x: number; y: number }> = {
    1:   { x: 0.5,   y: 0.50 }, // nose tip
    10:  { x: 0.5,   y: 0.30 }, // forehead
    33:  { x: 0.42,  y: 0.45 }, // left eye outer
    152: { x: 0.5,   y: 0.70 }, // chin
    263: { x: 0.58,  y: 0.45 }, // right eye outer
  }
  const merged = { ...base, ...overrides }
  const arr: Landmark[] = []
  for (let i = 0; i < 468; i++) {
    arr.push({ x: 0, y: 0 })
  }
  for (let i = 0; i < 468; i++) {
    if (Object.prototype.hasOwnProperty.call(merged, i)) {
      arr[i] = merged[i] as Landmark
    }
  }
  return arr
}

/**
 * Nose-tip x that yields the requested yawRatio against the fixture's
 * interocular span (0.58 - 0.42 = 0.16).
 */
export function noseXForYawRatio(yawRatio: number): number {
  return 0.5 + yawRatio * 0.16
}

/**
 * Face whose projected chin-to-forehead height is shrunk by `shrinkFraction`
 * (0.15 = 15% shorter), centred on the same face midpoint (0.5, 0.5) with
 * the eyes untouched (interocular stays 0.16). Its fhRatio is
 * 2.5 * (1 - shrinkFraction), so the deviation against the neutral
 * baseline 2.5 is exactly -shrinkFraction.
 */
export function makePitchedFace(shrinkFraction: number, yawNoseX = 0.5): Landmark[] {
  const fh = 0.4 * (1 - shrinkFraction)
  return makeLandmarks({
    1: { x: yawNoseX, y: 0.5 },
    10: { x: 0.5, y: 0.5 - fh / 2 },
    152: { x: 0.5, y: 0.5 + fh / 2 },
  })
}