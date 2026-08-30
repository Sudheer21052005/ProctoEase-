import { useCallback, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Loader2, Download, ExternalLink, Search, ShieldQuestion, Gavel } from "lucide-react"
import { toast } from "sonner"
import { useExamEvaluation, useSetRecruiterDecision } from "@/hooks/useReporting"
import { reportingApi } from "@/api/reporting.api"
import type { CandidateEvaluation, RecruiterDecisionValue } from "@/api/reporting.api"
import { RECRUITER_DECISIONS } from "@/api/reporting.api"
import FeatureGuard from "@/components/security/FeatureGuard"
import EmptyState from "@/components/shared/EmptyState"
import StatusBadge from "@/components/shared/StatusBadge"
import { cn, formatDuration, formatDate } from "@/lib/utils"
import {
  applyFilters,
  sortCandidates,
  RECOMMENDATION_CODES,
  RISK_LEVELS,
  type SortKey,
  type SortDir,
  type RiskFilter,
  type StatusFilter,
  type RecommendationFilter,
} from "./evaluation.logic"

/** Pill tone per recommendation code — presentation only. */
const REC_TONE: Record<string, string> = {
  INTEGRITY_REVIEW: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  NOT_RECOMMENDED_BOTH: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  NOT_RECOMMENDED_ACADEMIC: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  MANUAL_REVIEW: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  SHORTLIST: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  STRONG_SHORTLIST: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
}

/** Unknown / future codes still render, with a neutral tone and the backend label verbatim. */
function recommendationTone(code: string): string {
  return REC_TONE[code] ?? "border-white/[0.1] bg-white/[0.05] text-slate-300"
}

/** Pill tone per HUMAN recruiter decision (Phase D). Presentation only. */
const DECISION_TONE: Record<string, string> = {
  SHORTLISTED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  REVIEW: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  REJECTED: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  PENDING: "border-white/[0.1] bg-white/[0.05] text-slate-400",
}

function riskTone(level: string): string {
  if (level === "critical") return "bg-rose-500/15 text-rose-400 border-rose-500/30"
  if (level === "high") return "bg-orange-500/15 text-orange-400 border-orange-500/30"
  if (level === "medium") return "bg-amber-400/15 text-amber-400 border-amber-400/30"
  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
}

const PILL_BASE =
  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap"
const PILL_ACTIVE = "bg-[#6366f1] text-white border-[#6366f1]"
const PILL_IDLE = "bg-[#1e2638] text-slate-400 border-white/[0.08] hover:text-white hover:border-white/[0.2]"

function Pill({
  active,
  children,
  onClick,
  title,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
  title?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title} className={cn(PILL_BASE, active ? PILL_ACTIVE : PILL_IDLE)}>
      {children}
    </button>
  )
}

const STATIC_TH =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"

