import { useEffect } from "react"
import { Link, useParams } from "react-router-dom"
import { CheckCircle } from "lucide-react"

export default function ExamComplete() {
  const { examId } = useParams<{ examId: string }>()

  useEffect(() => {
    navigator.mediaDevices
      ?.getUserMedia({ video: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop())
      })
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="max-w-md w-full text-center">
        {/* Animated checkmark */}
        <div className="mx-auto w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-6 animate-bounce">
          <CheckCircle className="h-10 w-10 text-success" />
        </div>

        <h1 className="text-2xl font-bold mb-2">Exam Submitted!</h1>
        <p className="text-muted-foreground mb-6">
          Your responses have been recorded. You will be notified once the exam
          has been evaluated.
        </p>

        <div className="rounded-xl border border-border bg-card p-5 mb-6 text-sm text-left space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Exam ID</span>
            <span className="font-mono text-xs">
              {examId?.slice(0, 8)}…
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="text-blue-600 font-medium">Submitted</span>
          </div>
        </div>

        <Link
          to="/candidate/dashboard"
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary-700 transition"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
