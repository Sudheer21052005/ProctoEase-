import { useEffect, useCallback, useRef, useState, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useExam } from "@/hooks/useExams"
import { useQuestionsForExam } from "@/hooks/useQuestions"
import { useExamStore, mapBackendQuestions } from "@/stores/exam.store"
import { useProctoringStore } from "@/stores/proctoring.store"
import { useActiveAttemptStore } from "@/stores/attempt.store"
import { useTimer } from "@/hooks/useTimer"
import { useProctoring } from "@/hooks/useProctoring"
import { useSubmitAttempt, useSaveAnswers, useMyAttempts } from "@/hooks/useAttempts"
import TimerBar from "@/components/proctoring/TimerBar"
import ViolationTracker from "@/components/proctoring/ViolationTracker"
import WebcamMonitor from "@/components/proctoring/WebcamMonitor"
import FullscreenWarning from "@/components/proctoring/FullscreenWarning"
import ViolationToast from "@/components/proctoring/ViolationToast"
import ViolationHistory from "@/components/proctoring/ViolationHistory"
import QuestionNav from "@/components/exam/QuestionNav"
import QuestionDisplay from "@/components/exam/QuestionDisplay"
import CodeEditor from "@/components/exam/CodeEditor"
import ConfirmDialog from "@/components/shared/ConfirmDialog"
import { toast } from "sonner"
import { ArrowLeft, ArrowRight, Send, Menu, X, Loader2 } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import type { AnswerSubmit } from "@/api/attempt.api"
import { formatDate } from "@/lib/utils"

