import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { Loader2, Users } from "lucide-react"
import { useExamAttemptsPaged } from "@/hooks/useAttempts"
import { formatDate } from "@/lib/utils"
import StatusBadge from "@/components/shared/StatusBadge"
import VirtualizedList from "@/components/shared/VirtualizedList"

export default function AttemptsSection() {
  const { examId } = useParams<{ examId: string }>()
  const [page, setPage] = useState(1)
  const pageSize = 30
  const {
    data,
    isLoading,
    isError,
  } = useExamAttemptsPaged(examId || "", page, pageSize)

  const attempts = data?.items || []
  const total = data?.total || 0
  const pages = data?.pages || 1

  const rows = useMemo(() => attempts, [attempts])

  if (isLoading) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-8 text-center">
        <p className="text-slate-500">Could not load attempts.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Users className="h-5 w-5 text-[#6366f1]" />
        Attempts ({total})
      </h2>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">
          No attempts yet. Attempts will appear once candidates start this exam.
        </p>
      ) : (
        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          <div className="grid grid-cols-12 border-b border-white/[0.07] text-xs font-semibold uppercase tracking-wide text-slate-400">
            <div className="col-span-3 px-4 py-3">Candidate</div>
            <div className="col-span-2 px-4 py-3">Status</div>
            <div className="col-span-4 px-4 py-3">Started</div>
            <div className="col-span-3 px-4 py-3">Submitted</div>
          </div>

          <VirtualizedList
            items={rows}
            height={420}
            rowHeight={54}
            renderRow={(a) => (
              <div
                key={a.id}
                className="grid grid-cols-12 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] text-sm transition-colors"
              >
                <div className="col-span-3 px-4 py-2.5 font-mono text-xs flex items-center text-slate-300">{a.candidate_id.slice(0, 8)}…</div>
                <div className="col-span-2 px-4 py-2.5 flex items-center"><StatusBadge status={a.status} /></div>
                <div className="col-span-4 px-4 py-2.5 text-slate-500 flex items-center font-mono text-xs">{formatDate(a.started_at)}</div>
                <div className="col-span-3 px-4 py-2.5 text-slate-500 flex items-center font-mono text-xs">{a.submitted_at ? formatDate(a.submitted_at) : "—"}</div>
              </div>
            )}
          />

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
  )
}
