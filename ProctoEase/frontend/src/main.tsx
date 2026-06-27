import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App"

// Enable mock API if VITE_MOCK_API is set
async function bootstrap() {
  if (import.meta.env.VITE_MOCK_API === "true") {
    const { setupMockApi } = await import("@/lib/mock-api")
    const { default: api } = await import("@/api/axios")
    setupMockApi(api)
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

bootstrap()
