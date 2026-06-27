import axios from "axios"
import { API_BASE_URL } from "@/lib/constants"

const api = axios.create({
  baseURL: API_BASE_URL,
})

/* ── Request interceptor: attach JWT ── */
api.interceptors.request.use((config) => {
  // Let the browser set multipart boundaries for FormData uploads.
  if (config.data instanceof FormData && config.headers) {
    delete (config.headers as Record<string, unknown>)["Content-Type"]
  }

  // Dynamic import to avoid circular deps — read from localStorage fallback
  const token = window.__proctoease_access_token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/* ── Response interceptor: 401 → silent refresh ── */
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    // Do not attempt to refresh if the original request was already attempting to login or refresh
    const isAuthRoute = original.url?.includes("/auth/login") || original.url?.includes("/auth/refresh");

    if (error.response?.status === 401 && !original._retry && !isAuthRoute) {
      original._retry = true
      try {
        const refreshToken = window.__proctoease_refresh_token
        if (!refreshToken) throw new Error("No refresh token")

        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        })

        // Update in-memory tokens
        window.__proctoease_access_token = data.access_token
        window.__proctoease_refresh_token = data.refresh_token

        // Dispatch event so Zustand store can sync
        window.dispatchEvent(
          new CustomEvent("token-refresh", { detail: data })
        )

        original.headers.Authorization = `Bearer ${data.access_token}`
        return api(original)
      } catch {
        // Refresh failed — force logout
        window.__proctoease_access_token = null
        window.__proctoease_refresh_token = null
        window.dispatchEvent(new CustomEvent("force-logout"))
        window.location.href = "/login"
      }
    }

    if (error.response?.status === 403) {
      const detail = error.response?.data?.detail || "You do not have permission for this action"
      window.dispatchEvent(
        new CustomEvent("forbidden-response", {
          detail: {
            message: detail,
            path: original?.url || "",
          },
        })
      )
    }

    return Promise.reject(error)
  }
)

/* ── Global type augmentation for in-memory token storage ── */
declare global {
  interface Window {
    __proctoease_access_token: string | null
    __proctoease_refresh_token: string | null
  }
}

window.__proctoease_access_token = null
window.__proctoease_refresh_token = null

export default api
