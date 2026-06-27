import React, { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useProctoringStore } from "@/stores/proctoring.store"
import {
  AlertTriangle,
  MonitorOff,
  Clipboard,
  Camera,
  Mouse,
  Keyboard,
  Eye,
  Code,
  Wifi,
  Activity,
  ShieldAlert,
  Clock,
} from "lucide-react"

const VIOLATION_META: Record<
  string,
  { label: string; icon: React.ElementType; color: string; bg: string }
> = {
  tab_switch:               { label: "Tab switch detected",        icon: MonitorOff,   color: "text-amber-400",  bg: "bg-amber-400/10" },
  rapid_tab_switching:      { label: "Rapid tab switching",        icon: MonitorOff,   color: "text-red-400",    bg: "bg-red-400/10"   },
  copy_paste:               { label: "Copy/paste blocked",         icon: Clipboard,    color: "text-amber-400",  bg: "bg-amber-400/10" },
  bulk_paste_detected:      { label: "Bulk paste detected",        icon: Clipboard,    color: "text-red-400",    bg: "bg-red-400/10"   },
  right_click:              { label: "Right-click blocked",        icon: Mouse,        color: "text-slate-400",  bg: "bg-slate-400/10" },
  keyboard_block:           { label: "Keyboard shortcut blocked",  icon: Keyboard,     color: "text-amber-400",  bg: "bg-amber-400/10" },
  fullscreen_exit:          { label: "Fullscreen exit detected",   icon: AlertTriangle,color: "text-red-400",    bg: "bg-red-400/10"   },
  no_face:                  { label: "No face detected",           icon: Camera,       color: "text-red-400",    bg: "bg-red-400/10"   },
  multiple_faces:           { label: "Multiple faces detected",    icon: Eye,          color: "text-red-400",    bg: "bg-red-400/10"   },
  face_inconsistency:       { label: "Face inconsistency",         icon: ShieldAlert,  color: "text-red-400",    bg: "bg-red-400/10"   },
  browser_devtools:         { label: "DevTools opened",            icon: Code,         color: "text-red-400",    bg: "bg-red-400/10"   },
  inactivity:               { label: "Inactivity detected",        icon: Clock,        color: "text-slate-400",  bg: "bg-slate-400/10" },
  audio_anomaly:            { label: "Audio anomaly",              icon: Wifi,         color: "text-amber-400",  bg: "bg-amber-400/10" },
  suspicious_activity_burst:{ label: "Suspicious activity burst",  icon: Activity,     color: "text-red-400",    bg: "bg-red-400/10"   },
  impossible_answer_speed:  { label: "Suspicious answer speed",    icon: Activity,     color: "text-red-400",    bg: "bg-red-400/10"   },
  periodic_check:           { label: "Periodic check",             icon: Clock,        color: "text-slate-500",  bg: "bg-slate-500/10" },
  custom:                   { label: "Violation recorded",         icon: ShieldAlert,  color: "text-amber-400",  bg: "bg-amber-400/10" },
}

const DEFAULT_META = {
  label: "Violation detected",
  icon: AlertTriangle,
  color: "text-amber-400",
  bg: "bg-amber-400/10",
}

interface ToastItem {
  id: string
  type: string
  description: string
}

// Isolated component — never re-renders parent
export default function ViolationToast() {
  const violations = useProctoringStore((s) => s.violations)
  const lastIndexRef = useRef(0)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  // Only fire when new violations arrive
  useEffect(() => {
    if (violations.length <= lastIndexRef.current) return
    const newViolations = violations.slice(lastIndexRef.current)
    lastIndexRef.current = violations.length

    newViolations.forEach((v) => {
      // Skip noisy periodic checks in the visual toast
      if (v.type === "periodic_check") return
      const id = `${v.type}-${v.timestamp}-${Math.random()}`
      const item: ToastItem = { id, type: v.type, description: v.description }
      setToasts((prev) => [...prev.slice(-2), item]) // max 3 visible
      // Auto-dismiss after 5s
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 5000)
    })
  }, [violations])

  return (
    <div className="fixed top-16 right-4 z-[150] flex flex-col gap-2 pointer-events-none w-72">
      <AnimatePresence mode="sync">
        {toasts.map((toast) => {
          const meta = VIOLATION_META[toast.type] ?? DEFAULT_META
          const Icon = meta.icon
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 48, scale: 0.92 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 48, scale: 0.92 }}
              transition={{ type: "spring", stiffness: 200, damping: 22 }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-white/[0.08] bg-[#161b27]/95 px-4 py-3 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6)]"
              style={{ backdropFilter: "blur(8px)" }}
            >
              <div className={`mt-0.5 h-7 w-7 shrink-0 rounded-lg ${meta.bg} flex items-center justify-center`}>
                <Icon className={`h-3.5 w-3.5 ${meta.color}`} strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold ${meta.color}`}>{meta.label}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug truncate">
                  {toast.description || "Recorded and sent to examiner."}
                </p>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
