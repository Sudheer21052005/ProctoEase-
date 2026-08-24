import { create } from "zustand"

/**
 * UiStore — lightweight global UI flags.
 * Manual grading draft state was removed when short_answer question type
 * was eliminated (no longer any question type requiring local manual grading).
 */
interface UiState {
  _placeholder: null
}

export const useUiStore = create<UiState>()(() => ({
  _placeholder: null,
}))
