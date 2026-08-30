import { Link, NavLink, Outlet, useParams } from "react-router-dom"
import { Loader2, ArrowLeft } from "lucide-react"
import { useExam } from "@/hooks/useExams"

const TABS = [
  { to: "summary", label: "Summary" },
  { to: "evaluation", label: "Evaluation" },
  { to: "details", label: "Details" },
  { to: "questions", label: "Questions" },
  { to: "attempts", label: "Attempts" },
  { to: "review", label: "Review" },
  { to: "analytics", label: "Analytics" },
  { to: "risk", label: "Risk" },
  { to: "proctoring", label: "Proctoring" },
]

export default function ExamWorkspaceLayout() {
  const { examId } = useParams<{ examId: string }>()
  const { data: exam, isLoading, isError } = useExam(examId || "")

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (isError || !exam) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-semibold mb-2">Exam not found</h2>
        <Link
          to="/recruiter/exams"
          className="text-primary text-sm font-medium hover:underline"
        >
          Back to exams
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <Link
        to="/recruiter/exams"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-5 font-medium"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Exams
      </Link>

      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] p-6 mb-5 relative overflow-hidden">
        {/* Subtle top glow */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#6366f1]/50 to-transparent" />
        
        <h1 className="text-2xl font-bold text-white mb-1.5">{exam.title}</h1>
        <p className="text-sm text-slate-400">
          Unified exam workspace for management, analytics, and monitoring.
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] mb-5 overflow-x-auto">
        <nav className="flex min-w-max">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `px-6 py-3.5 text-sm font-semibold tracking-wide border-b-2 transition-all ${
                  isActive
                    ? "border-[#6366f1] text-white bg-white/[0.03]"
                    : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/[0.01]"
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
    </div>
  )
}
