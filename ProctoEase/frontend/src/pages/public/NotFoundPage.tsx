import { Link } from "react-router-dom"
import { Ghost } from "lucide-react"

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="text-center max-w-md">
        <div className="mx-auto w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
          <Ghost className="h-10 w-10 text-muted-foreground" />
        </div>
        <h1 className="text-6xl font-extrabold text-primary mb-2">404</h1>
        <h2 className="text-xl font-semibold mb-2">Page Not Found</h2>
        <p className="text-muted-foreground mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to="/"
            className="px-5 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary-700 transition"
          >
            Go Home
          </Link>
          <Link
            to="/login"
            className="px-5 py-2.5 border border-border rounded-lg font-medium hover:bg-muted transition"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}
