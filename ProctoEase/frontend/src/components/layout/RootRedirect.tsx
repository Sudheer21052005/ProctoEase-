import { Navigate } from "react-router-dom"
import { useAuthStore } from "@/stores/auth.store"
import { useMe } from "@/hooks/useAuth"
import LandingPage from "@/pages/public/LandingPage"

export default function RootRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const logout = useAuthStore((s) => s.logout)
  const { data: user, isLoading, isError } = useMe()

  if (!isAuthenticated) {
    return <LandingPage />
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-7 w-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isError || !user) {
    logout()
    return <Navigate to="/login" replace />
  }

  const dashboardMap: Record<string, string> = {
    admin: "/admin/dashboard",
    recruiter: "/recruiter/dashboard",
    candidate: "/candidate/dashboard",
  }

  return <Navigate to={dashboardMap[user.role] || "/login"} replace />
}
