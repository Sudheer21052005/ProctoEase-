import { useState } from "react"
import { useParams } from "react-router-dom"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  type BackendQuestion,
  type QuestionCreateRequest,
} from "@/api/question.api"
import {
  useCreateQuestion,
  useDeleteQuestion,
  useQuestionsForExam,
} from "@/hooks/useQuestions"

export default function QuestionsSection() {
  const { examId } = useParams<{ examId: string }>()
  const {
    data: questions = [],
    isLoading,
    isError,
  } = useQuestionsForExam(examId || "")
  const createQuestion = useCreateQuestion(examId || "")
  const deleteQuestion = useDeleteQuestion(examId || "")

  const [showAddQ, setShowAddQ] = useState(false)
  const [newQ, setNewQ] = useState({
    question_text: "",
    question_type: "mcq" as string,
    options: [
      { label: "A", text: "" },
      { label: "B", text: "" },
      { label: "C", text: "" },
      { label: "D", text: "" },
    ],
    correct_answer: "A",
    points: 1,
  })

  const handleAddQuestion = async () => {
    if (!newQ.question_text.trim()) return
    try {
      const payload: QuestionCreateRequest = {
        question_text: newQ.question_text,
        question_type: newQ.question_type as BackendQuestion["question_type"],
        points: newQ.points,
        order_index: questions.length,
      }
      if (newQ.question_type !== "short_answer" && newQ.question_type !== "code") {
        payload.options = newQ.options.filter((o) => o.text.trim())
        payload.correct_answer = newQ.correct_answer
      }

      await createQuestion.mutateAsync(payload)
      toast.success("Question added")
      setShowAddQ(false)
      setNewQ({
        question_text: "",
        question_type: "mcq",
        options: [
          { label: "A", text: "" },
          { label: "B", text: "" },
          { label: "C", text: "" },
          { label: "D", text: "" },
        ],
        correct_answer: "A",
        points: 1,
      })
    } catch {
      toast.error("Failed to add question")
    }
  }

  const handleDeleteQuestion = async (questionId: string) => {
    try {
      await deleteQuestion.mutateAsync(questionId)
      toast.success("Question deleted")
    } catch {
      toast.error("Failed to delete question")
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">Could not load questions.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Questions ({questions.length})</h2>
        <button
          onClick={() => setShowAddQ((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary-700 transition"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Question
        </button>
      </div>

      {showAddQ && (
        <div className="mb-5 p-4 rounded-lg border border-border bg-muted/30 space-y-3">
          <textarea
            rows={3}
            placeholder="Question text..."
            value={newQ.question_text}
            onChange={(e) => setNewQ((p) => ({ ...p, question_text: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />

          <div className="grid grid-cols-2 gap-3">
            <select
              value={newQ.question_type}
              onChange={(e) => setNewQ((p) => ({ ...p, question_type: e.target.value }))}
              className="px-3 py-2 rounded-lg border border-border text-sm"
            >
              <option value="mcq">MCQ</option>
              <option value="multi_select">Multi Select</option>
              <option value="true_false">True/False</option>
              <option value="short_answer">Short Answer</option>
              <option value="code">Code</option>
            </select>
            <input
              type="number"
              min={1}
              max={100}
              value={newQ.points}
              onChange={(e) =>
                setNewQ((p) => ({ ...p, points: Number.parseInt(e.target.value, 10) || 1 }))
              }
              className="px-3 py-2 rounded-lg border border-border text-sm"
            />
          </div>

          {newQ.question_type !== "short_answer" && newQ.question_type !== "code" && (
            <div className="space-y-2">
              {newQ.options.map((opt, i) => (
                <div key={opt.label} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-6">{opt.label}</span>
                  <input
                    type="text"
                    value={opt.text}
                    onChange={(e) => {
                      const updated = [...newQ.options]
                      updated[i] = { ...opt, text: e.target.value }
                      setNewQ((p) => ({ ...p, options: updated }))
                    }}
                    className="flex-1 px-3 py-1.5 rounded border border-border text-sm"
                    placeholder={`Option ${opt.label}`}
                  />
                </div>
              ))}

              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-muted-foreground">Correct:</span>
                <select
                  value={newQ.correct_answer}
                  onChange={(e) => setNewQ((p) => ({ ...p, correct_answer: e.target.value }))}
                  className="px-2 py-1 border border-border rounded text-sm"
                >
                  {newQ.options.map((o) => (
                    <option key={o.label} value={o.label}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowAddQ(false)}
              className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleAddQuestion}
              disabled={createQuestion.isPending || !newQ.question_text.trim()}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
            >
              {createQuestion.isPending ? "Adding..." : "Add"}
            </button>
          </div>
        </div>
      )}

      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No questions yet. Add the first question to this exam.
        </p>
      ) : (
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <div
              key={q.id}
              className="flex items-start justify-between p-3 rounded-lg border border-border hover:bg-muted/30 transition"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-primary">Q{idx + 1}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                    {q.question_type.replace("_", " ")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {q.points} pt{q.points > 1 ? "s" : ""}
                  </span>
                </div>
                <p className="text-sm line-clamp-2">{q.question_text}</p>
              </div>
              <button
                onClick={() => handleDeleteQuestion(q.id)}
                disabled={deleteQuestion.isPending}
                className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-danger transition"
                title="Delete question"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
