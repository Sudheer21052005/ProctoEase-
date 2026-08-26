import { lazy, Suspense, type ReactNode } from "react"
import { createBrowserRouter, Navigate } from "react-router-dom"
import AppLayout from "@/components/layout/AppLayout"
import ProtectedRoute from "@/components/layout/ProtectedRoute"
import RootRedirect from "@/components/layout/RootRedirect"

import LoginPage from "@/pages/public/LoginPage"
import RegisterPage from "@/pages/public/RegisterPage"
import CreateTenantPage from "@/pages/public/CreateTenantPage"
import NotFoundPage from "@/pages/public/NotFoundPage"

const CandidateDashboard = lazy(() => import("@/pages/candidate/CandidateDashboard"))
const PreflightCheck = lazy(() => import("@/pages/candidate/PreflightCheck"))
const ExamScreen = lazy(() => import("@/pages/candidate/ExamScreen"))
const ExamComplete = lazy(() => import("@/pages/candidate/ExamComplete"))

const RecruiterDashboard = lazy(() => import("@/pages/recruiter/RecruiterDashboard"))
const ExamCreate = lazy(() => import("@/pages/recruiter/ExamCreate"))
const ExamList = lazy(() => import("@/pages/recruiter/ExamList"))
const PlagiarismList = lazy(() => import("@/pages/recruiter/PlagiarismList"))
const PlagiarismReportDetail = lazy(() => import("@/pages/recruiter/PlagiarismReportDetail"))
const ExamWorkspaceLayout = lazy(() => import("@/pages/recruiter/exam-workspace/ExamWorkspaceLayout"))
const DetailsSection = lazy(() => import("@/pages/recruiter/exam-workspace/DetailsSection"))
const QuestionsSection = lazy(() => import("@/pages/recruiter/exam-workspace/QuestionsSection"))
const AttemptsSection = lazy(() => import("@/pages/recruiter/exam-workspace/AttemptsSection"))
const AnalyticsSection = lazy(() => import("@/pages/recruiter/exam-workspace/AnalyticsSection"))
const ProctoringSection = lazy(() => import("@/pages/recruiter/exam-workspace/ProctoringSection"))
const ReviewSection = lazy(() => import("@/pages/recruiter/exam-workspace/ReviewSection"))
const RiskSection = lazy(() => import("@/pages/recruiter/exam-workspace/RiskSection"))
const SummarySection = lazy(() => import("@/pages/recruiter/exam-workspace/SummarySection"))

const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"))

function withSuspense(element: ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="min-h-[240px] flex items-center justify-center">
          <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      {element}
    </Suspense>
  )
}

export const router = createBrowserRouter([
  /* ── Public routes ── */
  { path: "/", element: <RootRedirect /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/create-organization", element: <CreateTenantPage /> },

  /* ── Candidate routes (within AppLayout) ── */
  {
    element: (
      <ProtectedRoute allowedRoles={["candidate"]}>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: "/candidate/dashboard", element: withSuspense(<CandidateDashboard />) },
      { path: "/candidate/exams", element: withSuspense(<CandidateDashboard />) },
    ],
  },

  /* ── Candidate exam flow (isolated, no AppLayout) ── */
  {
    path: "/candidate/exam/:examId/preflight",
    element: (
      <ProtectedRoute allowedRoles={["candidate"]}>
        {withSuspense(<PreflightCheck />)}
      </ProtectedRoute>
    ),
  },
  {
    path: "/candidate/exam/:examId/attempt/:attemptId",
    element: (
      <ProtectedRoute allowedRoles={["candidate"]}>
        {withSuspense(<ExamScreen />)}
      </ProtectedRoute>
    ),
  },
  {
    path: "/candidate/exam/:examId/complete",
    element: (
      <ProtectedRoute allowedRoles={["candidate"]}>
        {withSuspense(<ExamComplete />)}
      </ProtectedRoute>
    ),
  },

  /* ── Recruiter routes ── */
  {
    element: (
      <ProtectedRoute allowedRoles={["recruiter", "admin"]}>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: "/recruiter/dashboard", element: withSuspense(<RecruiterDashboard />) },
      { path: "/recruiter/exams", element: withSuspense(<ExamList />) },
      { path: "/recruiter/exams/create", element: withSuspense(<ExamCreate />) },
      {
        path: "/recruiter/exams/:examId",
        element: withSuspense(<ExamWorkspaceLayout />),
        children: [
          { index: true, element: <Navigate to="summary" replace /> },
          { path: "summary", element: withSuspense(<SummarySection />) },
          { path: "details", element: withSuspense(<DetailsSection />) },
          { path: "questions", element: withSuspense(<QuestionsSection />) },
          { path: "attempts", element: withSuspense(<AttemptsSection />) },
          { path: "review", element: withSuspense(<ReviewSection />) },
          { path: "analytics", element: withSuspense(<AnalyticsSection />) },
          { path: "risk", element: withSuspense(<RiskSection />) },
          { path: "proctoring", element: withSuspense(<ProctoringSection />) },
        ],
      },
      { path: "/recruiter/exams/:examId/plagiarism", element: withSuspense(<PlagiarismList />) },
      { path: "/recruiter/plagiarism/:reportId", element: withSuspense(<PlagiarismReportDetail />) },
    ],
  },

  /* ── Admin routes ── */
  {
    element: (
      <ProtectedRoute allowedRoles={["admin"]}>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [{ path: "/admin/dashboard", element: withSuspense(<AdminDashboard />) }],
  },

  /* ── 404 catch-all ── */
  { path: "*", element: <NotFoundPage /> },
])
