import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { reportingApi } from "@/api/reporting.api"

export function useTenantDashboard() {
  return useQuery({
    queryKey: ["reporting", "dashboard"],
    queryFn: reportingApi.dashboard,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useExamAnalytics(examId: string) {
  return useQuery({
    queryKey: ["reporting", "exam", examId, "analytics"],
    queryFn: () => reportingApi.examAnalytics(examId),
    enabled: !!examId,
    staleTime: 45 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useExamEvaluation(examId: string) {
  return useQuery({
    queryKey: ["reporting", "exam", examId, "evaluation"],
    queryFn: () => reportingApi.examEvaluation(examId),
    enabled: !!examId,
    staleTime: 45 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useExamQuestionStats(examId: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ["reporting", "exam", examId, "question-stats", page, pageSize],
    queryFn: () => reportingApi.examQuestionStats(examId, page, pageSize),
    enabled: !!examId,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
}
