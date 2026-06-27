import { useExamStore, type Question } from "@/stores/exam.store"
import { cn } from "@/lib/utils"
import { Bookmark } from "lucide-react"

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

  const handleText = (text: string) => {
    setAnswer(question.id, { text_answer: text })
  }

  return (
    <div
      className="select-none"
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onPaste={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <span className="text-xs font-medium text-muted-foreground">
            Question {question.question_number}
          </span>
          <span className="text-xs ml-2 text-primary font-medium">
            {question.marks} mark{question.marks > 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={() => toggleReview(question.id)}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
            answer?.is_marked_for_review
              ? "bg-amber-100 text-amber-700"
              : "bg-muted text-muted-foreground hover:bg-amber-50"
          )}
        >
          <Bookmark className="h-3 w-3" />
          {answer?.is_marked_for_review ? "Marked" : "Mark for review"}
        </button>
      </div>

      {/* Question text */}
      <p className="text-lg font-medium mb-6 leading-relaxed">
        {question.text}
      </p>

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

      {question.type === "short_answer" && (
        <textarea
          rows={6}
          placeholder="Type your answer here…"
          value={answer?.text_answer || ""}
          onChange={(e) => handleText(e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
        />
      )}
    </div>
  )
}
