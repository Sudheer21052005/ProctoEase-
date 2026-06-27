import { NavLink, Link, Outlet, useNavigate, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { useSession } from "@/hooks/useSession"
import { ROLES } from "@/lib/constants"
import {
  LayoutDashboard,
  FileText,
  PlusCircle,
  ClipboardList,
  LogOut,
  Shield,
  Menu,
  X,
} from "lucide-react"
import { useState } from "react"

const navByRole = {
  [ROLES.CANDIDATE]: [
    { to: "/candidate/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/candidate/exams", label: "My Exams", icon: FileText },
  ],
  [ROLES.RECRUITER]: [
    { to: "/recruiter/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/recruiter/exams", label: "Exams", icon: FileText },
    { to: "/recruiter/exams/create", label: "Create Exam", icon: PlusCircle },
  ],
  [ROLES.ADMIN]: [
    { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/recruiter/exams", label: "Exams", icon: FileText },
    { to: "/recruiter/exams/create", label: "Create Exam", icon: PlusCircle },
  ],
}

const roleBadgeColors: Record<string, string> = {
  admin:     "bg-red-500/15 text-red-400",
  recruiter: "bg-[#6366f1]/15 text-[#818cf8]",
  candidate: "bg-emerald-500/15 text-emerald-400",
}

export default function AppLayout() {
  const { user, logout } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const role = user?.role || ROLES.CANDIDATE
  const links = navByRole[role] || navByRole[ROLES.CANDIDATE]

  const handleLogout = () => {
    logout()
    navigate("/login")
  }

  return (
    <div className="min-h-[100dvh] flex bg-[#0f1117]">
      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#161b27] border-r border-white/[0.07] flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-white/[0.07]">
          <Link to="/" className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
            <img src="/image.png" alt="ProctoEase Logo" className="h-8 w-8" />
            <span>
              <span className="text-[#6366f1]">Procto</span>
              <span className="text-white">Ease</span>
            </span>
          </Link>
          <button
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-5 space-y-0.5">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-[#6366f1]/15 text-[#818cf8] font-semibold"
                    : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
                }`
              }
              onClick={() => setSidebarOpen(false)}
            >
              <link.icon className="h-4 w-4" strokeWidth={1.75} />
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* User info at bottom */}
        <div className="p-4 border-t border-white/[0.07]">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 rounded-xl bg-[#6366f1]/15 border border-[#6366f1]/20 flex items-center justify-center">
              <Shield className="h-4 w-4 text-[#6366f1]" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {user?.full_name || "User"}
              </p>
              <span
                className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize ${
                  roleBadgeColors[role] || "bg-white/10 text-slate-400"
                }`}
              >
                {role}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header bar */}
        <header
          className="h-16 bg-[#161b27]/95 border-b border-white/[0.07] flex items-center justify-between px-6 sticky top-0 z-30"
          style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        >
          <button
            className="lg:hidden p-2 rounded-lg hover:bg-white/[0.06] text-slate-400"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-xs text-slate-500 hidden sm:block font-mono">
              {user?.email}
            </span>
            <div className="h-8 w-8 rounded-xl bg-[#6366f1]/15 border border-[#6366f1]/20 flex items-center justify-center">
              <ClipboardList className="h-4 w-4 text-[#6366f1]" strokeWidth={1.5} />
            </div>
          </div>
        </header>

        {/* Page content */}
        <AnimatePresence mode="wait">
          <motion.main
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex-1 p-6"
          >
            <Outlet />
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  )
}
