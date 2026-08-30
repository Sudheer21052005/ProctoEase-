// @vitest-environment jsdom
/**
 * Tests for reportingApi.examEvaluation (Phase B endpoint binding).
 * Mirrors reporting-download.test.ts: axios `api` module is mocked so no
 * network happens.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/api/axios", () => ({
  default: {
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

import api from "@/api/axios"
import { reportingApi } from "@/api/reporting.api"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("reportingApi.examEvaluation", () => {
  it("GETs /exams/{examId}/evaluation and returns response.data verbatim", async () => {
    const payload = {
      exam_id: "exam-1",
      exam_title: "Backend Screen",
      total_attempts: 1,
      max_score: 50,
      objective_max_score: 35,
      coding_max_score: 15,
      passing_score_pct: 50,
      borderline_max_pct: 60,
      excellence_score_pct: 75,
      candidates: [
        {
          attempt_id: "attempt-1",
          candidate_id: "candidate-1",
          candidate_name: "Ada Lovelace",
          candidate_email: "ada@techcorp.demo",
          status: "evaluated",
          started_at: "2026-08-29T10:00:00Z",
          submitted_at: "2026-08-29T11:00:00Z",
          duration_minutes: 60,
          total_score: 41,
          max_score: 50,
          percentage: 82,
          objective_score: 30,
          objective_max_score: 35,
          coding_score: 11,
          coding_max_score: 15,
          risk_score: 0.2,
          risk_level: "low",
          risk_available: true,
          total_violations: 0,
          high_violations: 0,
          critical_violations: 0,
          severe_integrity: false,
          recommendation: {
            code: "SHORTLIST",
            label: "Shortlist",
            reason: "Score 82% is at or above the excellence benchmark with clean integrity.",
          },
        },
      ],
    }
    vi.mocked(api.get).mockResolvedValueOnce({ status: 200, data: payload })

    const result = await reportingApi.examEvaluation("exam-1")

    expect(api.get).toHaveBeenCalledOnce()
    expect(api.get).toHaveBeenCalledWith("/exams/exam-1/evaluation")
    expect(result).toBe(payload) // same reference: response.data returned as-is
    expect(result.candidates[0].recommendation.code).toBe("SHORTLIST")
  })

  it("propagates axios errors to the caller (hook surfaces them as isError)", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network Error"))
    await expect(reportingApi.examEvaluation("exam-404")).rejects.toThrow("Network Error")
  })
})
