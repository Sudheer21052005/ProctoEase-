import { useProctoringStore } from "@/stores/proctoring.store"
import { MAX_VIOLATIONS } from "@/lib/constants"
import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

export default function ViolationTracker() {
  const { violationCount } = useProctoringStore()

  const urgency =
    violationCount >= MAX_VIOLATIONS - 1
      ? "critical"
      : violationCount >= Math.ceil(MAX_VIOLATIONS / 2)
        ? "high"
        : "low"

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold font-mono tabular-nums transition-all duration-200",
        urgency === "critical"
          ? "bg-red-500/15 text-red-400 animate-pulse ring-1 ring-red-500/30"
          : urgency === "high"
            ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20"
            : "bg-white/[0.06] text-slate-400"
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <span>{violationCount}/{MAX_VIOLATIONS}</span>
    </div>
  )
}
