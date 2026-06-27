import { create } from "zustand"
import { MAX_VIOLATIONS } from "@/lib/constants"

export interface Violation {
  id: string
  type:
    | "tab_switch"
    | "fullscreen_exit"
    | "keyboard_block"
    | "copy_paste"
    | "right_click"
    | "browser_devtools"
    | "inactivity"
    | "multiple_faces"
    | "no_face"
    | "audio_anomaly"
    | "custom"
    | "rapid_tab_switching"
    | "suspicious_activity_burst"
    | "bulk_paste_detected"
    | "impossible_answer_speed"
    | "periodic_check"
    | "face_inconsistency"
  timestamp: string
  description: string
}

interface ProctoringState {
  violations: Violation[]
  violationCount: number
  isFullscreen: boolean
  webcamActive: boolean
  showWarning: boolean
  warningMessage: string

  addViolation: (type: Violation["type"], description: string) => void
  setViolationCount: (count: number) => void
  setFullscreen: (v: boolean) => void
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
    set((s) => ({
      violations: [...s.violations, violation],
      violationCount: s.violationCount + 1,
      showWarning: true,
      warningMessage: `⚠️ Violation: ${description} (${s.violationCount + 1}/${MAX_VIOLATIONS})`,
    }))
  },

  setViolationCount: (count) => set({ violationCount: count }),

  setFullscreen: (v) => set({ isFullscreen: v }),
  setWebcamActive: (v) => set({ webcamActive: v }),

  showWarningBanner: (msg) => set({ showWarning: true, warningMessage: msg }),
  dismissWarning: () => set({ showWarning: false, warningMessage: "" }),

  isMaxViolations: () => get().violationCount >= MAX_VIOLATIONS,

  reset: () =>
    set({
      violations: [],
      violationCount: 0,
      isFullscreen: false,
      webcamActive: false,
      showWarning: false,
      warningMessage: "",
    }),
}))
