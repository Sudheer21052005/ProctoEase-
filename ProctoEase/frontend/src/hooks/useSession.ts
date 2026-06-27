import { useAuthStore } from "@/stores/auth.store"
import { useMe } from "@/hooks/useAuth"

export function useSession() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isHydrated = useAuthStore((s) => s.isHydrated)
  const logout = useAuthStore((s) => s.logout)

  const meQuery = useMe()

  return {
    isAuthenticated,
    isHydrated,
    user: meQuery.data ?? null,
    isUserLoading: isAuthenticated && meQuery.isLoading,
    logout,
  }
}
