import { Navigate } from "react-router-dom"
import { useAuthStore } from "@/stores/auth.store"
import { useMe } from "@/hooks/useAuth"
import type { UserRole } from "@/types"
import type { ReactNode } from "react"

interface ProtectedRouteProps {
  children: ReactNode
  allowedRoles?: UserRole[]
}

export default function ProtectedRoute({
  children,
  allowedRoles,
}: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const logout = useAuthStore((s) => s.logout)
  const { data: user, isLoading: userLoading, isError: userError } = useMe()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-7 w-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (userError || !user) {
    logout()
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect to the user's own dashboard instead of showing forbidden
    const dashboardMap: Record<string, string> = {
      admin: "/admin/dashboard",
      recruiter: "/recruiter/dashboard",
      candidate: "/candidate/dashboard",
    }
    return <Navigate to={dashboardMap[user.role] || "/login"} replace />
  }

  return <>{children}</>
}
