import api from "./axios"
import type { User, TokenResponse, LoginRequest, RegisterRequest } from "@/types"

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<TokenResponse>("/auth/login", data).then((r) => r.data),

  register: (data: RegisterRequest) =>
    api.post<User>("/auth/register", data).then((r) => r.data),

  refresh: (refreshToken: string) =>
    api
      .post<TokenResponse>("/auth/refresh", { refresh_token: refreshToken })
      .then((r) => r.data),

  getMe: () => api.get<User>("/auth/me").then((r) => r.data),
}
