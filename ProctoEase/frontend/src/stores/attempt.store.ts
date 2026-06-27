import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

interface ActiveAttemptState {
  examId: string | null
  attemptId: string | null
  setActiveAttempt: (examId: string, attemptId: string) => void
  clearActiveAttempt: (examId?: string) => void
}

export const useActiveAttemptStore = create<ActiveAttemptState>()(
  persist(
    (set, get) => ({
      examId: null,
      attemptId: null,

      setActiveAttempt: (examId, attemptId) =>
        set({ examId, attemptId }),

      clearActiveAttempt: (examId) => {
        const state = get()
        if (examId && state.examId !== examId) return
        set({ examId: null, attemptId: null })
      },
    }),
    {
      name: "proctoease-active-attempt",
      storage: createJSONStorage(() => localStorage),
    }
  )
)
