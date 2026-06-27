/**
 * Mock API adapter — intercepts Axios requests and returns dummy data.
 * Enable by setting VITE_MOCK_API=true in .env or .env.local
 *
 * Supports:
 *  POST /auth/login          → returns tokens
 *  POST /auth/register       → returns user
 *  POST /auth/refresh        → returns tokens
 *  GET  /auth/me             → returns current user
 *  GET  /exams/              → returns exam list
 *  GET  /exams/:id           → returns single exam
 *  POST /exams/              → creates exam
 *  POST /exams/:id/attempts  → creates attempt
 *  GET  /attempts/me         → returns attempts
 *  POST /tenants/            → creates tenant
 */

import type { AxiosInstance, InternalAxiosRequestConfig, AxiosHeaders } from "axios"
import type { User, Exam, ExamAttempt, TokenResponse, Tenant } from "@/types"

// ─── Dummy IDs ───
const TENANT_ID = "t-00000000-0001"
const CANDIDATE_ID = "u-00000000-0001"
const RECRUITER_ID = "u-00000000-0002"
const ADMIN_ID = "u-00000000-0003"

// ─── Dummy Users ───
const USERS: Record<string, User> = {
  candidate: {
    id: CANDIDATE_ID,
    email: "candidate@demo.com",
    full_name: "Alice Johnson",
    role: "candidate",
    is_active: true,
    tenant_id: TENANT_ID,
    created_at: "2026-01-15T10:00:00Z",
  },
  recruiter: {
    id: RECRUITER_ID,
    email: "recruiter@demo.com",
    full_name: "Bob Smith",
    role: "recruiter",
    is_active: true,
    tenant_id: TENANT_ID,
    created_at: "2026-01-10T08:00:00Z",
  },
  admin: {
    id: ADMIN_ID,
    email: "admin@demo.com",
    full_name: "Charlie Admin",
    role: "admin",
    is_active: true,
    tenant_id: TENANT_ID,
    created_at: "2026-01-05T08:00:00Z",
  },
}

// ─── Dummy Exams ───
const EXAMS: Exam[] = [
  {
    id: "e-00000000-0001",
    title: "JavaScript Fundamentals",
    description: "Test your knowledge of core JavaScript concepts including closures, promises, and ES6+ features.",
    duration_minutes: 45,
    is_published: true,
    is_active: true,
    created_by: RECRUITER_ID,
    tenant_id: TENANT_ID,
    created_at: "2026-02-01T09:00:00Z",
  },
  {
    id: "e-00000000-0002",
    title: "Python Data Structures",
    description: "Covers lists, dictionaries, sets, tuples, and common algorithms using Python built-in types.",
    duration_minutes: 60,
    is_published: true,
    is_active: true,
    created_by: RECRUITER_ID,
    tenant_id: TENANT_ID,
    created_at: "2026-02-05T11:00:00Z",
  },
  {
    id: "e-00000000-0003",
    title: "SQL & Database Design",
    description: "JOIN types, normalization, indexing strategies, and query optimization.",
    duration_minutes: 90,
    is_published: true,
    is_active: true,
    created_by: RECRUITER_ID,
    tenant_id: TENANT_ID,
    created_at: "2026-02-10T14:30:00Z",
  },
  {
    id: "e-00000000-0004",
    title: "React Advanced Patterns",
    description: "Custom hooks, render props, compound components, and performance optimization.",
    duration_minutes: 60,
    is_published: false,
    is_active: true,
    created_by: RECRUITER_ID,
    tenant_id: TENANT_ID,
    created_at: "2026-02-15T16:00:00Z",
  },
  {
    id: "e-00000000-0005",
    title: "System Design Basics",
    description: "Load balancers, caching, message queues, and scalability principles.",
    duration_minutes: 120,
    is_published: true,
    is_active: true,
    created_by: RECRUITER_ID,
    tenant_id: TENANT_ID,
    created_at: "2026-02-20T10:00:00Z",
  },
]

// ─── Dummy Attempts ───
const ATTEMPTS: ExamAttempt[] = [
  {
    id: "a-00000000-0001",
    exam_id: "e-00000000-0001",
    candidate_id: CANDIDATE_ID,
    status: "submitted",
    is_active: true,
    started_at: "2026-02-25T09:00:00Z",
    submitted_at: "2026-02-25T09:40:00Z",
    tenant_id: TENANT_ID,
  },
  {
    id: "a-00000000-0002",
    exam_id: "e-00000000-0002",
    candidate_id: CANDIDATE_ID,
    status: "started",
    is_active: true,
    started_at: "2026-03-01T14:00:00Z",
    submitted_at: null,
    tenant_id: TENANT_ID,
  },
  {
    id: "a-00000000-0003",
    exam_id: "e-00000000-0003",
    candidate_id: CANDIDATE_ID,
    status: "evaluated",
    is_active: true,
    started_at: "2026-02-20T11:00:00Z",
    submitted_at: "2026-02-20T12:15:00Z",
    tenant_id: TENANT_ID,
  },
]

// ─── State ───
let currentUser: User | null = null

// ─── Mock Tokens ───
const MOCK_TOKENS: TokenResponse = {
  access_token: "mock_access_token_demo",
  refresh_token: "mock_refresh_token_demo",
  token_type: "bearer",
}

