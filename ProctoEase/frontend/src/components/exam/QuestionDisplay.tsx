import { useExamStore, type Question } from "@/stores/exam.store"
import { cn } from "@/lib/utils"
import { Bookmark } from "lucide-react"

import FormattedText from "@/components/common/FormattedText"

interface QuestionDisplayProps {
  question: Question
}

export default function QuestionDisplay({ question }: QuestionDisplayProps) {
  const { answers, setAnswer, toggleReview } = useExamStore()
  const answer = answers[question.id]

  const handleMCQ = (optionId: string) => {
    setAnswer(question.id, { selected_option_ids: [optionId] })
  }

  const handleMultiSelect = (optionId: string) => {
    const current = answer?.selected_option_ids || []
    const updated = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId]
    setAnswer(question.id, { selected_option_ids: updated })
  }


  return (
    <div
      className="select-none"
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onPaste={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Question {question.question_number}
          </span>
          <span className="text-xs ml-2 px-2 py-0.5 rounded bg-primary/10 text-primary font-bold">
            {question.marks} mark{question.marks > 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={() => toggleReview(question.id)}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            answer?.is_marked_for_review
              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          <Bookmark className="h-3 w-3" />
          {answer?.is_marked_for_review ? "Marked" : "Mark for review"}
        </button>
      </div>

      {/* Question text formatted */}
      <div className="mb-6">
        <FormattedText text={question.text} />
      </div>

      {/* Code question: Public Sample Test Cases display in problem pane */}
      {question.type === "code" && question.public_test_cases && question.public_test_cases.length > 0 && (
        <div className="mt-6 space-y-4">
          <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider text-xs">Sample Test Cases</h4>
          <div className="space-y-3">
            {question.public_test_cases.map((tc, idx) => (
              <div key={idx} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-xs font-mono">
                <p className="text-slate-400 font-semibold mb-2">Example {idx + 1}</p>
                <div className="space-y-2">
                  <div>
                    <span className="text-slate-500 font-bold block mb-0.5">Input:</span>
                    <pre className="text-slate-200 whitespace-pre-wrap bg-black/30 p-2 rounded border border-white/[0.05]">{tc.input}</pre>
                  </div>
                  <div>
                    <span className="text-slate-500 font-bold block mb-0.5">Expected Output:</span>
                    <pre className="text-slate-200 whitespace-pre-wrap bg-black/30 p-2 rounded border border-white/[0.05]">{String(tc.expected)}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Answer input by type */}
      {(question.type === "mcq" || question.type === "true_false") &&
        question.options && (
          <div className="space-y-3">
            {question.options.map((opt) => {
              const selected = answer?.selected_option_ids?.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  onClick={() => handleMCQ(opt.id)}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-lg border transition-all",
                    selected
                      ? "border-primary bg-primary/5 text-primary font-medium"
                      : "border-border hover:border-primary/30 hover:bg-muted/50"
                  )}
                >
                  <span className="inline-flex items-center justify-center h-6 w-6 rounded-full border text-xs font-bold mr-3">
                    {opt.id.toUpperCase()}
                  </span>
                  {opt.text}
                </button>
              )
            })}
          </div>
        )}

      {question.type === "multi_select" && question.options && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground mb-2">
            Select all that apply
          </p>
          {question.options.map((opt) => {
            const selected = answer?.selected_option_ids?.includes(opt.id)
            return (
              <button
                key={opt.id}
                onClick={() => handleMultiSelect(opt.id)}
                className={cn(
                  "w-full text-left px-4 py-3 rounded-lg border transition-all flex items-center gap-3",
                  selected
                    ? "border-primary bg-primary/5 text-primary font-medium"
                    : "border-border hover:border-primary/30 hover:bg-muted/50"
                )}
              >
                <div
                  className={cn(
                    "h-4 w-4 rounded border-2 flex items-center justify-center",
                    selected ? "border-primary bg-primary" : "border-border"
                  )}
                >
                  {selected && (
                    <svg className="h-3 w-3 text-white" viewBox="0 0 12 12">
                      <path
                        d="M3.5 6L5.5 8L8.5 4"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                      />
                    </svg>
                  )}
                </div>
                {opt.text}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
