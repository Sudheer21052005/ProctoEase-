import { Link } from "react-router-dom"
import { useSession } from "@/hooks/useSession"
import { useExams } from "@/hooks/useExams"
import { reportingApi, type RiskDistribution } from "@/api/reporting.api"
import { useTenantDashboard } from "@/hooks/useReporting"
import { motion } from "framer-motion"
import {
  Loader2, PlusCircle, FileText, CheckCircle, BarChart3,
  AlertTriangle, Download, Users, Upload, Shield, Activity,
} from "lucide-react"
import StatusBadge from "@/components/shared/StatusBadge"
import EmptyState from "@/components/shared/EmptyState"
import { formatDuration, formatDate } from "@/lib/utils"

const EMPTY_RISK_DISTRIBUTION: RiskDistribution = { low: 0, medium: 0, high: 0, critical: 0 }

const RISK_CONFIG = [
  { key: "low"      as const, label: "Low",      bar: "bg-emerald-500", text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  { key: "medium"   as const, label: "Medium",   bar: "bg-amber-400",   text: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/20"   },
  { key: "high"     as const, label: "High",     bar: "bg-orange-500",  text: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/20"  },
  { key: "critical" as const, label: "Critical", bar: "bg-red-500",     text: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20"     },
]

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
}
const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 140, damping: 18 } },
}

interface KpiTileProps {
  icon: React.ElementType
  label: string
  value: string | number
  accent: string
  iconBg: string
}

