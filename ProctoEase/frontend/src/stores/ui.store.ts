import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

type AttemptDrafts = Record<string, Record<string, number>>

interface UiState {
  gradingDrafts: AttemptDrafts
  setQuestionDraftScore: (attemptId: string, questionId: string, score: number) => void
  replaceAttemptDraft: (attemptId: string, draft: Record<string, number>) => void
  clearAttemptDraft: (attemptId: string) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      gradingDrafts: {},

      setQuestionDraftScore: (attemptId, questionId, score) =>
        set((state) => ({
          gradingDrafts: {
            ...state.gradingDrafts,
            [attemptId]: {
              ...(state.gradingDrafts[attemptId] || {}),
              [questionId]: score,
            },
          },
        })),

      replaceAttemptDraft: (attemptId, draft) =>
        set((state) => ({
          gradingDrafts: {
            ...state.gradingDrafts,
            [attemptId]: draft,
          },
        })),

      clearAttemptDraft: (attemptId) =>
        set((state) => {
          const next = { ...state.gradingDrafts }
          delete next[attemptId]
          return { gradingDrafts: next }
        }),
    }),
    {
      name: "proctoease-ui-state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ gradingDrafts: state.gradingDrafts }),
    }
  )
)
