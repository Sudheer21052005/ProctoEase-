import { cn } from "@/lib/utils"

const colors: Record<string, string> = {
  // Attempt statuses
  started: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  submitted: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  evaluated: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  // Exam statuses
  published: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  draft: "bg-white/[0.06] text-slate-400 border border-white/[0.06]",
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium capitalize",
        colors[status.toLowerCase()] || "bg-white/[0.06] text-slate-400 border border-white/[0.06]",
        className
      )}
    >
      {status}
    </span>
  )
}