export default function ExamScreen() {
  const { examId, attemptId } = useParams<{
    examId: string
    attemptId: string
  }>()
  const navigate = useNavigate()
  const { data: exam } = useExam(examId || "")
  const {
    data: rawQuestions = [],
    isLoading: questionsLoading,
    isError: questionsError,
  } = useQuestionsForExam(examId || "")
  const { data: myAttempts = [] } = useMyAttempts()
  const questions = useMemo(() => mapBackendQuestions(rawQuestions), [rawQuestions])
  const {
    currentIndex,
    answers,
    setCurrentIndex,
    markVisited,
    setAnswer,
    getAnswersPayload,
    reset: resetExam,
  } = useExamStore()
  const { setActiveAttempt, clearActiveAttempt } = useActiveAttemptStore()

  const resetProctoring = useProctoringStore((s) => s.reset)
  const isFullscreen = useProctoringStore((s) => s.isFullscreen)
  const submitAttempt = useSubmitAttempt()
  const saveAnswers = useSaveAnswers()

  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const submitted = useRef(false)
  const stopCameraRef = useRef<() => void>(() => {})

  // Build the answer payload for the backend
  const buildAnswerPayload = useCallback((): AnswerSubmit[] => {
    const raw = getAnswersPayload()
    return Object.values(raw).map((a) => ({
      question_id: a.question_id,
      selected_option_ids: a.selected_option_ids || null,
      text_answer: a.text_answer || null,
    }))
  }, [getAnswersPayload])

  // Submit handler — save answers then submit attempt
  const handleSubmit = useCallback(async () => {
    if (submitted.current || !attemptId) return
    submitted.current = true

    try {
      stopCameraRef.current()

      // Save final answers
      const payload = buildAnswerPayload()
      if (payload.length > 0) {
        await saveAnswers.mutateAsync({ attemptId, answers: payload })
      }

      // Submit the attempt (triggers auto-grading on backend)
      await submitAttempt.mutateAsync(attemptId)

      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {})
      }

      clearActiveAttempt(examId)
      localStorage.removeItem(`proctoease_answers_${examId}`)
      toast.success("Exam submitted!")
      navigate(`/candidate/exam/${examId}/complete`)
    } catch {
      submitted.current = false
      toast.error("Failed to submit exam. Please try again.")
    }
  }, [
    attemptId,
    examId,
    navigate,
    clearActiveAttempt,
    buildAnswerPayload,
    saveAnswers,
    submitAttempt,
  ])

  // Auto-submit trigger for the violation gate. Memoised so useProctoring's
  // detector effects (which own setInterval-based ML scan loops) don't see a
  // new onMaxViolations identity on every ~1 Hz timer re-render — an unstable
  // identity there tore down and recreated the object-detection interval
  // faster than its 2.5s period could fire.
  const handleMaxViolations = useCallback(() => {
    toast.error("Maximum violations reached. Auto-submitting exam.")
    handleSubmit()
  }, [handleSubmit])

  // Proctoring — auto-submit on max violations
  const { reportViolation, requestFullscreen, stopCamera } = useProctoring({
    enabled: true,
    examId,
    attemptId,
    onMaxViolations: handleMaxViolations,
  })

  useEffect(() => {
    stopCameraRef.current = stopCamera
  }, [stopCamera])

  // Ensure the active attempt is tracked centrally for resume behavior.
  useEffect(() => {
    if (!examId || !attemptId) return
    setActiveAttempt(examId, attemptId)

    return undefined
  }, [examId, attemptId, setActiveAttempt])

  // Reset per-attempt client state on unmount.
  useEffect(() => {
    if (!examId) return

    return () => {
      resetExam()
      resetProctoring()
      clearActiveAttempt(examId)
    }
  }, [examId, resetExam, resetProctoring, clearActiveAttempt])

  useEffect(() => {
    if (questionsError) {
      toast.error("Failed to load questions")
    }
  }, [questionsError])

  useEffect(() => {
    if (!questions.length) return
    if (currentIndex >= questions.length) {
      setCurrentIndex(0)
    }
  }, [questions, currentIndex, setCurrentIndex])

  useEffect(() => {
    const currentQuestion = questions[currentIndex]
    if (currentQuestion) {
      markVisited(currentQuestion.id)
    }
  }, [questions, currentIndex, markVisited])

  // Auto-save answers to backend every 30 seconds
  useEffect(() => {
    if (!attemptId) return

    const interval = setInterval(() => {
      const payload = buildAnswerPayload()
      if (payload.length > 0) {
        saveAnswers.mutate({ attemptId, answers: payload })
      }

      // Also save to localStorage as fallback
      const raw = getAnswersPayload()
      localStorage.setItem(
        `proctoease_answers_${examId}`,
        JSON.stringify(raw)
      )
    }, 30_000)

    return () => clearInterval(interval)
  }, [attemptId, examId, buildAnswerPayload, saveAnswers, getAnswersPayload])

  // Restore from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(`proctoease_answers_${examId}`)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        Object.entries(parsed).forEach(([qId, ans]) => {
          useExamStore
            .getState()
            .setAnswer(qId, ans as Record<string, unknown>)
        })
        toast.info("Restored your previous answers")
      } catch {
        // ignore
      }
    }
  }, [examId])

  // beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!submitted.current) {
        e.preventDefault()
      }
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])

  const duration = exam?.duration_minutes || 60
  const currentAttempt = useMemo(
    () => myAttempts.find((a) => a.id === attemptId),
    [myAttempts, attemptId]
  )
  const nowMs = Date.now()
  const attemptRemainingSeconds = currentAttempt?.attempt_end_time
    ? Math.max(0, Math.floor((new Date(currentAttempt.attempt_end_time).getTime() - nowMs) / 1000))
    : null
  const totalSeconds = attemptRemainingSeconds ?? duration * 60

  // Timer
  const timer = useTimer({
    totalSeconds,
    onTimeUp: () => {
      toast.warning("Time's up! Auto-submitting…")
      handleSubmit()
    },
  })

  const currentQuestion = questions[currentIndex]
  const totalAnswered = Object.values(answers).filter(
    (a) => a.selected_option_ids?.length || a.text_answer?.trim()
  ).length

  const maybeEmitImpossibleSpeed = useCallback(() => {
    const elapsedSeconds = duration * 60 - timer.remaining
    const answeredIds = new Set(
      Object.entries(answers)
        .filter(([, a]) => a.selected_option_ids?.length || a.text_answer?.trim())
        .map(([qid]) => qid)
    )
    const answeredQuestions = questions.filter((q) => answeredIds.has(q.id))
    if (answeredQuestions.length === 0) return

    const weightedMinSeconds = answeredQuestions.reduce((acc, q) => {
      if (q.type === "code") return acc + 90
      return acc + 12
    }, 0)

    if (elapsedSeconds > 0 && elapsedSeconds < weightedMinSeconds * 0.35) {
      reportViolation(
        "impossible_answer_speed",
        "Submission speed appears too fast for answered question types",
        2,
        {
          elapsed_seconds: elapsedSeconds,
          estimated_min_seconds: weightedMinSeconds,
          answered_questions: answeredQuestions.length,
        }
      )
    }
  }, [answers, questions, duration, timer.remaining, reportViolation])

  if (questionsLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#0f1117]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#6366f1]" />
          <p className="text-slate-500 text-sm">Loading questions…</p>
        </div>
      </div>
    )
  }

  if (!currentQuestion) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">
            No questions found for this exam.
          </p>
          <button
            onClick={() => navigate("/candidate/dashboard")}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-[#0f1117]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Fullscreen blocking overlay */}
      <FullscreenWarning />

      {/* Per-violation animated toasts */}
      <ViolationToast />

      {/* Header — dark glass */}
      <header className="h-14 bg-[#161b27]/95 border-b border-white/[0.07] flex items-center justify-between px-4 shrink-0 sticky top-0 z-30"
        style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      >
        <div className="flex items-center gap-3">
          <button
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
          <div>
            <h1 className="font-semibold text-sm text-white truncate max-w-[200px]">
              {exam?.title || "Exam"}
            </h1>
            <p className="text-[10px] text-slate-600 hidden md:block">
              {exam?.start_time ? formatDate(exam.start_time) : "Open"} — {exam?.end_time ? formatDate(exam.end_time) : "No end time"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {!isFullscreen && (
            <button
              onClick={requestFullscreen}
              className="hidden md:inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border border-amber-400/30 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
            >
              Enter Fullscreen to Begin
            </button>
          )}
          <ViolationTracker />
          <TimerBar
            formatted={timer.formatted}
            isWarning={timer.isWarning}
            isUrgent={timer.isUrgent}
            progress={timer.progress}
          />
        </div>

        <button
          onClick={() => setShowSubmitDialog(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_12px_-4px_rgba(16,185,129,0.5)] active:scale-[0.97]"
        >
          <Send className="h-3.5 w-3.5" strokeWidth={2} />
          Submit
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`fixed inset-y-14 left-0 z-30 w-60 bg-[#161b27] border-r border-white/[0.07] p-3 overflow-y-auto transition-transform lg:static lg:translate-x-0 flex flex-col gap-3 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Webcam feed */}
          <WebcamMonitor enabled />

          {/* Question navigation */}
          <QuestionNav questions={questions} />

          {/* Violation history log */}
          <ViolationHistory />
        </aside>

        {/* Main question area */}
        <main className="flex-1 overflow-y-auto p-6 relative">
          <div className="max-w-2xl mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentQuestion.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <QuestionDisplay question={currentQuestion} />

                {currentQuestion.type === "code" && attemptId && (
                  <CodeEditor
                    attemptId={attemptId}
                    questionId={currentQuestion.id}
                    initialCode={answers[currentQuestion.id]?.text_answer || ""}
                    onChange={(code) => setAnswer(currentQuestion.id, { text_answer: code })}
                    publicTestCases={currentQuestion.public_test_cases || []}
                  />
                )}
              </motion.div>
            </AnimatePresence>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between mt-8 pt-4 border-t border-white/[0.07]">
              <button
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                className="inline-flex items-center gap-2 px-4 py-2 border border-white/[0.08] rounded-xl text-sm font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white transition-all disabled:opacity-30"
              >
                <ArrowLeft className="h-4 w-4" />
                Previous
              </button>

              <span className="text-xs text-slate-600 font-mono tabular-nums">
                {currentIndex + 1} / {questions.length}
              </span>

              <button
                onClick={() =>
                  setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1))
                }
                disabled={currentIndex >= questions.length - 1}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-semibold rounded-xl transition-all hover:-translate-y-[1px] disabled:opacity-30 disabled:hover:translate-y-0"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Submit confirmation */}
      <ConfirmDialog
        open={showSubmitDialog}
        title="Submit Exam?"
        description={`You have answered ${totalAnswered} out of ${questions.length} questions. This action cannot be undone.`}
        confirmLabel="Submit Exam"
        variant="primary"
        onConfirm={() => {
          setShowSubmitDialog(false)
          timer.stop()
          maybeEmitImpossibleSpeed()
          handleSubmit()
        }}
        onCancel={() => setShowSubmitDialog(false)}
      />
    </div>
  )
}