/** One table row. Holds its OWN download/edit state so one action never blocks the table. */
function EvaluationRow({
  candidate,
  onSaveDecision,
}: {
  candidate: CandidateEvaluation
  onSaveDecision: (
    attemptId: string,
    decision: RecruiterDecisionValue,
    notes: string | null
  ) => Promise<{ reviewed_by_email: string | null }>
}) {
  const navigate = useNavigate()
  const [isDownloading, setIsDownloading] = useState(false)

  // Phase D: inline decision editor state (per-row, isolated from the table).
  const [editing, setEditing] = useState(false)
  const [savingDecision, setSavingDecision] = useState(false)
  const [draftDecision, setDraftDecision] = useState<RecruiterDecisionValue>(
    candidate.recruiter_decision ?? "PENDING"
  )
  const [draftNotes, setDraftNotes] = useState(candidate.recruiter_notes ?? "")

  const startEditing = () => {
    setDraftDecision(candidate.recruiter_decision ?? "PENDING")
    setDraftNotes(candidate.recruiter_notes ?? "")
    setEditing(true)
  }

  const handleSaveDecision = async () => {
    if (savingDecision) return
    setSavingDecision(true)
    try {
      const saved = await onSaveDecision(candidate.attempt_id, draftDecision, draftNotes.trim() === "" ? null : draftNotes)
      toast.success(
        saved.reviewed_by_email
          ? `Decision saved — reviewed by ${saved.reviewed_by_email}.`
          : "Recruiter decision saved."
      )
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save the recruiter decision."
      toast.error(message)
    } finally {
      setSavingDecision(false)
    }
  }

  const handleDownload = async () => {
    if (isDownloading) return
    setIsDownloading(true)
    try {
      await reportingApi.downloadIntegrityReportPdf(candidate.attempt_id)
      toast.success("Integrity report downloaded.")
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to download the integrity report."
      toast.error(message)
    } finally {
      setIsDownloading(false)
    }
  }

  const scoreLabel =
    candidate.percentage === null ? "Not graded" : `${candidate.percentage.toFixed(1)}%`

  return (
    <tr className="border-t border-white/[0.06] hover:bg-white/[0.02] align-top">
      {/* 1. Candidate */}
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-white break-words">
          {candidate.candidate_name || "—"}
        </p>
        <p className="text-xs text-slate-500 font-mono break-all">{candidate.candidate_email || "—"}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <StatusBadge status={candidate.status} />
          <span className="text-[11px] text-slate-500">
            {candidate.submitted_at ? formatDate(candidate.submitted_at) : "Not submitted"}
          </span>
          <span className="text-[11px] text-slate-600">·</span>
          <span className="text-[11px] text-slate-500">
            {candidate.duration_minutes === null ? "—" : formatDuration(candidate.duration_minutes)}
          </span>
        </div>
      </td>

      {/* 2. Score */}
      <td className="px-4 py-3 whitespace-nowrap">
        {candidate.percentage === null ? (
          <span className="text-xs text-slate-500">Not graded</span>
        ) : (
          <>
            <p className="text-sm font-semibold text-white">{scoreLabel}</p>
            <p className="text-[11px] text-slate-500 font-mono">
              {candidate.total_score}/{candidate.max_score} pts
            </p>
          </>
        )}
      </td>

      {/* 3. Performance breakdown */}
      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400">
        <p>
          Obj{" "}
          <span className="text-slate-200 font-medium">
            {candidate.objective_score === null ? "—" : `${candidate.objective_score}/${candidate.objective_max_score}`}
          </span>
        </p>
        <p>
          Code{" "}
          <span className="text-slate-200 font-medium">
            {candidate.coding_score === null ? "—" : `${candidate.coding_score}/${candidate.coding_max_score}`}
          </span>
        </p>
      </td>

      {/* 4. System recommendation — rendered VERBATIM from the backend */}
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex px-2.5 py-1 text-xs font-semibold rounded-full border",
            recommendationTone(candidate.recommendation.code)
          )}
          title={candidate.recommendation.reason}
        >
          {candidate.recommendation.label}
        </span>
        <p className="text-[11px] text-slate-500 mt-1.5 max-w-[260px] break-words">
          {candidate.recommendation.reason}
        </p>
      </td>

      {/* 5. Risk */}
      <td className="px-4 py-3 whitespace-nowrap">
        {!candidate.risk_available ? (
          <span className="text-xs text-slate-500">N/A</span>
        ) : (
          <>
            <span
              className={cn(
                "inline-flex px-2.5 py-1 text-xs font-bold rounded-full border uppercase", riskTone(candidate.risk_level || "low")
              )}
            >
              {candidate.risk_level}
            </span>
            <p className="text-[11px] text-slate-500 font-mono mt-1">
              {(candidate.risk_score ?? 0).toFixed(2)}
            </p>
          </>
        )}
      </td>

      {/* 6. Violations */}
      <td className="px-4 py-3 whitespace-nowrap">
        <p className="text-sm font-semibold text-white">{candidate.total_violations}</p>
        {candidate.critical_violations > 0 ? (
          <p className="text-[11px] text-rose-400 font-medium">
            {candidate.critical_violations} crit
            {candidate.high_violations > 0 ? ` · ${candidate.high_violations} high` : ""}
          </p>
        ) : candidate.high_violations > 0 ? (
          <p className="text-[11px] text-orange-400 font-medium">{candidate.high_violations} high</p>
        ) : (
          <p className="text-[11px] text-slate-600">no high/critical</p>
        )}
      </td>

      {/* 7. Recruiter decision — final HUMAN judgment, separate from the
          system recommendation above and never overwriting it */}
      <td className="px-4 py-3">
        {editing ? (
          <div className="min-w-[220px] space-y-2" aria-label={`Decision editor for ${candidate.candidate_name || candidate.attempt_id}`}>
            <select
              value={draftDecision}
              onChange={(e) => setDraftDecision(e.target.value as RecruiterDecisionValue)}
              aria-label="Recruiter decision"
              className="w-full px-2.5 py-1.5 rounded-lg border border-white/[0.08] bg-[#1e2638] text-xs text-white outline-none focus:border-[#6366f1]/50"
            >
              {RECRUITER_DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <textarea
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Review notes (evidence, rationale)…"
              aria-label="Recruiter notes"
              className="w-full px-2.5 py-1.5 rounded-lg border border-white/[0.08] bg-[#1e2638] text-xs text-white placeholder:text-slate-500 outline-none focus:border-[#6366f1]/50 resize-y"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={savingDecision}
                onClick={handleSaveDecision}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6366f1] text-xs font-semibold text-white hover:bg-[#4f52e0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingDecision && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {savingDecision ? "Saving…" : "Save decision"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#1e2638] text-xs font-medium text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <span
              className={cn(
                "inline-flex px-2.5 py-1 text-xs font-semibold rounded-full border",
                DECISION_TONE[candidate.recruiter_decision ?? "PENDING"]
              )}
              title={candidate.recruiter_notes ?? undefined}
            >
              {candidate.recruiter_decision ?? "PENDING"}
            </span>
            {candidate.recruiter_notes ? (
              <p className="text-[11px] text-slate-500 mt-1.5 max-w-[220px] break-words line-clamp-2">
                {candidate.recruiter_notes}
              </p>
            ) : null}
            <p className="text-[11px] text-slate-500 mt-1.5">
              {candidate.reviewed_at ? `Reviewed ${formatDate(candidate.reviewed_at)}` : "Not reviewed yet"}
            </p>
            <button
              type="button"
              onClick={startEditing}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#1e2638] text-xs font-medium text-slate-200 hover:border-[#6366f1]/50 hover:text-white transition-colors"
            >
              <Gavel className="h-3.5 w-3.5" />
              Decide
            </button>
          </>
        )}
      </td>

      {/* 8. Actions */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => navigate(`../review?attemptId=${candidate.attempt_id}`)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#1e2638] text-xs font-medium text-slate-200 hover:border-[#6366f1]/50 hover:text-white transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Review
          </button>
          <button
            type="button"
            disabled={isDownloading}
            onClick={handleDownload}
            aria-label="Download Integrity Report"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#1e2638] text-xs font-medium text-slate-200 hover:border-[#6366f1]/50 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {isDownloading ? "Generating…" : "Report"}
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function EvaluationSection() {
  const { examId } = useParams<{ examId: string }>()
  const { data, isLoading, isError, refetch, isFetching } = useExamEvaluation(examId || "")

  const [search, setSearch] = useState("")
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all")
  const [recFilter, setRecFilter] = useState<RecommendationFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [severeOnly, setSevereOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("recommendation")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const candidates = data?.candidates ?? []

  const decisionMutation = useSetRecruiterDecision(examId || "")
  const saveDecision = useCallback(
    async (attemptId: string, decision: RecruiterDecisionValue, notes: string | null) =>
      decisionMutation.mutateAsync({ attemptId, payload: { decision, notes } }),
    [decisionMutation]
  )

  const rows = useMemo(
    () =>
      sortCandidates(
        applyFilters(candidates, {
          search,
          risk: riskFilter,
          recommendation: recFilter,
          status: statusFilter,
          severeOnly,
        }),
        sortKey,
        sortDir
      ),
    [candidates, search, riskFilter, recFilter, statusFilter, severeOnly, sortKey, sortDir]
  )

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const clearFilters = () => {
    setSearch("")
    setRiskFilter("all")
    setRecFilter("all")
    setStatusFilter("all")
    setSevereOnly(false)
  }

  const hasActiveFilters =
    search !== "" || riskFilter !== "all" || recFilter !== "all" || statusFilter !== "all" || severeOnly

  return (
    <FeatureGuard allowedRoles={["recruiter", "admin"]}>
      <div className="space-y-5">
        {/* Header + disclaimer + legend */}
        <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <ShieldQuestion className="h-5 w-5 text-[#6366f1]" strokeWidth={1.5} />
                Exam-wide Evaluation
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {data?.exam_title ? `${data.exam_title} — ` : ""}
                {candidates.length} attempt{candidates.length === 1 ? "" : "s"}
                {isFetching ? " · refreshing…" : ""}
              </p>
            </div>
            <p className="text-xs text-slate-500 max-w-sm text-right">
              System recommendations are automated decision support, not a final
              hiring decision. The{" "}
              <span className="text-slate-300 font-medium">Recruiter Decision</span>{" "}
              is the final human judgment — it never alters the System
              Recommendation.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-white/[0.06]">
            <span className="text-[11px] uppercase tracking-widest text-slate-600 self-center mr-1">
              Legend
            </span>
            {RECOMMENDATION_CODES.map((code) => (
              <span
                key={code}
                className={cn(
                  "inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full border",
                  recommendationTone(code)
                )}
              >
                {code.replaceAll("_", " ").toLowerCase()}
              </span>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-14" data-testid="evaluation-loading">
            <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-8 text-center">
            <p className="text-slate-400 mb-4">Could not load the exam evaluation.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/[0.08] bg-[#1e2638] text-sm font-medium text-slate-200 hover:border-[#6366f1]/50 hover:text-white transition-colors"
            >
              Retry
            </button>
          </div>
        ) : candidates.length === 0 ? (
          <EmptyState
            title="No attempts yet"
            description="This exam has no candidate attempts to evaluate."
          />
        ) : (
          <>
            {/* Search + filters */}
            <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-5 space-y-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, email or attempt id…"
                  aria-label="Search candidates"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-white/[0.08] bg-[#1e2638] text-sm text-white placeholder:text-slate-500 outline-none focus:border-[#6366f1]/50"
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-widest text-slate-600">Risk</span>
                  <Pill active={riskFilter === "all"} onClick={() => setRiskFilter("all")}>All</Pill>
                  {RISK_LEVELS.map((level) => (
                    <Pill key={level} active={riskFilter === level} onClick={() => setRiskFilter(level)}>
                      <span className="capitalize">{level}</span>
                    </Pill>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-widest text-slate-600">Status</span>
                  <Pill active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</Pill>
                  {(["started", "submitted", "evaluated"] as const).map((s) => (
                    <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                      <span className="capitalize">{s}</span>
                    </Pill>
                  ))}
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={severeOnly}
                    onChange={(e) => setSevereOnly(e.target.checked)}
                    className="accent-[#6366f1]"
                  />
                  Severe integrity only
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-widest text-slate-600">Recommendation</span>
                <Pill active={recFilter === "all"} onClick={() => setRecFilter("all")}>All</Pill>
                {RECOMMENDATION_CODES.map((code) => (
                  <Pill
                    key={code}
                    active={recFilter === code}
                    onClick={() => setRecFilter(code)}
                    title={code}
                  >
                    {code.replaceAll("_", " ").toLowerCase()}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Table */}
            {rows.length === 0 ? (
              <EmptyState
                title="No candidates match"
                description="No attempt matches the current search and filters."
                action={
                  hasActiveFilters ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="px-4 py-2 rounded-xl border border-white/[0.08] bg-[#1e2638] text-sm font-medium text-slate-200 hover:border-[#6366f1]/50 hover:text-white transition-colors"
                    >
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div className="rounded-xl border border-white/[0.07] bg-[#161b27] overflow-x-auto">
                <table className="w-full text-sm min-w-[1160px]">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <th className="px-4 py-3 text-left">
                        <SortHeader label="Candidate" active={sortKey === "candidate"} dir={sortDir} onClick={() => toggleSort("candidate")} />
                      </th>
                      <th className="px-4 py-3 text-left">
                        <SortHeader label="Score" active={sortKey === "score"} dir={sortDir} onClick={() => toggleSort("score")} />
                      </th>
                      <th className={STATIC_TH}>Performance</th>
                      <th className="px-4 py-3 text-left">
                        <SortHeader label="System Recommendation" active={sortKey === "recommendation"} dir={sortDir} onClick={() => toggleSort("recommendation")} />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Recruiter Decision
                      </th>
                      <th className="px-4 py-3 text-left">
                        <SortHeader label="Risk" active={sortKey === "risk"} dir={sortDir} onClick={() => toggleSort("risk")} />
                      </th>
                      <th className="px-4 py-3 text-left">
                        <SortHeader label="Violations" active={sortKey === "violations"} dir={sortDir} onClick={() => toggleSort("violations")} />
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((candidate) => (
                      <EvaluationRow key={candidate.attempt_id} candidate={candidate} onSaveDecision={saveDecision} />
                    ))}
                  </tbody>
                </table>
                <p className="px-4 py-3 text-[11px] text-slate-600 border-t border-white/[0.06]">
                  Showing {rows.length} of {candidates.length} candidates
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </FeatureGuard>
  )
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
    >
      {label}
      <span aria-hidden className={active ? "text-[#6366f1]" : "text-slate-700"}>
        {active ? (dir === "asc" ? "▲" : "▼") : "▾"}
      </span>
    </button>
  )
}
