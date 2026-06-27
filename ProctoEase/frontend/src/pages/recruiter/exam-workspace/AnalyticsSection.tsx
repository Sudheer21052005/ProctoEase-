import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { BarChart3, Loader2 } from "lucide-react"
import { useExamAnalytics, useExamQuestionStats } from "@/hooks/useReporting"

function asPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export default function AnalyticsSection() {
  const { examId } = useParams<{ examId: string }>()
  const [page, setPage] = useState(1)
  const pageSize = 8
  const {
    data,
    isLoading,
    isError,
  } = useExamAnalytics(examId || "")
  const {
    data: questionStats,
    isLoading: questionStatsLoading,
  } = useExamQuestionStats(examId || "", page, pageSize)

  // ✅ FIX: All hooks and useMemo MUST be above early returns (Rules of Hooks)
  const noAttempts = data?.total_attempts === 0
  const pages = questionStats?.pages || 1
  const statsRows = useMemo(() => questionStats?.items || [], [questionStats])

  if (isLoading) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-8 text-center">
        <p className="text-slate-500">Could not load analytics for this exam.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-[#6366f1]" />
          Analytics Summary
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">Total Attempts</p>
            <p className="text-2xl font-bold text-white">{data.total_attempts}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">Completion Rate</p>
            <p className="text-2xl font-bold text-white">{asPercent(data.completion_rate)}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">Avg Duration</p>
            <p className="text-2xl font-bold text-white">
              {data.avg_duration_minutes != null ? `${data.avg_duration_minutes} min` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">Avg Risk Score</p>
            <p className="text-2xl font-bold text-white">
              {data.avg_risk_score != null ? data.avg_risk_score.toFixed(2) : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
        <h3 className="font-semibold text-white mb-4">Attempt Status Breakdown</h3>
        {noAttempts ? (
          <p className="text-sm text-slate-500">No attempts yet for this exam.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
              <p className="text-xl font-bold text-amber-400">{data.status_breakdown.started}</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-500/70 mt-1">Started</p>
            </div>
            <div className="rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 p-3 text-center">
              <p className="text-xl font-bold text-[#818cf8]">{data.status_breakdown.submitted}</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6366f1]/70 mt-1">Submitted</p>
            </div>
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
              <p className="text-xl font-bold text-emerald-400">{data.status_breakdown.evaluated}</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-500/70 mt-1">Evaluated</p>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
        <h3 className="font-semibold text-white mb-4">Question Performance (Server-Paginated)</h3>
        {questionStatsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
          </div>
        ) : statsRows.length === 0 ? (
          <p className="text-sm text-slate-500">No question stats available.</p>
        ) : (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.07]">
                  <th className="text-left px-4 py-2.5 font-medium text-slate-400 text-xs uppercase tracking-wide">Question</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-400 text-xs uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-400 text-xs uppercase tracking-wide">Submissions</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-400 text-xs uppercase tracking-wide">Success</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-400 text-xs uppercase tracking-wide">Avg Time</th>
                </tr>
              </thead>
              <tbody>
                {statsRows.map((row) => (
                  <tr key={row.question_id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 max-w-[360px] truncate text-white">{row.question_text}</td>
                    <td className="px-4 py-2.5 capitalize text-slate-400">{row.question_type.replaceAll("_", " ")}</td>
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums">{row.total_submissions}</td>
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums">{asPercent(row.success_rate)}</td>
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums">{row.avg_execution_time_sec != null ? `${row.avg_execution_time_sec}s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
              <span>
                Page {page} of {pages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 border border-white/[0.08] rounded-lg text-white hover:bg-white/[0.05] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  className="px-3 py-1.5 border border-white/[0.08] rounded-lg text-white hover:bg-white/[0.05] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
