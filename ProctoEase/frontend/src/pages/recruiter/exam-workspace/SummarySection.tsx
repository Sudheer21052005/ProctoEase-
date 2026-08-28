import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { Loader2, ShieldCheck, ShieldAlert, UserRound, Camera, FileCode2, Download } from "lucide-react"
import { toast } from "sonner"
import { useExamAttempts, useAnswers } from "@/hooks/useAttempts"
import { useAttemptRiskScore, useExamRiskScores } from "@/hooks/useRisk"
import { useAttemptViolationCount, useAttemptEventsPaged } from "@/hooks/useProctoringData"
import { useAttemptCodeSubmissions } from "@/hooks/useCodeExecution"
import { formatDate } from "@/lib/utils"
import { API_BASE_URL } from "@/lib/constants"
import FeatureGuard from "@/components/security/FeatureGuard"
import { reportingApi } from "@/api/reporting.api"

function riskTone(level?: string) {
  const value = (level || "").toLowerCase()
  if (value === "critical") return "bg-rose-500/15 text-rose-400 border-rose-500/30"
  if (value === "high") return "bg-orange-500/15 text-orange-400 border-orange-500/30"
  if (value === "medium") return "bg-amber-400/15 text-amber-400 border-amber-400/30"
  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
}

function riskNarrative(level: string | undefined, totalViolations: number, isCalculatingRisk: boolean) {
  if (isCalculatingRisk) return "Calculating risk..."
  const value = (level || "").toLowerCase()
  if (totalViolations === 0) return "Clean session"
  if (value === "low") return "Low-risk activity detected"
  if (value === "critical") return "Severe violations - disqualification recommended"
  if (value === "high") return "Multiple violations - manual review required"
  if (value === "medium") return "Minor violations - review recommended"
  return "Low-risk activity detected"
}

function toDurationLabel(startedAt?: string | null, submittedAt?: string | null) {
  if (!startedAt) return "N/A"
  const start = new Date(startedAt).getTime()
  const end = submittedAt ? new Date(submittedAt).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "N/A"

  const diffMs = end - start
  const totalMin = Math.floor(diffMs / 60000)
  const hrs = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hrs <= 0) return `${mins} min`
  return `${hrs} hr ${mins} min`
}

function scoreBand(scorePercent: number) {
  if (scorePercent >= 80) return "Strong performer"
  if (scorePercent >= 60) return "Average performer"
  return "Below average"
}

function getRecommendation(riskLevel: string, scorePercent: number) {
  const level = (riskLevel || "low").toLowerCase()

  if (level === "critical") {
    return {
      verdict: "DO NOT ADVANCE",
      color: "rose",
      reason: "Critical integrity violations detected. Exam integrity cannot be confirmed.",
      action: "Review violation evidence and consider disqualification.",
    }
  }

  if (level === "high" && scorePercent < 60) {
    return {
      verdict: "DO NOT ADVANCE",
      color: "rose",
      reason: "High violation count combined with poor performance.",
      action: "Manual review required before decision.",
    }
  }

  if (level === "high" && scorePercent >= 60) {
    return {
      verdict: "REVIEW REQUIRED",
      color: "amber",
      reason: "Good performance but significant integrity concerns.",
      action: "Interview candidate to verify knowledge.",
    }
  }

  if (level === "medium") {
    return {
      verdict: "CONDITIONAL ADVANCE",
      color: "amber",
      reason: "Minor violations detected. Performance meets threshold.",
      action: "Proceed with next round but note concerns.",
    }
  }

  return {
    verdict: "ADVANCE TO NEXT ROUND",
    color: "emerald",
    reason: "Clean session with acceptable performance.",
    action: "Candidate cleared for next stage.",
  }
}

function recommendationTone(color: string) {
  if (color === "rose") return "border-rose-500/30 bg-rose-500/10 text-rose-300"
  if (color === "amber") return "border-amber-400/30 bg-amber-400/10 text-amber-200"
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
}

