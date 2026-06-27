import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { plagiarismApi } from "@/api/plagiarism.api"

export function usePlagiarismReports(examId: string) {
  return useQuery({
    queryKey: ["plagiarism", "reports", examId],
    queryFn: () => plagiarismApi.listReports(examId),
    enabled: !!examId,
    staleTime: 30 * 1000,
  })
}

export function usePlagiarismReport(reportId: string) {
  return useQuery({
    queryKey: ["plagiarism", "report", reportId],
    queryFn: () => plagiarismApi.getReport(reportId),
    enabled: !!reportId,
  })
}

export function useTriggerPlagiarismScan(examId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (threshold?: number) => plagiarismApi.triggerScan(examId, threshold),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plagiarism", "reports", examId] })
    },
  })
}
