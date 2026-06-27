/* ── Core TypeScript interfaces matching backend Pydantic schemas ── */

export interface User {
  id: string
  email: string
  full_name: string
  role: "admin" | "recruiter" | "candidate"
  is_active: boolean
  tenant_id: string
  created_at: string
}

export interface Tenant {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
}

export interface Exam {
  id: string
  title: string
  description: string | null
  duration_minutes: number
  start_time?: string | null
  end_time?: string | null
  is_published: boolean
  is_active: boolean
  created_by: string
  tenant_id: string
  created_at: string
}

export interface ExamAttempt {
  id: string
  exam_id: string
  candidate_id: string
  candidate_email?: string | null
  status: "started" | "submitted" | "evaluated"
  is_active: boolean
  started_at: string
  attempt_end_time?: string | null
  submitted_at: string | null
  verification_image_url?: string | null
  tenant_id: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: "bearer"
}

export interface LoginRequest {
  email: string
  password: string
  tenant_slug: string
}

export interface RegisterRequest {
  email: string
  password: string
  full_name: string
  role: "admin" | "recruiter" | "candidate"
  tenant_slug: string
}

export interface TenantCreateRequest {
  name: string
  slug: string
}

export interface ExamCreateRequest {
  title: string
  description?: string | null
  duration_minutes: number
  start_time?: string | null
  end_time?: string | null
  is_published: boolean
}

export type UserRole = User["role"]
