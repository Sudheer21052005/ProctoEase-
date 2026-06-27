import { RouterProvider } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { router } from "@/routes"
import ErrorBoundary from "@/components/shared/ErrorBoundary"
import { useAuthStore } from "@/stores/auth.store"
import { useEffect, useState } from "react"
import { authApi } from "@/api/auth.api"
import { toast } from "sonner"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})

export default function App() {
  const { hydrate, isHydrated, isAuthenticated } = useAuthStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Rehydrate tokens from localStorage
    hydrate()
  }, [hydrate])

  useEffect(() => {
    // Once hydrated, fetch user profile if tokens exist
    if (!isHydrated) return

    if (isAuthenticated) {
      queryClient
        .fetchQuery({ queryKey: ["me"], queryFn: authApi.getMe })
        .then(() => {
          setReady(true)
        })
        .catch(() => {
          // Token expired and refresh failed — force logout
          useAuthStore.getState().logout()
          setReady(true)
        })
    } else {
      setReady(true)
    }
  }, [isHydrated, isAuthenticated])

  useEffect(() => {
    const handleForbidden = (e: Event) => {
      const evt = e as CustomEvent<{ message?: string }>
      toast.error(evt.detail?.message || "Action forbidden")
    }

    window.addEventListener("forbidden-response", handleForbidden as EventListener)
    return () => {
      window.removeEventListener("forbidden-response", handleForbidden as EventListener)
    }
  }, [])

  // Show minimal loading state while rehydrating
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors closeButton />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
