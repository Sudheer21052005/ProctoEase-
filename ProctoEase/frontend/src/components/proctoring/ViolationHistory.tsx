import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useProctoringStore } from "@/stores/proctoring.store"
import { ChevronDown, ChevronUp, AlertTriangle, MonitorOff, Clipboard, Camera, Eye, Code, Keyboard, Mouse, Wifi, Clock, Activity, ShieldAlert } from "lucide-react"

const VIOLATION_META: Record<string, { icon: React.ElementType; color: string }> = {
  tab_switch:               { icon: MonitorOff,   color: "text-amber-400" },
  rapid_tab_switching:      { icon: MonitorOff,   color: "text-red-400"   },
  copy_paste:               { icon: Clipboard,    color: "text-amber-400" },
  bulk_paste_detected:      { icon: Clipboard,    color: "text-red-400"   },
  right_click:              { icon: Mouse,        color: "text-slate-400" },
  keyboard_block:           { icon: Keyboard,     color: "text-amber-400" },
  fullscreen_exit:          { icon: AlertTriangle,color: "text-red-400"   },
  no_face:                  { icon: Camera,       color: "text-red-400"   },
  multiple_faces:           { icon: Eye,          color: "text-red-400"   },
  face_inconsistency:       { icon: ShieldAlert,  color: "text-red-400"   },
  browser_devtools:         { icon: Code,         color: "text-red-400"   },
  inactivity:               { icon: Clock,        color: "text-slate-400" },
  audio_anomaly:            { icon: Wifi,         color: "text-amber-400" },
  suspicious_activity_burst:{ icon: Activity,     color: "text-red-400"   },
  impossible_answer_speed:  { icon: Activity,     color: "text-red-400"   },
  periodic_check:           { icon: Clock,        color: "text-slate-600" },
  custom:                   { icon: ShieldAlert,  color: "text-amber-400" },
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export default function ViolationHistory() {
  const violations = useProctoringStore((s) => s.violations)
  const [open, setOpen] = useState(false)

  const recent = [...violations].reverse().slice(0, 12)

  if (violations.length === 0) return null

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#161b27] overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" strokeWidth={1.75} />
          <span className="text-xs font-semibold text-slate-300">
            Violations
          </span>
          <span className="h-4.5 min-w-[1.25rem] px-1 rounded-full bg-amber-400/15 text-amber-400 text-[10px] font-bold flex items-center justify-center">
            {violations.length}
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        )}
      </button>

      {/* List */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.05] max-h-48 overflow-y-auto">
              {recent.map((v, i) => {
                const meta = VIOLATION_META[v.type] ?? { icon: AlertTriangle, color: "text-slate-400" }
                const Icon = meta.icon
                return (
                  <div
                    key={`${v.type}-${v.timestamp}-${i}`}
                    className="flex items-start gap-2.5 px-3 py-2 border-b border-white/[0.04] last:border-0"
                  >
                    <Icon className={`h-3 w-3 mt-0.5 shrink-0 ${meta.color}`} strokeWidth={1.75} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-slate-300 font-medium truncate leading-tight">
                        {v.type.replace(/_/g, " ")}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-0.5">
                        {formatTime(v.timestamp)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
