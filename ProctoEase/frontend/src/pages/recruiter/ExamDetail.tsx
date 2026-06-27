import { useParams, Link } from "react-router-dom"
import { useState } from "react"
import { useExam, useUpdateExam } from "@/hooks/useExams"
import { type BackendQuestion, type QuestionCreateRequest } from "@/api/question.api"
import { useCreateQuestion, useDeleteQuestion, useQuestionsForExam } from "@/hooks/useQuestions"
import { useExamAttempts } from "@/hooks/useAttempts"
import { toast } from "sonner"
import {
  Loader2,
  ArrowLeft,
  Clock,
  Calendar,
  User,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Users,
  AlertTriangle,
} from "lucide-react"
import StatusBadge from "@/components/shared/StatusBadge"
import { formatDuration, formatDate } from "@/lib/utils"
import type { AxiosError } from "axios"

export default function ExamDetail() {
  const { examId } = useParams<{ examId: string }>()
  const { data: exam, isLoading, isError } = useExam(examId || "")
  const updateExam = useUpdateExam()
  const { data: questions = [], isLoading: loadingQ } = useQuestionsForExam(examId || "")
  const { data: attempts = [], isLoading: loadingA } = useExamAttempts(examId || "")
  const createQuestion = useCreateQuestion(examId || "")
  const deleteQuestion = useDeleteQuestion(examId || "")

  // Add question form state
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
  const [addingQ, setAddingQ] = useState(false)

  const togglePublish = () => {
    if (!examId || !exam) return
    updateExam.mutate(
      { id: examId, data: { is_published: !exam.is_published } },
      {
        onSuccess: () =>
          toast.success(
            exam.is_published ? "Exam unpublished" : "Exam published!"
          ),
        onError: (err) => {
          const axiosErr = err as AxiosError<{ detail: string }>
          toast.error(axiosErr.response?.data?.detail || "Update failed")
        },
      }
    )
  }

  const handleAddQuestion = async () => {
    if (!examId || !newQ.question_text.trim()) return
    setAddingQ(true)
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
      toast.success("Question added!")
    } catch {
      toast.error("Failed to add question")
    }
    setAddingQ(false)
  }

  const handleDeleteQuestion = async (qId: string) => {
    try {
      await deleteQuestion.mutateAsync(qId)
      toast.success("Question deleted")
    } catch {
      toast.error("Failed to delete question")
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (isError || !exam) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-semibold mb-2">Exam not found</h2>
        <Link
          to="/recruiter/exams"
          className="text-primary text-sm font-medium hover:underline"
        >
          Back to exams
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Back link */}
      <Link
        to="/recruiter/exams"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Exams
      </Link>

      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-2xl font-bold">{exam.title}</h1>
          <div className="flex items-center gap-3">
            <StatusBadge status={exam.is_published ? "published" : "draft"} />
            <button
              onClick={togglePublish}
              disabled={updateExam.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted transition disabled:opacity-50"
              title={exam.is_published ? "Unpublish" : "Publish"}
            >
              {exam.is_published ? (
                <ToggleRight className="h-4 w-4 text-success" />
              ) : (
                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
              )}
              {exam.is_published ? "Unpublish" : "Publish"}
            </button>
            <Link
              to={`/recruiter/exams/${examId}/plagiarism`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-100 transition"
              title="Plagiarism Scans"
            >
              <AlertTriangle className="h-4 w-4" />
              Plagiarism Scans
            </Link>
          </div>
        </div>

        {exam.description && (
          <p className="text-muted-foreground mb-6">{exam.description}</p>
        )}

        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{formatDuration(exam.duration_minutes)}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>{formatDate(exam.created_at)}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <User className="h-4 w-4" />
            <span className="font-mono text-xs">
              {exam.created_by.slice(0, 8)}…
            </span>
          </div>
        </div>
      </div>

      {/* Questions section */}
      <div className="rounded-xl border border-border bg-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Questions ({questions.length})
          </h2>
          <button
            onClick={() => setShowAddQ(!showAddQ)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Question
          </button>
        </div>

        {/* Add question form */}
        {showAddQ && (
          <div className="mb-4 p-4 rounded-lg border border-border bg-muted/30 space-y-3">
            <textarea
              rows={3}
              placeholder="Question text…"
              value={newQ.question_text}
              onChange={(e) =>
                setNewQ((p) => ({ ...p, question_text: e.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={newQ.question_type}
                onChange={(e) =>
                  setNewQ((p) => ({ ...p, question_type: e.target.value }))
                }
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
                  setNewQ((p) => ({
                    ...p,
                    points: parseInt(e.target.value) || 1,
                  }))
                }
                className="px-3 py-2 rounded-lg border border-border text-sm"
                placeholder="Points"
              />
            </div>

            {newQ.question_type !== "short_answer" && newQ.question_type !== "code" && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Options
                </p>
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
                  <span className="text-xs text-muted-foreground">
                    Correct:
                  </span>
                  <select
                    value={newQ.correct_answer}
                    onChange={(e) =>
                      setNewQ((p) => ({ ...p, correct_answer: e.target.value }))
                    }
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
                disabled={addingQ || !newQ.question_text.trim()}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
              >
                {addingQ ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        )}

        {loadingQ ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : questions.length > 0 ? (
          <div className="space-y-3">
            {questions.map((q, i) => (
              <div
                key={q.id}
                className="flex items-start justify-between p-3 rounded-lg border border-border hover:bg-muted/30 transition"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-primary">
                      Q{i + 1}
                    </span>
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
                  className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-danger transition"
                  title="Delete question"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">
            No questions yet. Add your first question above.
          </p>
        )}
      </div>

      {/* Attempts section */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Attempts ({attempts.length})
        </h2>

        {loadingA ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : attempts.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium">
                    Candidate
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">
                    Started
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">
                    Submitted
                  </th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {a.candidate_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                      {formatDate(a.started_at)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                      {a.submitted_at ? formatDate(a.submitted_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">
            No attempts yet. Share this exam with candidates.
          </p>
        )}
      </div>
    </div>
  )
}
