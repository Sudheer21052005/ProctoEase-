import { useState } from "react"
import { useParams, Link } from "react-router-dom"
import { usePlagiarismReports, useTriggerPlagiarismScan } from "@/hooks/usePlagiarism"
import { Loader2, AlertTriangle, Play, ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { formatDate } from "@/lib/utils"

export default function PlagiarismList() {
  const { examId } = useParams<{ examId: string }>()
  const {
    data: reports = [],
    isLoading: loading,
    refetch,
  } = usePlagiarismReports(examId || "")
  const triggerScan = useTriggerPlagiarismScan(examId || "")
  const [isScanning, setIsScanning] = useState(false)

  const handleTriggerScan = async () => {
    if (!examId) return
    setIsScanning(true)
    try {
      await triggerScan.mutateAsync(undefined)
      toast.success("Plagiarism scan started!")
      await refetch()
    } catch {
      toast.error("Failed to start scan")
    } finally {
      setIsScanning(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        to={`/recruiter/exams/${examId}`}
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-6 font-medium"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Exam Detail
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-400" />
            Plagiarism Scans
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Analyze code submissions for structural similarity to detect cheating.
          </p>
        </div>
        <button
          onClick={handleTriggerScan}
          disabled={isScanning}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#6366f1] text-white font-semibold rounded-full hover:bg-[#4f46e5] disabled:opacity-50 transition-all hover:-translate-y-[1px] shadow-[0_4px_12px_-4px_rgba(99,102,241,0.5)] active:scale-[0.98]"
        >
          {isScanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4 fill-current" />
          )}
          Run Scan
        </button>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6 relative overflow-hidden">
        {/* Subtle glow */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/20 to-transparent" />
        
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
          </div>
        ) : reports.length > 0 ? (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">
                    Date Compiled
                  </th>
                  <th className="text-left px-4 py-3">Flagged</th>
                  <th className="text-left px-4 py-3">Threshold</th>
                  <th className="text-left px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3 capitalize">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium border ${
                          r.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : r.status === "pending"
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          r.flagged_pairs > 0
                            ? "text-red-400 font-semibold"
                            : "text-slate-500 font-medium"
                        }
                      >
                        {r.flagged_pairs} / {r.total_pairs} pairs
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {(r.threshold * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/recruiter/plagiarism/${r.id}`}
                        className="text-[#6366f1] font-medium hover:text-white transition-colors"
                        aria-disabled={r.status !== "completed"}
                        onClick={(e) => {
                          if (r.status !== "completed") e.preventDefault()
                        }}
                      >
                        View Report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-center text-slate-500 py-6">
            No plagiarism scans run yet.
          </p>
        )}
      </div>
    </div>
  )
}
