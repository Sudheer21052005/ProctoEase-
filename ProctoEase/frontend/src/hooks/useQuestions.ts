import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  questionApi,
  type BackendQuestion,
  type QuestionCreateRequest,
} from "@/api/question.api"

export function useQuestionsForExam(examId: string) {
  return useQuery({
    queryKey: ["questions", examId],
    queryFn: () => questionApi.listForExam(examId),
    enabled: !!examId,
    staleTime: 60 * 1000,
  })
}

export function useCreateQuestion(examId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: QuestionCreateRequest) => questionApi.createForExam(examId, data),
    onSuccess: (created: BackendQuestion) => {
      qc.setQueryData<BackendQuestion[]>(["questions", examId], (prev = []) => [
        ...prev,
        created,
      ])
    },
  })
}

export function useDeleteQuestion(examId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (questionId: string) => questionApi.deleteById(questionId),
    onSuccess: (_data, questionId) => {
      qc.setQueryData<BackendQuestion[]>(["questions", examId], (prev = []) =>
        prev.filter((q) => q.id !== questionId)
      )
    },
  })
}
