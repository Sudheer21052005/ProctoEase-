import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { riskApi, type RiskWeightsUpdate } from "@/api/risk.api"

export function useExamRiskScores(examId: string) {
  return useQuery({
    queryKey: ["risk", "exam", examId],
    queryFn: () => riskApi.listExamRiskScores(examId),
    enabled: !!examId,
    staleTime: 30 * 1000,
  })
}

export function useAttemptRiskScore(attemptId: string, enabled = true) {
  return useQuery({
    queryKey: ["risk", "attempt", attemptId],
    queryFn: () => riskApi.getAttemptRisk(attemptId),
    enabled: enabled && !!attemptId,
    staleTime: 20 * 1000,
  })
}

export function useComputeAttemptRisk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      attemptId,
      weights,
    }: {
      attemptId: string
      weights?: RiskWeightsUpdate
    }) => riskApi.computeAttemptRisk(attemptId, weights),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["risk", "exam"] })
      qc.setQueryData(["risk", "attempt", data.attempt_id], data)
    },
  })
}
