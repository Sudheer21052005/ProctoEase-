import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Link } from "react-router-dom"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { useState } from "react"
import { motion } from "framer-motion"
import { toast } from "sonner"
import AuthLayout from "@/components/layout/AuthLayout"
import { loginSchema, type LoginFormValues } from "@/lib/validations/auth.schema"
import { useLogin } from "@/hooks/useAuth"
import type { AxiosError } from "axios"

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 120, damping: 18 } },
}

export default function LoginPage() {
  const [showPw, setShowPw] = useState(false)
  const loginMutation = useLogin()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) })

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(data, {
      onError: (err) => {
        const axiosErr = err as AxiosError<{ detail: string }>
        toast.error(axiosErr.response?.data?.detail || "Login failed")
      },
    })
  }

  return (
    <AuthLayout>
      <motion.div
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
        initial="hidden"
        animate="show"
        className="space-y-6"
      >
        {/* Heading */}
        <motion.div variants={fadeUp}>
          <h2 className="text-2xl font-bold tracking-tight text-white">Sign in</h2>
          <p className="mt-1 text-sm text-slate-400">Enter your organisation credentials to continue.</p>
        </motion.div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Organisation slug */}
          <motion.div variants={fadeUp}>
            <label
              htmlFor="tenant_slug"
              className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2"
            >
              Organisation
            </label>
            <input
              id="tenant_slug"
              type="text"
              placeholder="acme-corp"
              {...register("tenant_slug")}
              className="w-full px-4 py-3 rounded-xl bg-[#1e2638] border border-white/[0.08] text-white text-sm placeholder:text-slate-600 outline-none focus:border-[#6366f1]/60 focus:ring-2 focus:ring-[#6366f1]/15 transition-all"
            />
            {errors.tenant_slug && (
              <p className="text-xs text-red-400 mt-1.5">{errors.tenant_slug.message}</p>
            )}
          </motion.div>

          {/* Email */}
          <motion.div variants={fadeUp}>
            <label
              htmlFor="email"
              className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@company.com"
              {...register("email")}
              className="w-full px-4 py-3 rounded-xl bg-[#1e2638] border border-white/[0.08] text-white text-sm placeholder:text-slate-600 outline-none focus:border-[#6366f1]/60 focus:ring-2 focus:ring-[#6366f1]/15 transition-all"
            />
            {errors.email && (
              <p className="text-xs text-red-400 mt-1.5">{errors.email.message}</p>
            )}
          </motion.div>

          {/* Password */}
          <motion.div variants={fadeUp}>
            <label
              htmlFor="password"
              className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPw ? "text" : "password"}
                placeholder="••••••••"
                {...register("password")}
                className="w-full px-4 py-3 pr-11 rounded-xl bg-[#1e2638] border border-white/[0.08] text-white text-sm placeholder:text-slate-600 outline-none focus:border-[#6366f1]/60 focus:ring-2 focus:ring-[#6366f1]/15 transition-all"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-red-400 mt-1.5">{errors.password.message}</p>
            )}
          </motion.div>

          {/* Submit — pill button */}
          <motion.div variants={fadeUp} className="pt-2">
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="group relative w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] text-white font-semibold text-sm transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_24px_-8px_rgba(99,102,241,0.5)] active:scale-[0.98] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {loginMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {loginMutation.isPending ? "Signing in…" : "Sign in"}
              {/* Arrow icon in circle */}
              {!loginMutation.isPending && (
                <span className="ml-1 h-5 w-5 rounded-full bg-white/15 flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
                  <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3">
                    <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </button>
          </motion.div>
        </form>

        {/* Footer links */}
        <motion.div
          variants={fadeUp}
          className="text-center text-xs text-slate-500 space-y-1.5"
        >
          <p>
            No account?{" "}
            <Link to="/register" className="text-[#6366f1] font-medium hover:text-[#818cf8] transition-colors">
              Register
            </Link>
          </p>
          <p>
            Need an organisation?{" "}
            <Link to="/create-organization" className="text-[#6366f1] font-medium hover:text-[#818cf8] transition-colors">
              Create one
            </Link>
          </p>
        </motion.div>
      </motion.div>
    </AuthLayout>
  )
}
