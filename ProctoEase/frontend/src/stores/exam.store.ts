import { create } from "zustand"
import type { BackendQuestion, PublicTestCase } from "@/api/question.api"

export interface Question {
  id: string
  question_number: number
  text: string
  type: "mcq" | "multi_select" | "true_false" | "code"
  options?: { id: string; text: string }[]
  marks: number
  /** Code questions only — public sample cases the candidate may run. */
  public_test_cases?: PublicTestCase[]
}

export interface Answer {
  question_id: string
  selected_option_ids?: string[]
  text_answer?: string
  language_id?: number
  is_marked_for_review: boolean
}

interface ExamSessionState {
  answers: Record<string, Answer>
  currentIndex: number
  visitedIds: Set<string>

  setCurrentIndex: (i: number) => void
  markVisited: (questionId: string) => void
  setAnswer: (questionId: string, answer: Partial<Answer>) => void
  toggleReview: (questionId: string) => void
  getAnswersPayload: () => Record<string, Answer>
  reset: () => void
}

/**
 * Map backend question format to frontend Question interface.
 * Backend: { question_text, question_type, options: [{label, text}], points, order_index }
 * Frontend: { text, type, options: [{id, text}], marks, question_number }
 * public_test_cases passes through unchanged (candidate responses only).
 */
export function mapBackendQuestions(raw: BackendQuestion[]): Question[] {
  return raw
    .sort((a, b) => a.order_index - b.order_index)
    .map((q, idx) => ({
      id: q.id,
      question_number: idx + 1,
      text: q.question_text,
      type: q.question_type,
      options: q.options?.map((opt) => ({
        id: opt.label,
        text: opt.text,
      })),
      marks: q.points,
      public_test_cases: q.public_test_cases ?? undefined,
    }))
}

export const useExamStore = create<ExamSessionState>((set, get) => ({
  answers: {},
  currentIndex: 0,
  visitedIds: new Set(),

  setCurrentIndex: (i) => set({ currentIndex: i }),

  markVisited: (questionId) => {
    const current = get().visitedIds
    const next = new Set(current)
    next.add(questionId)
    set({ visitedIds: next })
  },

  setAnswer: (questionId, partial) => {
    const { answers } = get()
    const existing = answers[questionId] || {
      question_id: questionId,
      is_marked_for_review: false,
    }
    set({
      answers: { ...answers, [questionId]: { ...existing, ...partial } },
    })
  },

  toggleReview: (questionId) => {
    const { answers } = get()
    const existing = answers[questionId] || {
      question_id: questionId,
      is_marked_for_review: false,
    }
    set({
      answers: {
        ...answers,
        [questionId]: {
          ...existing,
          is_marked_for_review: !existing.is_marked_for_review,
        },
      },
    })
  },

  getAnswersPayload: () => get().answers,

  reset: () =>
    set({
      answers: {},
      currentIndex: 0,
      visitedIds: new Set(),
    }),
}))
