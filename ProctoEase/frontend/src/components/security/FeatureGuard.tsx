import type { ReactNode } from "react"
import { ShieldAlert } from "lucide-react"
import type { UserRole } from "@/types"
import { useSession } from "@/hooks/useSession"

interface FeatureGuardProps {
  allowedRoles: UserRole[]
  children: ReactNode
}

export default function FeatureGuard({ allowedRoles, children }: FeatureGuardProps) {
  const { user, isUserLoading } = useSession()

  if (isUserLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user || !allowedRoles.includes(user.role)) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <ShieldAlert className="h-6 w-6 text-warning mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          You are not allowed to access this feature.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
