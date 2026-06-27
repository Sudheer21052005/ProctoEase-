import { create } from "zustand"

const STORAGE_KEYS = {
  ACCESS: "proctoease_access_token",
  REFRESH: "proctoease_refresh_token",
} as const

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isHydrated: boolean

  setTokens: (access: string, refresh: string) => void
  logout: () => void
  hydrate: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isHydrated: false,

  setTokens: (access, refresh) => {
    // Persist to localStorage
    localStorage.setItem(STORAGE_KEYS.ACCESS, access)
    localStorage.setItem(STORAGE_KEYS.REFRESH, refresh)

    // Keep in-memory via window for Axios interceptor access
    window.__proctoease_access_token = access
    window.__proctoease_refresh_token = refresh
    set({ accessToken: access, refreshToken: refresh, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEYS.ACCESS)
    localStorage.removeItem(STORAGE_KEYS.REFRESH)
    window.__proctoease_access_token = null
    window.__proctoease_refresh_token = null
    set({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    })
  },

  /**
   * Rehydrate tokens from localStorage on app startup.
   * Call this once in the app root before rendering protected routes.
   */
  hydrate: () => {
    const access = localStorage.getItem(STORAGE_KEYS.ACCESS)
    const refresh = localStorage.getItem(STORAGE_KEYS.REFRESH)
    if (access && refresh) {
      window.__proctoease_access_token = access
      window.__proctoease_refresh_token = refresh
      set({
        accessToken: access,
        refreshToken: refresh,
        isAuthenticated: true,
        isHydrated: true,
      })
    } else {
      set({ isHydrated: true })
    }
  },
}))

// Listen for token refresh events from Axios interceptor
if (typeof window !== "undefined") {
  window.addEventListener("token-refresh", ((e: CustomEvent) => {
    useAuthStore.getState().setTokens(
      e.detail.access_token,
      e.detail.refresh_token
    )
  }) as EventListener)

  window.addEventListener("force-logout", () => {
    useAuthStore.getState().logout()
  })
}
