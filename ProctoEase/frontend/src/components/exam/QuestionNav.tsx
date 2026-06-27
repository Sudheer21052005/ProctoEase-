import { cn } from "@/lib/utils"
import { useExamStore, type Question } from "@/stores/exam.store"

interface QuestionNavProps {
  questions: Question[]
}

export default function QuestionNav({ questions }: QuestionNavProps) {
  const { answers, currentIndex, visitedIds, setCurrentIndex } = useExamStore()

  const getStatus = (qId: string, idx: number) => {
    if (idx === currentIndex) return "current"
    const answer = answers[qId]
    if (answer?.is_marked_for_review) return "review"
    if (
      answer?.selected_option_ids?.length ||
      answer?.text_answer?.trim()
    )
      return "answered"
    if (visitedIds.has(qId)) return "visited"
    return "not_visited"
  }

  const statusColors: Record<string, string> = {
    current: "bg-primary text-primary-foreground ring-2 ring-primary/30",
    answered: "bg-green-500 text-white",
    review: "bg-amber-500 text-white",
    visited: "bg-muted text-muted-foreground",
    not_visited: "bg-card text-muted-foreground border border-border",
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        Questions
      </h3>
      <div className="grid grid-cols-5 gap-2">
        {questions.map((q, i) => {
          const st = getStatus(q.id, i)
          return (
            <button
              key={q.id}
              onClick={() => setCurrentIndex(i)}
              className={cn(
                "h-9 w-9 rounded-lg text-xs font-bold transition-all hover:scale-105",
                statusColors[st]
              )}
            >
              {q.question_number}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 space-y-1.5 text-xs">
        {[
          { color: "bg-primary", label: "Current" },
          { color: "bg-green-500", label: "Answered" },
          { color: "bg-amber-500", label: "Review" },
          { color: "bg-muted", label: "Visited" },
          { color: "bg-card border border-border", label: "Not visited" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div className={cn("h-3 w-3 rounded", item.color)} />
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
