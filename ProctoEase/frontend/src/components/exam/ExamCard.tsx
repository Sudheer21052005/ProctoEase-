import { Link } from "react-router-dom"
import { formatDuration } from "@/lib/utils"
import { Clock, ArrowRight } from "lucide-react"
import StatusBadge from "@/components/shared/StatusBadge"
import type { Exam } from "@/types"

interface ExamCardProps {
  exam: Exam
  showStartButton?: boolean
  hasActiveAttempt?: boolean
  activeAttemptId?: string
}

export default function ExamCard({
  exam,
  showStartButton = false,
  hasActiveAttempt = false,
  activeAttemptId,
}: ExamCardProps) {
  const targetUrl =
    hasActiveAttempt && activeAttemptId
      ? `/candidate/exam/${exam.id}/attempt/${activeAttemptId}`
      : `/candidate/exam/${exam.id}/preflight`

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6 hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all group relative overflow-hidden">
      {/* Glow on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#6366f1]/0 to-[#6366f1]/0 group-hover:from-[#6366f1]/5 pointer-events-none transition-colors duration-500" />
      
      <div className="flex items-start justify-between mb-3 relative z-10">
        <h3 className="font-bold text-lg text-white group-hover:text-[#6366f1] transition-colors line-clamp-1">
          {exam.title}
        </h3>
        <StatusBadge status={exam.is_published ? "published" : "draft"} />
      </div>

      {exam.description && (
        <p className="text-sm text-slate-400 mb-4 line-clamp-2 relative z-10">
          {exam.description}
        </p>
      )}

      <div className="flex items-center gap-4 text-sm text-slate-500 mb-5 relative z-10 font-medium">
        <span className="flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-slate-600" />
          {formatDuration(exam.duration_minutes)}
        </span>
      </div>

      {showStartButton && (
        <div className="pt-4 border-t border-white/[0.07] relative z-10">
          <Link
            to={targetUrl}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#6366f1] text-white text-sm font-semibold rounded-lg hover:bg-[#4f46e5] transition-all hover:-translate-y-[1px] shadow-[0_4px_12px_-4px_rgba(99,102,241,0.5)] active:scale-[0.98]"
          >
            {hasActiveAttempt ? "Resume Attempt" : "Start Exam"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  )
}