// ─── Route matcher helpers ───
function matchRoute(url: string, pattern: string): Record<string, string> | null {
  const urlParts = url.replace(/\/$/, "").split("/")
  const patternParts = pattern.replace(/\/$/, "").split("/")
  if (urlParts.length !== patternParts.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = urlParts[i]
    } else if (patternParts[i] !== urlParts[i]) {
      return null
    }
  }
  return params
}

function delay(ms: number = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Setup function ───
export function setupMockApi(api: AxiosInstance) {
  console.log(
    "%c🧪 Mock API enabled — using dummy data",
    "color: #f59e0b; font-weight: bold; font-size: 14px;"
  )

  api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const url = config.url || ""
    const method = (config.method || "get").toLowerCase()

    // Simulate network delay
    await delay(200 + Math.random() * 300)

    let responseData: unknown = null
    let matched = false

    // ── POST /auth/login ──
    if (method === "post" && url.includes("/auth/login")) {
      const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data
      const email = (body?.email || "").toLowerCase()

      // Determine role from email
      if (email.includes("recruiter")) {
        currentUser = USERS.recruiter
      } else if (email.includes("admin")) {
        currentUser = USERS.admin
      } else {
        currentUser = USERS.candidate
      }

      responseData = MOCK_TOKENS
      matched = true
    }

    // ── POST /auth/register ──
    if (method === "post" && url.includes("/auth/register")) {
      const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data
      responseData = {
        id: `u-${crypto.randomUUID().slice(0, 8)}`,
        email: body.email,
        full_name: body.full_name,
        role: body.role || "candidate",
        is_active: true,
        tenant_id: TENANT_ID,
        created_at: new Date().toISOString(),
      }
      matched = true
    }

    // ── POST /auth/refresh ──
    if (method === "post" && url.includes("/auth/refresh")) {
      responseData = MOCK_TOKENS
      matched = true
    }

    // ── GET /auth/me ──
    if (method === "get" && url.includes("/auth/me")) {
      responseData = currentUser || USERS.candidate
      matched = true
    }

    // ── GET /exams/ ──
    if (method === "get" && (url.endsWith("/exams/") || url.endsWith("/exams"))) {
      // Candidates see only published; recruiters/admins see all
      if (currentUser?.role === "candidate") {
        responseData = EXAMS.filter((e) => e.is_published && e.is_active)
      } else {
        responseData = EXAMS
      }
      matched = true
    }

    // ── GET /exams/:id ──
    if (method === "get" && !matched) {
      const params = matchRoute(url, "/exams/:id")
      if (params) {
        responseData = EXAMS.find((e) => e.id === params.id) || EXAMS[0]
        matched = true
      }
    }

    // ── POST /exams/ (create) ──
    if (method === "post" && url.includes("/exams") && !url.includes("/attempts") && !matched) {
      const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data
      const newExam: Exam = {
        id: `e-${crypto.randomUUID().slice(0, 8)}`,
        title: body.title,
        description: body.description || null,
        duration_minutes: body.duration_minutes,
        is_published: body.is_published ?? false,
        is_active: true,
        created_by: currentUser?.id || RECRUITER_ID,
        tenant_id: TENANT_ID,
        created_at: new Date().toISOString(),
      }
      EXAMS.push(newExam)
      responseData = newExam
      matched = true
    }

    // ── POST /exams/:id/attempts (create attempt) ──
    if (method === "post" && url.includes("/attempts")) {
      const examIdMatch = url.match(/\/exams\/([^/]+)\/attempts/)
      const examId = examIdMatch?.[1] || EXAMS[0].id
      const newAttempt: ExamAttempt = {
        id: `a-${crypto.randomUUID().slice(0, 8)}`,
        exam_id: examId,
        candidate_id: currentUser?.id || CANDIDATE_ID,
        status: "started",
        is_active: true,
        started_at: new Date().toISOString(),
        submitted_at: null,
        tenant_id: TENANT_ID,
      }
      ATTEMPTS.push(newAttempt)
      responseData = newAttempt
      matched = true
    }

    // ── GET /attempts/me ──
    if (method === "get" && url.includes("/attempts/me")) {
      responseData = ATTEMPTS.filter(
        (a) => a.candidate_id === (currentUser?.id || CANDIDATE_ID)
      )
      matched = true
    }

    // ── POST /tenants/ ──
    if (method === "post" && url.includes("/tenants")) {
      const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data
      const tenant: Tenant = {
        id: `t-${crypto.randomUUID().slice(0, 8)}`,
        name: body.name,
        slug: body.slug,
        is_active: true,
        created_at: new Date().toISOString(),
      }
      responseData = tenant
      matched = true
    }

    if (matched) {
      // Return a fake Axios response by using an adapter override
      const fakeResponse = {
        data: responseData,
        status: 200,
        statusText: "OK",
        headers: {} as AxiosHeaders,
        config,
      }
      // Throw a special object that the response interceptor can catch
      return Promise.reject({
        __mock: true,
        response: fakeResponse,
      }) as never
    }

    // Not mocked — pass through to real API
    return config
  })

  // Add a response interceptor to handle mock responses
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      // If it's our mock response, return it as success
      if (error?.__mock) {
        return Promise.resolve(error.response)
      }
      return Promise.reject(error)
    }
  )
}
