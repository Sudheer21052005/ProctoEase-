import { Link } from "react-router-dom"
import { useState } from "react"
import { useExams } from "@/hooks/useExams"
import { Loader2, PlusCircle, Search } from "lucide-react"
import StatusBadge from "@/components/shared/StatusBadge"
import EmptyState from "@/components/shared/EmptyState"
import { formatDuration, formatDate } from "@/lib/utils"

type Filter = "all" | "published" | "draft"

export default function ExamList() {
  const { data: exams, isLoading } = useExams()
  const [filter, setFilter] = useState<Filter>("all")
  const [search, setSearch] = useState("")

  const filtered = exams?.filter((e) => {
    if (filter === "published" && !e.is_published) return false
    if (filter === "draft" && e.is_published) return false
    if (search && !e.title.toLowerCase().includes(search.toLowerCase()))
      return false
    return true
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6 relative">
        <h1 className="text-2xl font-bold text-white relative z-10">Exams</h1>
        <Link
          to="/recruiter/exams/create"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#6366f1] text-white text-sm font-semibold rounded-lg hover:bg-[#4f46e5] transition-all hover:-translate-y-[1px] shadow-[0_4px_12px_-4px_rgba(99,102,241,0.5)] active:scale-[0.98] relative z-10"
        >
          <PlusCircle className="h-4 w-4" />
          Create Exam
        </Link>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 relative z-10">
        <div className="relative flex-1 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-[#6366f1] transition-colors" />
          <input
            type="text"
            placeholder="Search exams…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-white/[0.07] bg-[#161b27] text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#6366f1]/30 focus:border-[#6366f1] placeholder:text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-white/[0.07] p-1 bg-white/[0.02]">
          {(["all", "published", "draft"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${
                filter === f
                  ? "bg-[#161b27] border border-white/[0.07] shadow-sm text-white"
                  : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
        </div>
      ) : filtered && filtered.length > 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-[#161b27] overflow-hidden relative z-10 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="text-left px-4 py-4">Title</th>
                <th className="text-left px-4 py-4 hidden sm:table-cell">
                  Duration
                </th>
                <th className="text-left px-4 py-4">Status</th>
                <th className="text-left px-4 py-4 hidden md:table-cell">
                  Created
                </th>
                <th className="text-left px-4 py-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((exam) => (
                <tr
                  key={exam.id}
                  className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-300">{exam.title}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs hidden sm:table-cell">
                    {formatDuration(exam.duration_minutes)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      status={exam.is_published ? "published" : "draft"}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs hidden md:table-cell">
                    {formatDate(exam.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/recruiter/exams/${exam.id}`}
                      className="text-[#6366f1] text-sm font-semibold hover:text-white transition-colors"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No exams found"
          description={
            search
              ? "Try a different search term."
              : "Create your first exam to get started."
          }
          action={
            !search ? (
              <Link
                to="/recruiter/exams/create"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#6366f1] text-white text-sm font-semibold rounded-lg hover:bg-[#4f46e5] transition-all"
              >
                <PlusCircle className="h-4 w-4" />
                Create Exam
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
