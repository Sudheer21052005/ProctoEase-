import { cn } from "@/lib/utils"
import { Clock } from "lucide-react"
import { motion } from "framer-motion"

interface TimerBarProps {
  formatted: string
  isWarning: boolean
  isUrgent: boolean
  progress: number
}

export default function TimerBar({
  formatted,
  isWarning,
  isUrgent,
  progress,
}: TimerBarProps) {
  return (
    <div className="flex items-center gap-2.5">
      {/* Timer display */}
      <div
        className={cn(
          "flex items-center gap-1.5 font-mono text-sm font-bold px-3 py-1.5 rounded-lg transition-all duration-300",
          isUrgent
            ? "bg-red-500/15 text-red-400 ring-1 ring-red-500/30 animate-pulse"
            : isWarning
              ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20"
              : "bg-white/[0.06] text-slate-300"
        )}
      >
        <Clock
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isUrgent ? "text-red-400" : isWarning ? "text-amber-400" : "text-slate-400"
          )}
          strokeWidth={1.75}
        />
        <span className="tabular-nums">{formatted}</span>
      </div>

      {/* Progress bar */}
      <div className="hidden sm:block w-20 h-1 bg-white/[0.06] rounded-full overflow-hidden">
        <motion.div
          className={cn(
            "h-full rounded-full",
            isUrgent ? "bg-red-500" : isWarning ? "bg-amber-400" : "bg-[#6366f1]"
          )}
          style={{ width: `${Math.min(progress, 100)}%` }}
          transition={{ duration: 1, ease: "linear" }}
        />
      </div>
    </div>
  )
}
