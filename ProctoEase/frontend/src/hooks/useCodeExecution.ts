import { useMutation, useQuery } from "@tanstack/react-query"
import {
  codeApi,
  isTerminalCodeStatus,
  type CodeSubmission,
  type CodeSubmitRequest,
} from "@/api/code.api"

const POLL_INTERVAL_MS = 1200
const MAX_POLL_ATTEMPTS = 30
const MAX_POLL_ERRORS = 3

export function useCodeLanguages() {
  return useQuery({
    queryKey: ["code", "languages"],
    queryFn: codeApi.listLanguages,
    staleTime: 10 * 60 * 1000,
  })
}

interface RunCodeInput {
  attemptId: string
  data: CodeSubmitRequest
}

export function useRunCodeSubmission() {
  return useMutation({
    mutationFn: async ({ attemptId, data }: RunCodeInput): Promise<CodeSubmission> => {
      const sub = await codeApi.submit(attemptId, data)

      let result = sub
      let attempts = 0
      let pollErrors = 0

      while (!isTerminalCodeStatus(result.status) && attempts < MAX_POLL_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        try {
          result = await codeApi.getResult(sub.id)
          pollErrors = 0
        } catch {
          pollErrors += 1
          if (pollErrors >= MAX_POLL_ERRORS) {
            throw new Error("Polling failed repeatedly")
          }
          continue
        }
        attempts += 1
      }

      return result
    },
  })
}

export function useCodeSubmission(submissionId: string, enabled = true) {
  return useQuery({
    queryKey: ["code", "submission", submissionId],
    queryFn: () => codeApi.getResult(submissionId),
    enabled: enabled && !!submissionId,
    staleTime: 30 * 1000,
  })
}

export function useAttemptCodeSubmissions(attemptId: string, enabled = true) {
  return useQuery({
    queryKey: ["code", "attempt", attemptId, "submissions"],
    queryFn: () => codeApi.listSubmissions(attemptId),
    enabled: enabled && !!attemptId,
    staleTime: 20 * 1000,
  })
}
