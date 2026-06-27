import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { AlertTriangle, Loader2, RefreshCcw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { useExamAttempts } from "@/hooks/useAttempts"
import { useAttemptRiskScore, useComputeAttemptRisk, useExamRiskScores } from "@/hooks/useRisk"
import { formatDate } from "@/lib/utils"
import FeatureGuard from "@/components/security/FeatureGuard"

const DEFAULT_WEIGHTS = {
  tab_switch: 0.3,
  fullscreen_exit: 0.3,
  keyboard_block: 0.25,
  copy_paste: 0.4,
  right_click: 0.2,
  browser_devtools: 0.6,
  inactivity: 0.2,
  no_face: 0.6,
  multiple_faces: 0.8,
  audio_anomaly: 0.4,
  custom: 0.1,
  rapid_tab_switching: 0.5,
  suspicious_activity_burst: 0.6,
  bulk_paste_detected: 0.5,
  impossible_answer_speed: 0.4,
  face_inconsistency: 0.5,
  periodic_check: 0.05,
  gaze_away: 0.3,
  head_turned: 0.25,
  phone_detected: 0.9,
  unauthorized_object: 0.8,
}

function scoreTone(level?: string) {
  const value = (level || "").toLowerCase()
  if (value === "critical") return "bg-red-500/15 text-red-400 border-red-500/30"
  if (value === "high")     return "bg-orange-500/15 text-orange-400 border-orange-500/30"
  if (value === "medium")   return "bg-amber-400/15 text-amber-400 border-amber-400/30"
  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
}

function breakdownBarColor(contribution: number, max: number) {
  const pct = max > 0 ? contribution / max : 0
  if (pct > 0.7) return "bg-red-500"
  if (pct > 0.4) return "bg-amber-400"
  if (pct > 0.2) return "bg-orange-400"
  return "bg-[#6366f1]"
}

export default function RiskSection() {
  const { examId } = useParams<{ examId: string }>()
  const {
    data: attempts = [],
    isLoading: attemptsLoading,
    isError: attemptsError,
  } = useExamAttempts(examId || "")
  const {
    data: summaries = [],
    isLoading: summariesLoading,
  } = useExamRiskScores(examId || "")

  const [selectedAttemptId, setSelectedAttemptId] = useState("")
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS)

  useEffect(() => {
    if (!selectedAttemptId && attempts.length > 0) {
      setSelectedAttemptId(attempts[0].id)
    }
  }, [attempts, selectedAttemptId])

  const { data: selectedRisk, isLoading: riskLoading } = useAttemptRiskScore(
    selectedAttemptId,
    !!selectedAttemptId
  )
  const computeRisk = useComputeAttemptRisk()

  const summaryMap = useMemo(() => {
    const m = new Map<string, (typeof summaries)[number]>()
    summaries.forEach((s) => m.set(s.attempt_id, s))
    return m
  }, [summaries])

  const recompute = async () => {
    if (!selectedAttemptId) return
    try {
      await computeRisk.mutateAsync({ attemptId: selectedAttemptId, weights })
      toast.success("Risk score computed")
    } catch {
      toast.error("Failed to compute risk score")
    }
  }

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
        <p className="text-slate-500">Could not load attempts for risk scoring.</p>
      </div>
    )
  }

  if (attempts.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-8 text-center">
        <p className="text-slate-500">No attempts available for risk scoring.</p>
      </div>
    )
  }

  return (
    <FeatureGuard allowedRoles={["recruiter", "admin"]}>
    <div className="space-y-5">
      {/* Attempt selector + recompute */}
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-400" strokeWidth={1.5} />
          Risk Scoring
        </h2>

        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1">
            <label className="text-xs font-semibold uppercase tracking-widest text-slate-500 block mb-2">Attempt</label>
            <select
              value={selectedAttemptId}
              onChange={(e) => setSelectedAttemptId(e.target.value)}
              className="w-full max-w-xl px-3 py-2.5 rounded-xl border border-white/[0.08] bg-[#1e2638] text-white text-sm outline-none focus:border-[#6366f1]/50"
            >
              {attempts.map((a) => {
                const risk = summaryMap.get(a.id)
                return (
                  <option key={a.id} value={a.id}>
                    {a.candidate_email
                      ? `${a.candidate_email} | ${risk?.risk_level || "not computed"}`
                      : `${a.id.slice(0, 8)}… | ${risk?.risk_level || "not computed"}`}
                  </option>
                )
              })}
            </select>
          </div>

          <button
            onClick={recompute}
            disabled={computeRisk.isPending || !selectedAttemptId}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-semibold transition-all hover:-translate-y-[1px] hover:shadow-[0_6px_20px_-6px_rgba(99,102,241,0.5)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {computeRisk.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" strokeWidth={2} />
            )}
            Recompute Risk
          </button>
        </div>

        {/* Weight sliders */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-5">
          {Object.entries(weights).map(([key, value]) => (
            <label key={key} className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 block mb-1.5">
                {key.replaceAll("_", " ")}
              </span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={value}
                onChange={(e) => {
                  const parsed = Number.parseFloat(e.target.value)
                  setWeights((prev) => ({
                    ...prev,
                    [key]: Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0,
                  }))
                }}
                className="w-full px-2 py-1.5 border border-white/[0.06] rounded-lg bg-[#0f1117] text-white text-sm font-mono tabular-nums outline-none focus:border-[#6366f1]/50"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Risk result */}
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
        <h3 className="font-semibold text-white mb-4">Selected Attempt — Risk Result</h3>
        {riskLoading || computeRisk.isPending ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
          </div>
        ) : !selectedRisk ? (
          <p className="text-sm text-slate-500">No score computed yet. Click Recompute Risk.</p>
        ) : (
          <div className="space-y-5">
            {/* Level badge + score */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`px-3 py-1.5 text-xs font-bold rounded-full border ${scoreTone(selectedRisk.risk_level)}`}>
                {selectedRisk.risk_level.toUpperCase()}
              </span>
              <span className="text-sm text-slate-400">
                Score: <span className="font-bold text-white font-mono tabular-nums">{selectedRisk.overall_score.toFixed(3)}</span>
              </span>
              <span className="text-sm text-slate-400">
                Events: <span className="font-bold text-white tabular-nums">{selectedRisk.total_events}</span>
              </span>
              <span className="text-xs text-slate-600 ml-auto font-mono">
                {formatDate(selectedRisk.computed_at)}
              </span>
            </div>

            {/* Breakdown — visual contribution bars */}
            {selectedRisk.breakdown && Object.keys(selectedRisk.breakdown).length > 0 ? (() => {
              const entries = Object.entries(selectedRisk.breakdown as Record<string, number>)
                .sort(([, a], [, b]) => b - a)
              const maxVal = entries[0]?.[1] ?? 1
              return (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Contribution Breakdown</p>
                  {entries.map(([type, contribution]) => {
                    const pct = maxVal > 0 ? Math.round((contribution / maxVal) * 100) : 0
                    const barColor = breakdownBarColor(contribution, maxVal)
                    return (
                      <div key={type} className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 w-40 shrink-0 truncate capitalize font-medium">
                          {type.replaceAll("_", " ")}
                        </span>
                        <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor} transition-all duration-700`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 font-mono tabular-nums w-12 text-right shrink-0">
                          {typeof contribution === "number" ? contribution.toFixed(3) : contribution}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })() : (
              <p className="text-sm text-slate-500">No breakdown available.</p>
            )}

            {/* Event counts */}
            {selectedRisk.event_counts && Object.keys(selectedRisk.event_counts).length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Event Counts</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(selectedRisk.event_counts).map(([k, v]) => (
                    <span key={k} className="text-xs rounded-lg bg-white/[0.06] border border-white/[0.06] px-2.5 py-1 text-slate-300 font-mono">
                      {k.replaceAll("_", " ")}: <span className="text-white font-semibold">{v}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Exam risk ranking table */}
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
          Exam Risk Ranking
        </h3>
        {summariesLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
          </div>
        ) : summaries.length === 0 ? (
          <p className="text-sm text-slate-500">No risk scores computed for this exam yet.</p>
        ) : (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.07]">
                  <th className="text-left px-4 py-2.5 font-medium text-slate-400 text-xs uppercase tracking-wide">Attempt</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-400 text-xs uppercase tracking-wide">Score</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-400 text-xs uppercase tracking-wide">Risk</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-400 text-xs uppercase tracking-wide">Events</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((row) => (
                  <tr key={row.attempt_id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{row.attempt_id.slice(0, 8)}…</td>
                    <td className="px-4 py-2.5 font-mono text-sm text-white tabular-nums">{row.overall_score.toFixed(3)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${scoreTone(row.risk_level)}`}>
                        {row.risk_level.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums">{row.total_events}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </FeatureGuard>
  )
}
