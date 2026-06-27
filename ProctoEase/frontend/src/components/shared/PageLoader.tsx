import { Loader2 } from "lucide-react"

export default function PageLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <div className="relative">
        <div className="h-12 w-12 rounded-full border-4 border-muted" />
        <Loader2 className="h-12 w-12 animate-spin text-primary absolute inset-0" />
      </div>
      <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
    </div>
  )
}
