import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { examApi } from "@/api/exam.api"
import type { ExamCreateRequest } from "@/types"
import type {
  ExamIngestionJsonRequest,
  ExamUpdateRequest,
} from "@/api/exam.api"

export function useExams() {
  return useQuery({
    queryKey: ["exams"],
    queryFn: examApi.list,
    staleTime: 2 * 60 * 1000,
  })
}

export function useExam(id: string) {
  return useQuery({
    queryKey: ["exams", id],
    queryFn: () => examApi.getById(id),
    enabled: !!id,
  })
}

export function useCreateExam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ExamCreateRequest) => examApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exams"] }),
  })
}

export function useCreateExamViaIngestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      json,
      form,
    }: {
      json?: ExamIngestionJsonRequest
      form?: FormData
    }) => {
      if (form) {
        return examApi.createViaIngestionForm(form)
      }
      if (json) {
        return examApi.createViaIngestionJson(json)
      }
      throw new Error("Missing ingestion payload")
    },
    onSuccess: (result) => {
      if (result.created) {
        qc.invalidateQueries({ queryKey: ["exams"] })
      }
    },
  })
}

export function useUpdateExam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ExamUpdateRequest }) =>
      examApi.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["exams"] })
      qc.invalidateQueries({ queryKey: ["exams", id] })
    },
  })
}

