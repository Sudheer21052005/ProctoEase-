import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { authApi } from "@/api/auth.api"
import { useAuthStore } from "@/stores/auth.store"
import type { LoginRequest, RegisterRequest } from "@/types"
import { ROLES } from "@/lib/constants"

export function useLogin() {
  const setTokens = useAuthStore((s) => s.setTokens)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: LoginRequest) => authApi.login(data),
    onSuccess: async (data) => {
      setTokens(data.access_token, data.refresh_token)
      // Fetch user profile to get role
      const user = await authApi.getMe()
      queryClient.setQueryData(["me"], user)

      // Redirect based on role
      switch (user.role) {
        case ROLES.ADMIN:
          navigate("/admin/dashboard")
          break
        case ROLES.RECRUITER:
          navigate("/recruiter/dashboard")
          break
        default:
          navigate("/candidate/dashboard")
      }
    },
  })
}

export function useRegister() {
  return useMutation({
    mutationFn: (data: RegisterRequest) => authApi.register(data),
  })
}

export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: ["me"],
    queryFn: authApi.getMe,
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}
