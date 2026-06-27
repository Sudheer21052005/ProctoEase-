import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { AlertTriangle, Loader2 } from "lucide-react"
import { useExamAttempts } from "@/hooks/useAttempts"
import { useAttemptEventsPaged, useAttemptViolationCount, useViolationGuidelines } from "@/hooks/useProctoringData"
import { formatDate } from "@/lib/utils"
import { API_BASE_URL } from "@/lib/constants"
import VirtualizedList from "@/components/shared/VirtualizedList"
import FeatureGuard from "@/components/security/FeatureGuard"

const DERIVED_VIOLATIONS = new Set([
  "rapid_tab_switching",
  "suspicious_activity_burst",
  "bulk_paste_detected",
  "impossible_answer_speed",
])

const SNAPSHOT_EVENT_TYPES = [
  "no_face", "multiple_faces", "face_inconsistency", 
  "tab_switch", "fullscreen_exit", "gaze_away", "head_turned", "phone_detected", "unauthorized_object"
]

function getSeverityLabel(severity: number) {
  if (severity >= 4) return "critical"
  if (severity >= 3) return "high"
  if (severity >= 2) return "medium"
  return "low"
}

export default function ProctoringSection() {
  const { examId } = useParams<{ examId: string }>()
  const {
    data: attempts = [],
    isLoading: attemptsLoading,
    isError: attemptsError,
  } = useExamAttempts(examId || "")

  const [selectedAttemptId, setSelectedAttemptId] = useState<string>("")
  const [severityFilter, setSeverityFilter] = useState<number>(0)
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [eventPage, setEventPage] = useState<number>(1)
  const [activeSnapshotUrl, setActiveSnapshotUrl] = useState<string>("")
  const eventPageSize = 100

  useEffect(() => {
    if (!selectedAttemptId && attempts.length > 0) {
      setSelectedAttemptId(attempts[0].id)
    }
  }, [attempts, selectedAttemptId])

  useEffect(() => {
    setEventPage(1)
  }, [selectedAttemptId])

  const {
    data: eventData,
    isLoading: eventsLoading,
    isError: eventsError,
  } = useAttemptEventsPaged(selectedAttemptId, eventPage, eventPageSize, !!selectedAttemptId)

  const {
    data: summary,
    isLoading: summaryLoading,
  } = useAttemptViolationCount(selectedAttemptId, !!selectedAttemptId)

  const { data: guidelines } = useViolationGuidelines(true)

  const events = eventData?.items || []
  const eventPages = eventData?.pages || 1
  const totalEvents = eventData?.total || 0

  const byTypePairs = useMemo(() => Object.entries(summary?.by_type || {}), [summary])
  const eventTypes = useMemo(() => {
    const unique = new Set(events.map((e) => e.event_type))
    return ["all", ...Array.from(unique)]
  }, [events])
  const filteredEvents = useMemo(
    () =>
      [...events]
        .filter((e) => e.severity >= severityFilter)
        .filter((e) => (typeFilter === "all" ? true : e.event_type === typeFilter))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [events, severityFilter, typeFilter]
  )
  const bySeverity = useMemo(() => {
    const counters: Record<string, number> = {}
    events.forEach((evt) => {
      const key = String(evt.severity)
      counters[key] = (counters[key] || 0) + 1
    })
    return Object.entries(counters).sort((a, b) => Number(a[0]) - Number(b[0]))
  }, [events])
  const groupedSnapshots = useMemo(() => {
    const groups: Record<string, Array<{ id: string; created_at: string; snapshot_url: string; severity: number }>> = {}
    filteredEvents.forEach((evt) => {
      const path = evt.snapshot_url || evt.snapshot_path
      if (!path) return
      if (!groups[evt.event_type]) groups[evt.event_type] = []
      groups[evt.event_type].push({ id: evt.id, created_at: evt.created_at, snapshot_url: path, severity: evt.severity })
    })
    return Object.entries(groups)
  }, [filteredEvents])

  const uploadsBase = useMemo(() => API_BASE_URL.replace("/api/v1", ""), [])
  const toSnapshotHref = (path: string) => `${uploadsBase}/${path}`
  const highRiskTypes = useMemo(
    () =>
      byTypePairs
        .filter(([type]) => {
          const severity = guidelines?.[type]?.severity
          return severity === "high" || severity === "critical"
        })
        .map(([type]) => type),
    [byTypePairs, guidelines]
  )

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
        <p className="text-slate-500">Could not load attempts for proctoring view.</p>
      </div>
    )
  }

  if (attempts.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-8 text-center">
        <p className="text-slate-500">No attempts yet. Proctoring data appears after candidates start.</p>
      </div>
    )
  }

  return (
    <FeatureGuard allowedRoles={["recruiter", "admin"]}>
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          Proctoring Monitor
        </h2>

        <label className="text-xs font-semibold uppercase tracking-widest text-slate-500 block mb-2">Attempt</label>
        <select
          value={selectedAttemptId}
          onChange={(e) => setSelectedAttemptId(e.target.value)}
          className="w-full max-w-xl px-3 py-2.5 rounded-xl border border-white/[0.08] bg-[#1e2638] text-white text-sm outline-none focus:border-[#6366f1]/50"
        >
          {attempts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.candidate_email
                ? `${a.candidate_email} | ${a.status}`
                : `${a.id.slice(0, 8)}… | ${a.status}`}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">Total Violations</p>
            <p className="text-2xl font-bold text-white">{summaryLoading ? "…" : summary?.total ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-4 col-span-1 lg:col-span-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">By Type</p>
            {byTypePairs.length === 0 ? (
              <p className="text-sm text-slate-500">No events recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {byTypePairs.map(([type, count]) => (
                  <span
                    key={type}
                    className={`text-xs px-2.5 py-1 rounded-lg border font-mono flex items-center gap-1 ${
                      DERIVED_VIOLATIONS.has(type)
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : "bg-white/[0.06] text-slate-300 border-white/[0.06]"
                    }`}
                  >
                    <span>{type.replaceAll("_", " ")}: <span className="font-semibold text-white">{count}</span></span>
                    {DERIVED_VIOLATIONS.has(type) ? " (derived)" : ""}
                    {SNAPSHOT_EVENT_TYPES.includes(type) && (
                      <span className="ml-0.5 text-[10px] text-indigo-400" title="Has photo evidence">
                        📷
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
          <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">By Severity</p>
            {bySeverity.length === 0 ? (
              <p className="text-sm text-slate-500">No events recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {bySeverity.map(([sev, count]) => (
                  <span key={sev} className="text-xs px-2.5 py-1 rounded-lg border border-white/[0.06] bg-white/[0.06] text-slate-300 font-mono">
                    {getSeverityLabel(Number(sev)).toUpperCase()} ({sev}): <span className="font-semibold text-white">{count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Insights Filters</p>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(Number.parseInt(e.target.value, 10) || 0)}
                className="px-3 py-2 border border-white/[0.08] rounded-lg bg-[#0f1117] text-white text-sm outline-none focus:border-[#6366f1]/50"
              >
                <option value={0}>Min severity 0</option>
                <option value={1}>Min severity 1</option>
                <option value={2}>Min severity 2</option>
                <option value={3}>Min severity 3</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-2 border border-white/[0.08] rounded-lg bg-[#0f1117] text-white text-sm outline-none focus:border-[#6366f1]/50"
              >
                {eventTypes.map((evtType) => (
                  <option key={evtType} value={evtType}>
                    {evtType === "all" ? "All types" : evtType.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#1a2033] p-4 mt-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">High-Risk Patterns</p>
          {highRiskTypes.length === 0 ? (
            <p className="text-sm text-slate-500">No high-risk pattern detected for this page.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {highRiskTypes.map((type) => (
                <span key={type} className="text-xs px-2.5 py-1 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 font-mono">
                  {type.replaceAll("_", " ")}
                </span>
              ))}
            </div>
          )}
        </div>

        {typeFilter !== "all" && guidelines?.[typeFilter] ? (
          <div className="rounded-xl border border-[#6366f1]/20 bg-[#6366f1]/5 p-4 mt-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#818cf8] mb-1">Violation Guidance</p>
            <p className="text-sm font-semibold text-white capitalize">
              {typeFilter.replaceAll("_", " ")} <span className="text-slate-400 font-normal">· severity {guidelines[typeFilter].severity}</span>
            </p>
            <p className="text-sm text-slate-300 mt-2">{guidelines[typeFilter].description}</p>
            <p className="text-sm text-slate-300 mt-3">
              <span className="font-semibold text-white">Impact:</span> {guidelines[typeFilter].impact}
            </p>
            <p className="text-sm text-slate-300 mt-1">
              <span className="font-semibold text-white">Recommended action:</span> {guidelines[typeFilter].recommended_action}
            </p>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
        <h3 className="font-semibold text-white mb-4">Event Timeline</h3>

        {eventsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[#6366f1]" />
          </div>
        ) : eventsError ? (
          <p className="text-sm text-slate-500">Could not load proctoring events.</p>
        ) : filteredEvents.length === 0 ? (
          <p className="text-sm text-slate-500">No proctoring events for this attempt.</p>
        ) : (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="grid grid-cols-12 border-b border-white/[0.07] text-xs font-semibold uppercase tracking-wide text-slate-400">
              <div className="col-span-3 px-4 py-3">Time</div>
              <div className="col-span-3 px-4 py-3">Type</div>
              <div className="col-span-2 px-4 py-3">Severity</div>
              <div className="col-span-2 px-4 py-3">Snapshot</div>
              <div className="col-span-2 px-4 py-3">Detail</div>
            </div>

            <VirtualizedList
              items={filteredEvents}
              height={420}
              rowHeight={56}
              renderRow={(evt) => {
                const isCritical = evt.severity >= 4;
                const isHigh = evt.severity === 3;
                return (
                <div key={evt.id} className={`grid grid-cols-12 border-b border-white/[0.04] last:border-0 text-sm hover:bg-white/[0.02] transition-colors ${isCritical ? 'bg-red-500/5' : isHigh ? 'bg-orange-500/5' : ''}`}>
                  <div className="col-span-3 px-4 py-2.5 text-slate-400 font-mono text-xs flex items-center">{formatDate(evt.created_at)}</div>
                  <div className={`col-span-3 px-4 py-2.5 flex items-center capitalize font-medium ${isCritical ? 'text-red-400' : isHigh ? 'text-orange-400' : 'text-slate-300'}`}>
                    {evt.event_type.replaceAll("_", " ")}
                    {DERIVED_VIOLATIONS.has(evt.event_type) ? (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/20 bg-amber-500/10 text-amber-400 font-mono tracking-tighter">
                        DERIVED
                      </span>
                    ) : null}
                  </div>
                  <div className="col-span-2 px-4 py-2.5 flex items-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
                      isCritical ? 'border-red-500/30 bg-red-500/10 text-red-400' :
                      isHigh ? 'border-orange-500/30 bg-orange-500/10 text-orange-400' :
                      evt.severity === 2 ? 'border-amber-400/30 bg-amber-400/10 text-amber-400' :
                      'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {guidelines?.[evt.event_type]?.severity?.toUpperCase() || getSeverityLabel(evt.severity).toUpperCase()} ({evt.severity})
                    </span>
                  </div>
                  <div className="col-span-2 px-4 py-2.5 flex items-center">
                    {evt.snapshot_url || evt.snapshot_path ? (
                      <button
                        className="border border-white/[0.1] rounded overflow-hidden hover:border-[#6366f1] transition-colors"
                        onClick={() => setActiveSnapshotUrl(toSnapshotHref(evt.snapshot_url || evt.snapshot_path || ""))}
                      >
                        <img
                          src={toSnapshotHref(evt.snapshot_url || evt.snapshot_path || "")}
                          alt="snapshot"
                          className="w-10 h-8 object-cover"
                        />
                      </button>
                    ) : (
                      <span className="text-[10px] uppercase tracking-widest text-slate-600 font-medium">No image</span>
                    )}
                  </div>
                  <div className="col-span-2 px-4 py-2.5 text-slate-500 truncate flex items-center font-mono text-xs">
                    {evt.detail ? JSON.stringify(evt.detail) : "—"}
                  </div>
                </div>
              )}}
            />

            <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
              <span>
                Page {eventPage} of {eventPages} · <span className="font-mono">{totalEvents}</span> events total
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 border border-white/[0.08] rounded-lg text-white hover:bg-white/[0.05] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  disabled={eventPage <= 1}
                  onClick={() => setEventPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  className="px-3 py-1.5 border border-white/[0.08] rounded-lg text-white hover:bg-white/[0.05] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  disabled={eventPage >= eventPages}
                  onClick={() => setEventPage((p) => Math.min(eventPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6">
        <h3 className="font-semibold text-white mb-4">Snapshot Timeline (Grouped by Type)</h3>
        {groupedSnapshots.length === 0 ? (
          <p className="text-sm text-slate-500">No snapshots available for current filters.</p>
        ) : (
          <div className="space-y-5">
            {groupedSnapshots.map(([type, snaps]) => (
              <div key={type}>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">{type.replaceAll("_", " ")}</p>
                <div className="flex flex-wrap gap-2.5">
                  {snaps.map((snap) => (
                    <button
                      key={snap.id}
                      className="relative border border-white/[0.1] rounded-lg p-1 hover:border-[#6366f1] transition-colors bg-[#0f1117] flex flex-col items-center"
                      onClick={() => setActiveSnapshotUrl(toSnapshotHref(snap.snapshot_url))}
                      title={formatDate(snap.created_at)}
                    >
                      <img
                        src={toSnapshotHref(snap.snapshot_url)}
                        alt={`${type} snapshot`}
                        className="w-[72px] h-[54px] object-cover rounded-md"
                      />
                      <p className="text-[9px] text-slate-500 text-center mt-1 truncate w-[72px]">
                        {new Date(snap.created_at).toLocaleTimeString()}
                      </p>
                      <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                        snap.severity >= 3 ? 'bg-rose-500' :
                        snap.severity === 2 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeSnapshotUrl && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setActiveSnapshotUrl("")}
        >
          <div 
            className="relative max-w-2xl w-full bg-[#161b27] rounded-2xl border border-white/[0.1] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              className="absolute top-3 right-3 text-slate-400 hover:text-white transition-colors z-10"
              onClick={() => setActiveSnapshotUrl("")}
            >
              ✕
            </button>
            <img
              src={activeSnapshotUrl}
              alt="Violation snapshot"
              className="w-full rounded-xl object-contain max-h-[60vh]"
            />
            <div className="mt-4 flex items-center gap-3">
              <span className="text-xs text-slate-400">
                Captured during proctoring session
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
    </FeatureGuard>
  )
}
