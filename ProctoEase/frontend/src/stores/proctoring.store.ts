import { create } from "zustand"
import { MAX_VIOLATIONS } from "@/lib/constants"
import {
  countsTowardGate,
  type CanonicalViolationType,
} from "@/lib/proctoring.catalog"

export interface Violation {
  id: string
  /** Canonical type — see @/lib/proctoring.catalog (mirrors the backend catalog). */
  type: CanonicalViolationType
  timestamp: string
  description: string
}

interface ProctoringState {
  violations: Violation[]
  violationCount: number
  isFullscreen: boolean
  isFullscreenArmed: boolean
  webcamActive: boolean
  showWarning: boolean
  warningMessage: string

  addViolation: (type: Violation["type"], description: string) => void
  setViolationCount: (count: number) => void
  setFullscreen: (v: boolean) => void
  setIsFullscreenArmed: (v: boolean) => void
  setWebcamActive: (v: boolean) => void
  showWarningBanner: (msg: string) => void
  dismissWarning: () => void
  isMaxViolations: () => boolean
  reset: () => void
}

export const useProctoringStore = create<ProctoringState>((set, get) => ({
  violations: [],
  violationCount: 0,
  isFullscreen: false,
  isFullscreenArmed: false,
  webcamActive: false,
  showWarning: false,
  warningMessage: "",

  addViolation: (type, description) => {
    const violation: Violation = {
      id: crypto.randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      description,
    }
    // Non-gating events (e.g. periodic_check) are kept in the local history but
    // must not consume the termination budget or raise a candidate warning.
    // The backend applies the same rule when it acks a violation_count.
    if (!countsTowardGate(type)) {
      set((s) => ({ violations: [...s.violations, violation] }))
      return
    }
    set((s) => ({
      violations: [...s.violations, violation],
      violationCount: s.violationCount + 1,
      showWarning: true,
      warningMessage: `⚠️ Violation: ${description} (${s.violationCount + 1}/${MAX_VIOLATIONS})`,
    }))
  },

  setViolationCount: (count) => set({ violationCount: count }),

  setFullscreen: (v) => set({ isFullscreen: v }),
  setIsFullscreenArmed: (v) => set({ isFullscreenArmed: v }),
  setWebcamActive: (v) => set({ webcamActive: v }),

  showWarningBanner: (msg) => set({ showWarning: true, warningMessage: msg }),
  dismissWarning: () => set({ showWarning: false, warningMessage: "" }),

  isMaxViolations: () => get().violationCount >= MAX_VIOLATIONS,

  reset: () =>
    set({
      violations: [],
      violationCount: 0,
      isFullscreen: false,
      isFullscreenArmed: false,
      webcamActive: false,
      showWarning: false,
      warningMessage: "",
    }),
}))
