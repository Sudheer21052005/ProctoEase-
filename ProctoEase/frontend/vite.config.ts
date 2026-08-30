import path from "path"
// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Node environment: the proctoring logic under test is deliberately
    // DOM-free (pure evaluator + injectable browser deps), so no jsdom is
    // needed and the suite stays fast.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
