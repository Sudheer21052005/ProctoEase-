import { motion } from "framer-motion"
import { Shield, Cpu, Eye } from "lucide-react"
import type { ReactNode } from "react"

interface AuthLayoutProps {
  children: ReactNode
}

const features = [
  {
    icon: Shield,
    title: "Real-time proctoring",
    desc: "WebSocket-based violation detection with sub-second event delivery.",
  },
  {
    icon: Cpu,
    title: "AI risk scoring",
    desc: "Composite scoring with configurable weights and log-scale diminishing returns.",
  },
  {
    icon: Eye,
    title: "Judge0 sandbox",
    desc: "Candidate code runs in an isolated container — never in your application process.",
  },
]

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.3 } },
}

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 120, damping: 18 },
  },
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-[100dvh] flex bg-[#0f1117]">
      {/* ── Left panel — feature showcase ────────────────── */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[55%] relative flex-col justify-between p-12 overflow-hidden">
        {/* Ambient blobs */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 55% at 15% 30%, rgba(99,102,241,0.13) 0, transparent 65%), radial-gradient(ellipse 50% 45% at 85% 75%, rgba(99,102,241,0.07) 0, transparent 60%)",
          }}
        />

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
          className="flex items-center gap-3 relative z-10"
        >
          <img src="/image.png" alt="ProctoEase" className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight text-white">
            <span className="text-[#6366f1]">Procto</span>Ease
          </span>
        </motion.div>

        {/* Headline */}
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="relative z-10 max-w-lg"
        >
          <motion.p
            variants={fadeUp}
            className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6366f1] mb-4"
          >
            Secure Examination Platform
          </motion.p>

          <motion.h1
            variants={fadeUp}
            className="text-4xl xl:text-5xl font-bold tracking-tight leading-[1.1] text-white mb-6"
            style={{ textWrap: "balance" } as React.CSSProperties}
          >
            Integrity-first online assessment
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-base text-slate-400 leading-relaxed max-w-[50ch] mb-10"
          >
            Multi-tenant, AI-assisted proctoring with real-time violation
            detection, composite risk scoring, and isolated code execution.
          </motion.p>

          {/* Feature cards */}
          <motion.ul variants={stagger} className="space-y-4">
            {features.map(({ icon: Icon, title, desc }) => (
              <motion.li
                key={title}
                variants={fadeUp}
                className="flex items-start gap-4 group"
              >
                <div className="mt-0.5 h-9 w-9 shrink-0 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center transition-colors group-hover:bg-[#6366f1]/18">
                  <Icon className="h-4 w-4 text-[#6366f1]" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="text-sm text-slate-400 leading-snug mt-0.5">{desc}</p>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Bottom tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="relative z-10 text-xs text-slate-600"
        >
          © {new Date().getFullYear()} ProctoEase. Built for integrity.
        </motion.p>
      </div>

      {/* Divider */}
      <div className="hidden lg:block w-px bg-white/[0.06] shrink-0" />

      {/* ── Right panel — auth form ───────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 lg:px-12">
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <img src="/image.png" alt="ProctoEase" className="h-8 w-8" />
          <span className="text-lg font-bold text-white">
            <span className="text-[#6366f1]">Procto</span>Ease
          </span>
        </div>

        {/* Card — Double-Bezel */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 100, damping: 20, delay: 0.1 }}
          className="w-full max-w-[420px]"
        >
          {/* Outer bezel */}
          <div className="rounded-[1.375rem] p-[3px] bg-gradient-to-b from-white/[0.08] to-white/[0.02]">
            {/* Inner card */}
            <div className="rounded-[1.125rem] bg-[#161b27] px-8 py-9 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_48px_-12px_rgba(0,0,0,0.55)]">
              {children}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