export default function SummarySection() {
  const { examId } = useParams<{ examId: string }>()

  const {
    data: attempts = [],
    isLoading: attemptsLoading,
    isError: attemptsError,
  } = useExamAttempts(examId || "")

  const {
    data: riskSummaries = [],
  } = useExamRiskScores(examId || "")

  const [selectedAttemptId, setSelectedAttemptId] = useState("")
  const [isDownloadingReport, setIsDownloadingReport] = useState(false)

  useEffect(() => {
    if (!selectedAttemptId && attempts.length > 0) {
      setSelectedAttemptId(attempts[0].id)
    }
  }, [attempts, selectedAttemptId])

  const selectedAttempt = useMemo(
    () => attempts.find((a) => a.id === selectedAttemptId),
    [attempts, selectedAttemptId]
  )

  const summaryRisk = useMemo(
    () => riskSummaries.find((s) => s.attempt_id === selectedAttemptId),
    [riskSummaries, selectedAttemptId]
  )

  const { data: riskScore, isLoading: riskLoading } = useAttemptRiskScore(
    selectedAttemptId,
    !!selectedAttemptId
  )

  useEffect(() => {
    console.log("[UI SCORE]", riskScore)
  }, [riskScore])

  const { data: violationCount, isLoading: violationsLoading } = useAttemptViolationCount(
    selectedAttemptId,
    !!selectedAttemptId
  )

  const { data: answersData, isLoading: answersLoading } = useAnswers(
    selectedAttemptId,
    !!selectedAttemptId
  )

  const { data: codeSubs = [], isLoading: codeLoading } = useAttemptCodeSubmissions(
    selectedAttemptId,
    !!selectedAttemptId
  )

  const { data: eventsData, isLoading: eventsLoading } = useAttemptEventsPaged(
    selectedAttemptId,
    1,
    200,
    !!selectedAttemptId
  )

  const totalViolations = violationCount?.total || 0
  const isRiskCalculating = totalViolations > 0 && !riskScore
  const activeRiskLevel = (riskScore?.risk_level || summaryRisk?.risk_level || "low").toLowerCase()
  const riskPercent = isRiskCalculating
    ? null
    : Math.round((riskScore?.overall_score || summaryRisk?.overall_score || 0) * 100)
  const integrityNarrative = riskNarrative(activeRiskLevel, totalViolations, isRiskCalculating)

  const topViolations = useMemo(() => {
    const byType = violationCount?.by_type || {}
    return Object.entries(byType)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
  }, [violationCount])

  const maxViolationCount = topViolations[0]?.[1] || 1

  const scoreValue = answersData?.total_score || 0
  const maxScore = answersData?.max_score || 0
  const scorePercent = maxScore > 0 ? Math.round((scoreValue / maxScore) * 100) : 0

  const correctCount = useMemo(
    () => (answersData?.answers || []).filter((a) => a.is_correct === true).length,
    [answersData]
  )
  const answeredCount = answersData?.answers?.length || 0

  const recommendation = getRecommendation(activeRiskLevel, scorePercent)

  const snapshotItems = useMemo(() => {
    const items = eventsData?.items || []
    return items
      .filter((evt) => !!(evt.snapshot_url || evt.snapshot_path))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 4)
  }, [eventsData])

  const uploadsBase = useMemo(() => API_BASE_URL.replace("/api/v1", ""), [])
  const toSnapshotHref = (path: string) => `${uploadsBase}/${path}`
  const toVerificationImageSrc = useCallback((path?: string | null) => {
    if (!path) return ""
    if (path.startsWith("data:image/")) return path
    if (path.startsWith("http://") || path.startsWith("https://")) return path
    return `${uploadsBase}/${path.replace(/^\/+/, "")}`
  }, [uploadsBase])

  const verificationImageSrc = useMemo(
    () => toVerificationImageSrc(selectedAttempt?.verification_image_url),
    [selectedAttempt?.verification_image_url, toVerificationImageSrc]
  )

  useEffect(() => {
    console.log("[IDENTITY IMAGE]", selectedAttempt)
  }, [selectedAttempt])

  if (attemptsLoading) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
      </div>
    )
  }

  if (attemptsError) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-8 text-center">
        <p className="text-slate-500">Could not load attempts for summary view.</p>
      </div>
    )
  }

  if (attempts.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-8 text-center">
        <p className="text-slate-500">No attempts available for this exam.</p>
      </div>
    )
  }

  return (
    <FeatureGuard allowedRoles={["recruiter", "admin"]}>
      <div className="space-y-5">
        <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" strokeWidth={1.5} />
            Candidate Session Summary
          </h2>

          <label className="text-xs font-semibold uppercase tracking-widest text-slate-500 block mb-2">Attempt</label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedAttemptId}
              onChange={(e) => setSelectedAttemptId(e.target.value)}
              className="flex-1 min-w-0 max-w-xl px-3 py-2.5 rounded-xl border border-white/[0.08] bg-[#1e2638] text-white text-sm outline-none focus:border-[#6366f1]/50"
            >
              {attempts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.candidate_email
                    ? `${a.candidate_email} | ${a.status}`
                    : `${a.id.slice(0, 8)}... | ${a.status}`}
                </option>
              ))}
            </select>

            <button
              id="btn-download-integrity-report"
              disabled={!selectedAttemptId || isDownloadingReport}
              onClick={async () => {
                if (!selectedAttemptId || isDownloadingReport) return
                setIsDownloadingReport(true)
                try {
                  await reportingApi.downloadIntegrityReportPdf(selectedAttemptId)
                  toast.success("Integrity report downloaded.")
                } catch (err) {
                  const message =
                    err instanceof Error
                      ? err.message
                      : "Unable to download the integrity report."
                  toast.error(message)
                } finally {
                  setIsDownloadingReport(false)
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/[0.08] bg-[#1e2638] text-sm font-medium text-slate-200 hover:border-[#6366f1]/50 hover:text-white hover:bg-[#252f44] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#1e2638] shrink-0"
              aria-label="Download candidate integrity report PDF"
            >
              {isDownloadingReport ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" strokeWidth={1.75} />
              )}
              {isDownloadingReport ? "Generating…" : "Download Integrity Report"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <section className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <UserRound className="h-4 w-4 text-slate-300" />
              <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Candidate Identity</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-3">
                <p className="text-2xl font-bold text-white break-all">
                  {selectedAttempt?.candidate_email || "Unknown candidate"}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-3">
                    <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Duration</p>
                    <p className="text-sm text-white font-semibold">
                      {toDurationLabel(selectedAttempt?.started_at, selectedAttempt?.submitted_at)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-3">
                    <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Status</p>
                    <span className="inline-flex px-2.5 py-1 text-xs rounded-full border border-white/[0.1] bg-white/[0.05] text-slate-200 capitalize">
                      {selectedAttempt?.status || "unknown"}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-3">
                  <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Submitted At</p>
                  <p className="text-sm text-white font-semibold">
                    {selectedAttempt?.submitted_at ? formatDate(selectedAttempt.submitted_at) : "Not submitted yet"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-3 flex items-center justify-center min-h-[168px]">
                {verificationImageSrc ? (
                  <img
                    src={verificationImageSrc}
                    alt="Candidate verification"
                    className="w-full h-full max-h-[180px] object-cover rounded-lg"
                  />
                ) : (
                  <div className="text-center text-slate-500 text-xs">
                    <Camera className="h-5 w-5 mx-auto mb-1" />
                    No verification photo
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Integrity Score</h3>
            </div>

            {riskLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
              </div>
            ) : (
              <div className="space-y-3">
                <span className={`inline-flex px-3 py-1.5 text-xs font-bold rounded-full border ${riskTone(activeRiskLevel)}`}>
                  {isRiskCalculating ? "CALCULATING" : activeRiskLevel.toUpperCase()}
                </span>
                <p className="text-3xl font-bold text-white">
                  {riskPercent === null ? "--" : `${riskPercent}%`}
                </p>
                <p className="text-sm text-slate-400">
                  Total proctoring events: <span className="text-white font-semibold">{violationCount?.total || 0}</span>
                </p>
                <p className="text-sm text-slate-300">{integrityNarrative}</p>
              </div>
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-4">Top Violations</h3>
            {violationsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
              </div>
            ) : topViolations.length === 0 ? (
              <p className="text-sm text-slate-500">No violations found for this attempt.</p>
            ) : (
              <div className="space-y-3">
                {topViolations.map(([type, count]) => {
                  const pct = Math.max(8, Math.round((count / maxViolationCount) * 100))
                  return (
                    <div key={type} className="grid grid-cols-[1fr_2fr_auto] items-center gap-3">
                      <p className="text-sm text-slate-300 capitalize truncate">{type.replaceAll("_", " ")}</p>
                      <div className="h-2 bg-white/[0.07] rounded-full overflow-hidden">
                        <div className="h-full bg-[#6366f1] rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-slate-400 font-mono">{count} events</p>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-4">Performance Snapshot</h3>
            {answersLoading || codeLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-2xl font-bold text-white">
                  {scoreValue} / {maxScore}
                </p>
                <p className="text-sm text-slate-300">
                  Correct answers: <span className="font-semibold text-white">{correctCount}</span> / {answeredCount}
                </p>
                <p className="text-sm text-slate-300">
                  Score band: <span className="font-semibold text-white">{scoreBand(scorePercent)}</span>
                </p>
                <p className="text-sm text-slate-300">
                  Code submissions: <span className="font-semibold text-white">{codeSubs.length}</span>
                </p>
              </div>
            )}
          </section>
        </div>

        <section className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-4">Recommendation</h3>
          <div className={`rounded-xl border p-5 ${recommendationTone(recommendation.color)}`}>
            <p className="text-xl font-extrabold tracking-wide">{recommendation.verdict}</p>
            <p className="text-sm mt-2">{recommendation.reason}</p>
            <p className="text-sm mt-2">
              Action: <span className="font-semibold">{recommendation.action}</span>
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-slate-300" />
            Photo Evidence Strip
          </h3>

          {eventsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
            </div>
          ) : snapshotItems.length === 0 ? (
            <p className="text-sm text-slate-500">No snapshots available for this attempt.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {snapshotItems.map((evt) => {
                const path = evt.snapshot_url || evt.snapshot_path || ""
                return (
                  <a
                    key={evt.id}
                    href={toSnapshotHref(path)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-white/[0.08] bg-[#1a2033] overflow-hidden hover:border-[#6366f1]/60 transition-colors"
                  >
                    <img
                      src={toSnapshotHref(path)}
                      alt={evt.event_type}
                      className="w-full h-28 object-cover"
                    />
                    <div className="p-2.5">
                      <p className="text-xs text-slate-200 capitalize truncate">{evt.event_type.replaceAll("_", " ")}</p>
                      <p className="text-[11px] text-slate-500 mt-1">{formatDate(evt.created_at)}</p>
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </FeatureGuard>
  )
}
