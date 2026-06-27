import { Link } from "react-router-dom"
import { useSession } from "@/hooks/useSession"
import { useExams } from "@/hooks/useExams"
import {
  reportingApi,
  type RiskDistribution,
} from "@/api/reporting.api"
import { useTenantDashboard } from "@/hooks/useReporting"
import {
  Loader2,
  Shield,
  FileText,
  Users,
  AlertTriangle,
  CheckCircle,
  Download,
  BarChart3,
} from "lucide-react"
import StatusBadge from "@/components/shared/StatusBadge"
import { formatDuration, formatDate } from "@/lib/utils"

const EMPTY_RISK_DISTRIBUTION: RiskDistribution = {
  low: 0,
  medium: 0,
  high: 0,
  critical: 0,
}

export default function AdminDashboard() {
  const { user } = useSession()
  const { data: exams, isLoading: examsLoading } = useExams()
  const { data: stats, isLoading: loading } = useTenantDashboard()

  return (
    <div>
      {/* Welcome */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Tenant-wide overview for {user?.full_name || "Admin"}
          </p>
        </div>
        <button
          onClick={() => reportingApi.exportDashboardCsv()}
          className="hidden sm:inline-flex items-center gap-2 px-3 py-2 border border-border text-sm font-medium rounded-lg hover:bg-muted transition"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Stats grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <span className="text-xs text-muted-foreground">
                  Total Exams
                </span>
              </div>
              <p className="text-3xl font-bold">
                {stats?.total_exams ?? 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.published_exams ?? 0} published
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Users className="h-4 w-4 text-info" />
                </div>
                <span className="text-xs text-muted-foreground">
                  Total Attempts
                </span>
              </div>
              <p className="text-3xl font-bold">
                {stats?.total_attempts ?? 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.completed_attempts ?? 0} completed
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                </div>
                <span className="text-xs text-muted-foreground">
                  Violations
                </span>
              </div>
              <p className="text-3xl font-bold">
                {stats?.total_proctoring_events ?? 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                total proctoring events
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-9 w-9 rounded-lg bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-4 w-4 text-success" />
                </div>
                <span className="text-xs text-muted-foreground">
                  Completion
                </span>
              </div>
              <p className="text-3xl font-bold">
                {stats && stats.total_attempts > 0
                  ? Math.round(
                      (stats.completed_attempts / stats.total_attempts) * 100
                    )
                  : 0}
                %
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                completion rate
              </p>
            </div>
          </div>

          {/* Risk distribution */}
          {stats && (
            <div className="rounded-xl border border-border bg-card p-5 mb-8">
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Risk Distribution Across All Attempts
              </h2>
              {(() => {
                const risk = stats.risk_distribution || EMPTY_RISK_DISTRIBUTION
                const items: Array<{
                  key: keyof RiskDistribution
                  label: string
                  color: string
                  text: string
                }> = [
                  {
                    key: "low",
                    label: "Low Risk",
                    color: "border-green-200 bg-green-50",
                    text: "text-green-700",
                  },
                  {
                    key: "medium",
                    label: "Medium",
                    color: "border-amber-200 bg-amber-50",
                    text: "text-amber-700",
                  },
                  {
                    key: "high",
                    label: "High",
                    color: "border-orange-200 bg-orange-50",
                    text: "text-orange-700",
                  },
                  {
                    key: "critical",
                    label: "Critical",
                    color: "border-red-200 bg-red-50",
                    text: "text-red-700",
                  },
                ]

                return (
              <div className="grid grid-cols-4 gap-3">
                {items.map(({ key, label, color, text }) => (
                  <div
                    key={key}
                    className={`rounded-lg border p-4 text-center ${color}`}
                  >
                    <p className={`text-2xl font-bold ${text}`}>
                      {risk[key] ?? 0}
                    </p>
                    <p className={`text-xs font-medium mt-1 ${text}`}>
                      {label}
                    </p>
                  </div>
                ))}
              </div>
                )
              })()}
            </div>
          )}
        </>
      )}

      {/* All exams table */}
      <section>
        <h2 className="text-lg font-semibold mb-4">All Exams</h2>
        {examsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : exams && exams.length > 0 ? (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium">Title</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">
                    Duration
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">
                    Created
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((exam) => (
                  <tr
                    key={exam.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-medium">{exam.title}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                      {formatDuration(exam.duration_minutes)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={exam.is_published ? "published" : "draft"}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {formatDate(exam.created_at)}
                    </td>
                    <td className="px-4 py-3 flex items-center gap-2">
                      <Link
                        to={`/recruiter/exams/${exam.id}`}
                        className="text-primary text-sm font-medium hover:underline"
                      >
                        Manage
                      </Link>
                      <button
                        onClick={() => reportingApi.exportExamCsv(exam.id)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Export CSV"
                      >
                        <BarChart3 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No exams in this tenant yet.
          </p>
        )}
      </section>
    </div>
  )
}
