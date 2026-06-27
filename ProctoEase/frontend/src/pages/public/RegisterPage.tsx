import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Eye, EyeOff, Loader2, CheckCircle } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import AuthLayout from "@/components/layout/AuthLayout"
import {
  registerSchema,
  type RegisterFormValues,
} from "@/lib/validations/auth.schema"
import { useRegister } from "@/hooks/useAuth"
import type { AxiosError } from "axios"

export default function RegisterPage() {
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const registerMutation = useRegister()

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(registerSchema) as any,
    defaultValues: {
      tenant_slug: searchParams.get("tenant") || "",
      role: "candidate",
    },
  })

  const password = watch("password", "")
  const strength =
    password.length >= 12 ? "Strong" : password.length >= 8 ? "Medium" : "Weak"
  const strengthColor =
    strength === "Strong"
      ? "text-success"
      : strength === "Medium"
        ? "text-warning"
        : "text-danger"

  const onSubmit = (data: RegisterFormValues) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { confirm_password, ...payload } = data
    registerMutation.mutate(payload, {
      onSuccess: () => {
        toast.success("Account created! Please sign in.")
        navigate(`/login`)
      },
      onError: (err) => {
        const axiosErr = err as AxiosError<{ detail: string }>
        toast.error(axiosErr.response?.data?.detail || "Registration failed")
      },
    })
  }

  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold text-center mb-6">Create Account</h2>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Tenant Slug */}
        <div>
          <label htmlFor="tenant_slug" className="block text-sm font-medium mb-1.5">
            Organisation Slug
          </label>
          <input
            id="tenant_slug"
            type="text"
            placeholder="acme-corp"
            {...register("tenant_slug")}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Your organisation&apos;s URL-safe identifier
          </p>
          {errors.tenant_slug && (
            <p className="text-xs text-danger mt-1">{errors.tenant_slug.message}</p>
          )}
        </div>

        {/* Full Name */}
        <div>
          <label htmlFor="full_name" className="block text-sm font-medium mb-1.5">
            Full Name
          </label>
          <input
            id="full_name"
            type="text"
            placeholder="John Doe"
            {...register("full_name")}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          {errors.full_name && (
            <p className="text-xs text-danger mt-1">{errors.full_name.message}</p>
          )}
        </div>

        {/* Email */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            {...register("email")}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          {errors.email && (
            <p className="text-xs text-danger mt-1">{errors.email.message}</p>
          )}
        </div>

        {/* Role */}
        <div>
          <label htmlFor="role" className="block text-sm font-medium mb-1.5">
            Role
          </label>
          <select
            id="role"
            {...register("role")}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            <option value="candidate">Candidate</option>
            <option value="recruiter">Recruiter</option>
          </select>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1.5">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPw ? "text" : "password"}
              placeholder="Min. 8 characters"
              {...register("password")}
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {password.length > 0 && (
            <p className={`text-xs mt-1 flex items-center gap-1 ${strengthColor}`}>
              <CheckCircle className="h-3 w-3" />
              {strength}
            </p>
          )}
          {errors.password && (
            <p className="text-xs text-danger mt-1">{errors.password.message}</p>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="confirm_password" className="block text-sm font-medium mb-1.5">
            Confirm Password
          </label>
          <div className="relative">
            <input
              id="confirm_password"
              type={showConfirm ? "text" : "password"}
              placeholder="Re-enter password"
              {...register("confirm_password")}
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showConfirm ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {errors.confirm_password && (
            <p className="text-xs text-danger mt-1">
              {errors.confirm_password.message}
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={registerMutation.isPending}
          className="w-full bg-primary text-primary-foreground font-medium py-2.5 rounded-lg hover:bg-primary-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {registerMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Create Account
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="text-primary font-medium hover:underline">
          Sign In
        </Link>
      </p>
    </AuthLayout>
  )
}
