import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { attemptApi } from "@/api/attempt.api"
import type { AnswerSubmit, AttemptCreatePayload } from "@/api/attempt.api"

export function useMyAttempts() {
  return useQuery({
    queryKey: ["attempts", "me"],
    queryFn: attemptApi.listMine,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useExamAttempts(examId: string) {
  return useQuery({
    queryKey: ["attempts", "exam", examId],
    queryFn: () => attemptApi.listExamAttempts(examId),
    enabled: !!examId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useExamAttemptsPaged(examId: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ["attempts", "exam", examId, "paged", page, pageSize],
    queryFn: () => attemptApi.listExamAttemptsPaged(examId, page, pageSize),
    enabled: !!examId,
    staleTime: 20 * 1000,
    refetchInterval: 45 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
}

export function useCreateAttempt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ examId, payload }: { examId: string; payload?: AttemptCreatePayload }) =>
      attemptApi.create(examId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attempts"] }),
  })
}

export function useSubmitAttempt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (attemptId: string) => attemptApi.submit(attemptId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attempts"] }),
  })
}

export function useSaveAnswers() {
  return useMutation({
    mutationFn: ({
      attemptId,
      answers,
    }: {
      attemptId: string
      answers: AnswerSubmit[]
    }) => attemptApi.saveAnswers(attemptId, answers),
  })
}

export function useAnswers(attemptId: string, enabled = false) {
  return useQuery({
    queryKey: ["answers", attemptId],
    queryFn: () => attemptApi.getAnswers(attemptId),
    enabled,
    staleTime: 20 * 1000,
    refetchOnWindowFocus: false,
  })
}
