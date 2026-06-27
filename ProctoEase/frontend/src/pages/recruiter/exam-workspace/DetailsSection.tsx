import { useParams, Link } from "react-router-dom"
import { AlertTriangle, Calendar, Clock, Loader2, ToggleLeft, ToggleRight, User } from "lucide-react"
import { toast } from "sonner"
import { useExam, useUpdateExam } from "@/hooks/useExams"
import { formatDate, formatDuration } from "@/lib/utils"
import StatusBadge from "@/components/shared/StatusBadge"
import type { AxiosError } from "axios"

export default function DetailsSection() {
  const { examId } = useParams<{ examId: string }>()
  const { data: exam, isLoading, isError } = useExam(examId || "")
  const updateExam = useUpdateExam()

  const togglePublish = () => {
    if (!examId || !exam) return
    updateExam.mutate(
      { id: examId, data: { is_published: !exam.is_published } },
      {
        onSuccess: () => {
          toast.success(exam.is_published ? "Exam unpublished" : "Exam published")
        },
        onError: (err) => {
          const axiosErr = err as AxiosError<{ detail: string }>
          toast.error(axiosErr.response?.data?.detail || "Failed to update exam")
        },
      }
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (isError || !exam) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">Could not load exam details.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">Exam Details</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Core metadata and publishing controls.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={exam.is_published ? "published" : "draft"} />
            <button
              onClick={togglePublish}
              disabled={updateExam.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted transition disabled:opacity-50"
            >
              {exam.is_published ? (
                <ToggleRight className="h-4 w-4 text-success" />
              ) : (
                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
              )}
              {exam.is_published ? "Unpublish" : "Publish"}
            </button>
          </div>
        </div>

        {exam.description ? (
          <p className="text-muted-foreground mb-5">{exam.description}</p>
        ) : (
          <p className="text-muted-foreground mb-5">No description provided.</p>
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
            <span className="font-mono text-xs">{exam.created_by.slice(0, 8)}…</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="font-semibold mb-2">Related Actions</h3>
        <div className="flex flex-wrap gap-3">
          <Link
            to={`/recruiter/exams/${exam.id}/plagiarism`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-100 transition"
          >
            <AlertTriangle className="h-4 w-4" />
            Plagiarism Scans
          </Link>
        </div>
      </div>
    </div>
  )
}