function KpiTile({ icon: Icon, label, value, accent, iconBg }: KpiTileProps) {
  return (
    <motion.div
      variants={fadeUp}
      className="rounded-xl bg-[#161b27] border border-white/[0.07] p-5 flex items-center gap-4 hover:border-white/[0.12] transition-all"
    >
      <div className={`h-10 w-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
        <Icon className={`h-5 w-5 ${accent}`} strokeWidth={1.5} />
      </div>
      <div>
        <p className={`text-2xl font-bold tabular-nums ${value === "…" ? "text-slate-600" : "text-white"}`}>
          {value}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      </div>
    </motion.div>
  )
}

export default function RecruiterDashboard() {
  const { user } = useSession()
  const { data: exams, isLoading } = useExams()
  const { data: stats, isLoading: loadingStats } = useTenantDashboard()

  const totalExams      = stats?.total_exams      ?? exams?.length ?? 0
  const publishedExams  = stats?.published_exams  ?? exams?.filter((e) => e.is_published).length ?? 0
  const draftExams      = totalExams - publishedExams
  const totalAttempts   = stats?.total_attempts   ?? 0
  const uniqueCandidates= stats?.unique_candidates ?? 0
  const avgRisk         = stats?.average_risk_score
  const totalEvents     = stats?.total_proctoring_events ?? 0
  const totalPlagiarism = stats?.total_plagiarism_reports ?? 0

  const risk = stats?.risk_distribution || EMPTY_RISK_DISTRIBUTION
  const riskTotal = Object.values(risk).reduce((a, b) => a + b, 0) || 1

  // average_risk_score is `number | null` on the backend and undefined while the
  // query is loading — the nullish check narrows both before any comparison.
  const avgRiskLevel =
    avgRisk == null ? null
    : avgRisk > 0.75 ? { label: "CRITICAL", color: "text-red-400" }
    : avgRisk > 0.55 ? { label: "HIGH",     color: "text-orange-400" }
    : avgRisk > 0.3  ? { label: "MEDIUM",   color: "text-amber-400" }
    : { label: "LOW", color: "text-emerald-400" }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#6366f1] mb-1">
            Recruiter
          </p>
          <h1 className="text-2xl font-bold text-white">
            Welcome, {user?.full_name?.split(" ")[0] || "Recruiter"}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage exams and monitor candidate attempts.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <Link
            to="/recruiter/exams/create?mode=pdf"
            className="inline-flex items-center gap-2 px-3 py-2 border border-white/[0.08] text-sm font-medium rounded-xl text-slate-300 hover:bg-white/[0.05] hover:text-white transition-all"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
            Upload PDF
          </Link>
          <Link
            to="/recruiter/exams/create?mode=json"
            className="inline-flex items-center gap-2 px-3 py-2 border border-white/[0.08] text-sm font-medium rounded-xl text-slate-300 hover:bg-white/[0.05] hover:text-white transition-all"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
            Upload JSON
          </Link>
          <button
            onClick={() => reportingApi.exportDashboardCsv()}
            className="inline-flex items-center gap-2 px-3 py-2 border border-white/[0.08] text-sm font-medium rounded-xl text-slate-300 hover:bg-white/[0.05] hover:text-white transition-all"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            Export CSV
          </button>
          <Link
            to="/recruiter/exams/create"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-semibold rounded-full transition-all hover:-translate-y-[1px] hover:shadow-[0_6px_20px_-6px_rgba(99,102,241,0.5)]"
          >
            <PlusCircle className="h-4 w-4" strokeWidth={2} />
            Create Exam
          </Link>
        </div>
      </div>

      {/* 8 KPI Tiles — Bento grid */}
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <KpiTile icon={FileText}    label="Total Exams"      value={totalExams}         accent="text-[#818cf8]"   iconBg="bg-[#6366f1]/12 border border-[#6366f1]/20" />
        <KpiTile icon={CheckCircle} label="Published"        value={publishedExams}     accent="text-emerald-400" iconBg="bg-emerald-500/10 border border-emerald-500/20" />
        <KpiTile icon={FileText}    label="Drafts"           value={draftExams}         accent="text-amber-400"   iconBg="bg-amber-400/10 border border-amber-400/20" />
        <KpiTile icon={Users}       label="Total Attempts"   value={loadingStats ? "…" : totalAttempts}   accent="text-[#38bdf8]"  iconBg="bg-sky-500/10 border border-sky-500/20" />
        <KpiTile icon={Users}       label="Unique Candidates" value={loadingStats ? "…" : uniqueCandidates} accent="text-violet-400" iconBg="bg-violet-500/10 border border-violet-500/20" />
        <KpiTile icon={Shield}      label="Avg Risk Score"
          value={loadingStats ? "…" : avgRisk != null ? `${(avgRisk * 100).toFixed(0)}%` : "N/A"}
          accent={avgRiskLevel?.color ?? "text-slate-400"}
          iconBg="bg-slate-500/10 border border-slate-500/20"
        />
        <KpiTile icon={Activity}    label="Proctoring Events" value={loadingStats ? "…" : totalEvents}     accent="text-orange-400" iconBg="bg-orange-500/10 border border-orange-500/20" />
        <KpiTile icon={AlertTriangle} label="Plagiarism Reports" value={loadingStats ? "…" : totalPlagiarism} accent="text-red-400"  iconBg="bg-red-500/10 border border-red-500/20" />
      </motion.div>

      {/* Risk Distribution — always visible */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="rounded-xl bg-[#161b27] border border-white/[0.07] p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
          <h2 className="text-sm font-semibold text-white">Risk Distribution</h2>
          {avgRiskLevel && (
            <span className={`ml-auto text-xs font-bold ${avgRiskLevel.color}`}>
              AVG {avgRiskLevel.label}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {RISK_CONFIG.map(({ key, label, bar, text, bg, border }) => {
            const count = risk[key] ?? 0
            const pct = Math.round((count / riskTotal) * 100)
            return (
              <div key={key} className={`rounded-xl ${bg} border ${border} p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${text}`}>{label}</span>
                  <span className={`text-lg font-bold tabular-nums ${text}`}>{count}</span>
                </div>
                {/* Progress bar */}
                <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${bar}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                  />
                </div>
                <p className="text-[10px] text-slate-600 mt-1.5 tabular-nums">{pct}% of attempts</p>
              </div>
            )
          })}
        </div>
      </motion.div>

      {/* Mobile CTA */}
      <Link
        to="/recruiter/exams/create"
        className="sm:hidden flex items-center justify-center gap-2 w-full py-2.5 bg-[#6366f1] text-white text-sm font-semibold rounded-full"
      >
        <PlusCircle className="h-4 w-4" strokeWidth={2} />
        Create Exam
      </Link>

      {/* Recent Exams table */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Recent Exams</h2>
          <Link to="/recruiter/exams" className="text-sm text-[#6366f1] font-medium hover:text-[#818cf8] transition-colors">
            View all →
          </Link>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
          </div>
        ) : exams && exams.length > 0 ? (
          <div className="rounded-xl border border-white/[0.07] bg-[#161b27] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.07]">
                  <th className="text-left px-4 py-3 font-medium text-slate-400 text-xs uppercase tracking-wide">Title</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-400 text-xs uppercase tracking-wide hidden sm:table-cell">Duration</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-400 text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-400 text-xs uppercase tracking-wide hidden md:table-cell">Created</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-400 text-xs uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {exams.slice(0, 10).map((exam) => (
                  <tr key={exam.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{exam.title}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs hidden sm:table-cell">
                      {formatDuration(exam.duration_minutes)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={exam.is_published ? "published" : "draft"} />
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs hidden md:table-cell">
                      {formatDate(exam.created_at)}
                    </td>
                    <td className="px-4 py-3 flex items-center gap-3">
                      <Link
                        to={`/recruiter/exams/${exam.id}`}
                        className="text-[#6366f1] text-sm font-medium hover:text-[#818cf8] transition-colors"
                      >
                        View
                      </Link>
                      <button
                        onClick={() => reportingApi.exportExamCsv(exam.id)}
                        className="text-slate-600 hover:text-slate-300 transition-colors"
                        title="Export CSV"
                      >
                        <BarChart3 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No exams yet"
            description="Create your first exam to get started."
            action={
              <Link
                to="/recruiter/exams/create"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#6366f1] text-white text-sm font-semibold rounded-full hover:bg-[#4f46e5] transition-all"
              >
                <PlusCircle className="h-4 w-4" strokeWidth={2} />
                Create Exam
              </Link>
            }
          />
        )}
      </section>
    </div>
  )
}
