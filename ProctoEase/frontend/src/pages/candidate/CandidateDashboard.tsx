import { useSession } from "@/hooks/useSession"
import { useExams } from "@/hooks/useExams"
import { useMyAttempts } from "@/hooks/useAttempts"
import { Loader2, BookOpen, ClipboardCheck } from "lucide-react"
import ExamCard from "@/components/exam/ExamCard"
import StatusBadge from "@/components/shared/StatusBadge"
import EmptyState from "@/components/shared/EmptyState"
import { formatDate } from "@/lib/utils"

export default function CandidateDashboard() {
  const { user } = useSession()
  const { data: exams, isLoading: examsLoading } = useExams()
  const { data: attempts, isLoading: attemptsLoading } = useMyAttempts()

  // Build exam_id -> active attempt_id for direct resume navigation.
  const activeAttemptByExam = new Map<string, string>()
  ;(attempts || [])
    .filter((a) => a.status === "started" && a.is_active)
    .forEach((a) => {
      if (!activeAttemptByExam.has(a.exam_id)) {
        activeAttemptByExam.set(a.exam_id, a.id)
      }
    })

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8 relative">
        {/* Subtle glow */}
        <div className="absolute -top-10 left-10 w-64 h-64 bg-[#6366f1]/10 rounded-full blur-[80px] pointer-events-none" />
        <h1 className="text-2xl font-bold text-white relative z-10">
          Welcome back, {user?.full_name || "Candidate"} 👋
        </h1>
        <p className="text-slate-400 mt-1.5 relative z-10">
          Browse available exams and track your attempts.
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <p className="text-3xl font-bold text-[#6366f1]">
            {exams?.length ?? "—"}
          </p>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mt-2">Available Exams</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <p className="text-3xl font-bold text-amber-400">
            {attempts?.filter((a) => a.status === "started").length ?? "—"}
          </p>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mt-2">In Progress</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <p className="text-3xl font-bold text-emerald-400">
            {attempts?.filter((a) => a.status === "submitted").length ?? "—"}
          </p>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mt-2">Submitted</p>
        </div>
      </div>

      {/* Available Exams */}
      <section className="mb-10 relative z-10">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-[#6366f1]" />
          Available Exams
        </h2>
        {examsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
          </div>
        ) : exams && exams.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {exams.map((exam) => (
              <ExamCard
                key={exam.id}
                exam={exam}
                showStartButton
                hasActiveAttempt={activeAttemptByExam.has(exam.id)}
                activeAttemptId={activeAttemptByExam.get(exam.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No exams available"
            description="Published exams will appear here when your recruiter creates them."
          />
        )}
      </section>

      {/* My Attempts */}
      <section className="relative z-10">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-[#6366f1]" />
          My Attempts
        </h2>
        {attemptsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
          </div>
        ) : attempts && attempts.length > 0 ? (
          <div className="rounded-xl border border-white/[0.07] bg-[#161b27] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="text-left px-4 py-3">Exam</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">
                    Started
                  </th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">
                    Submitted
                  </th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr
                    key={attempt.id}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-slate-300 font-medium">
                      {exams?.find(e => e.id === attempt.exam_id)?.title || attempt.exam_id.slice(0, 8) + "…"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={attempt.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell font-mono text-xs">
                      {formatDate(attempt.started_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell font-mono text-xs">
                      {attempt.submitted_at
                        ? formatDate(attempt.submitted_at)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No attempts yet"
            description="Start an exam to see your attempts here."
          />
        )}
      </section>
    </div>
  )
}
