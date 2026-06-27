import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { proctoringApi } from "@/api/proctoring.api"

export function useAttemptEvents(attemptId: string, enabled = true) {
  return useQuery({
    queryKey: ["proctoring", "attempt", attemptId, "events"],
    queryFn: () => proctoringApi.listAttemptEvents(attemptId),
    enabled: enabled && !!attemptId,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useAttemptEventsPaged(
  attemptId: string,
  page: number,
  pageSize: number,
  enabled = true
) {
  return useQuery({
    queryKey: ["proctoring", "attempt", attemptId, "events", "paged", page, pageSize],
    queryFn: () => proctoringApi.listAttemptEventsPaged(attemptId, page, pageSize),
    enabled: enabled && !!attemptId,
    staleTime: 15 * 1000,
    refetchInterval: 20 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
}

export function useAttemptViolationCount(attemptId: string, enabled = true) {
  return useQuery({
    queryKey: ["proctoring", "attempt", attemptId, "count"],
    queryFn: () => proctoringApi.getAttemptViolationCount(attemptId),
    enabled: enabled && !!attemptId,
    staleTime: 10 * 1000,
    refetchInterval: 20 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useViolationGuidelines(enabled = true) {
  return useQuery({
    queryKey: ["proctoring", "violation-guidelines"],
    queryFn: () => proctoringApi.getViolationGuidelines(),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
