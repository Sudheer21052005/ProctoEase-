// @vitest-environment jsdom
/**
 * Tests for reportingApi.downloadIntegrityReportPdf
 *
 * These run in the Vitest "node" environment so there is no real DOM.
 * We mock:
 *   - the axios `api` module so requests never hit the network.
 *   - window.URL (createObjectURL / revokeObjectURL).
 *   - document.createElement / body.appendChild / body.removeChild / click.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// -- Axios mock ----------------------------------------------------------------
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

// -- DOM helpers ---------------------------------------------------------------
const mockClick = vi.fn()
const mockRemove = vi.fn()
const mockAppendChild = vi.fn()
const mockSetAttribute = vi.fn()

const mockLink = {
  href: "",
  click: mockClick,
  remove: mockRemove,
  setAttribute: mockSetAttribute,
}

const mockCreateObjectURL = vi.fn(() => "blob:mock-url")
const mockRevokeObjectURL = vi.fn()

function makeResponse(status: number, blobContent: string, contentType: string) {
  return {
    status,
    data: new Blob([blobContent], { type: contentType }),
    headers: { "content-type": contentType },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as { URL: { createObjectURL: typeof mockCreateObjectURL; revokeObjectURL: typeof mockRevokeObjectURL } }).URL = {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
  }
  vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLAnchorElement)
  vi.spyOn(document.body, "appendChild").mockImplementation(mockAppendChild)
})

describe("reportingApi.downloadIntegrityReportPdf", () => {
  it("triggers browser download on valid HTTP 200 application/pdf response", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(200, "%PDF-1.4 test content", "application/pdf"))
    await reportingApi.downloadIntegrityReportPdf("attempt-abc-123")
    expect(mockCreateObjectURL).toHaveBeenCalledOnce()
    expect(document.createElement).toHaveBeenCalledWith("a")
    expect(mockSetAttribute).toHaveBeenCalledWith("download", "integrity-report-attempt-abc-123.pdf")
    expect(mockClick).toHaveBeenCalledOnce()
    expect(mockRemove).toHaveBeenCalledOnce()
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url")
  })

  it("requests the correct endpoint path", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(200, "%PDF-1.4 content", "application/pdf"))
    await reportingApi.downloadIntegrityReportPdf("my-attempt-id")
    expect(api.get).toHaveBeenCalledWith(
      "/attempts/my-attempt-id/integrity-report/pdf",
      expect.objectContaining({ responseType: "blob" })
    )
  })

  it("uses validateStatus: () => true so non-2xx responses are never thrown by axios", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(200, "%PDF-1.4 content", "application/pdf"))
    await reportingApi.downloadIntegrityReportPdf("x")
    const callArgs = vi.mocked(api.get).mock.calls[0]?.[1] as { validateStatus?: (s: number) => boolean }
    expect(typeof callArgs?.validateStatus).toBe("function")
    expect(callArgs?.validateStatus?.(200)).toBe(true)
    expect(callArgs?.validateStatus?.(401)).toBe(true)
    expect(callArgs?.validateStatus?.(500)).toBe(true)
  })

  it("throws and does NOT trigger download when Content-Type is not application/pdf", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(200, '{"detail":"ok"}', "application/json"))
    await expect(reportingApi.downloadIntegrityReportPdf("attempt-xyz")).rejects.toThrow(/unexpected content type/i)
    expect(mockClick).not.toHaveBeenCalled()
    expect(mockCreateObjectURL).not.toHaveBeenCalled()
  })

  it("throws and does NOT trigger download when blob is empty", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ status: 200, data: new Blob([], { type: "application/pdf" }), headers: { "content-type": "application/pdf" } })
    await expect(reportingApi.downloadIntegrityReportPdf("attempt-empty")).rejects.toThrow(/empty response/i)
    expect(mockClick).not.toHaveBeenCalled()
  })

  it("throws Not authorized error for HTTP 401", async () => {
    // Empty body â†’ detail is empty â†’ generic fallback fires
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(401, "", "application/json"))
    await expect(reportingApi.downloadIntegrityReportPdf("attempt-401")).rejects.toThrow(/Not authorized/i)
    expect(mockClick).not.toHaveBeenCalled()
  })

  it("uses server detail message for HTTP 401 when available", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(401, '{"detail":"Custom auth error"}', "application/json"))
    await expect(reportingApi.downloadIntegrityReportPdf("attempt-401")).rejects.toThrow("Custom auth error")
  })

  it("throws permission error for HTTP 403 and does NOT download", async () => {
    // Empty body â†’ detail is empty â†’ generic fallback fires
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(403, "", "application/json"))
    await expect(reportingApi.downloadIntegrityReportPdf("attempt-403")).rejects.toThrow(/permission/i)
    expect(mockClick).not.toHaveBeenCalled()
    expect(mockCreateObjectURL).not.toHaveBeenCalled()
  })

  it("throws not-found error for HTTP 404 and does NOT download", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(404, '{"detail":"Attempt not found","error_code":"ATTEMPT_NOT_FOUND"}', "application/json"))
    await expect(reportingApi.downloadIntegrityReportPdf("attempt-404")).rejects.toThrow(/not found/i)
    expect(mockClick).not.toHaveBeenCalled()
  })

  it("throws generation error for HTTP 500 and does NOT download", async () => {
    // Empty body â†’ detail is empty â†’ generic fallback fires
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(500, "", "application/json"))
    await expect(reportingApi.downloadIntegrityReportPdf("attempt-500")).rejects.toThrow(/could not be generated/i)
    expect(mockClick).not.toHaveBeenCalled()
    expect(mockCreateObjectURL).not.toHaveBeenCalled()
  })

  it("throws generic error for unexpected status codes", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(503, "", "text/html"))
    await expect(reportingApi.downloadIntegrityReportPdf("attempt-503")).rejects.toThrow(/HTTP 503/i)
    expect(mockClick).not.toHaveBeenCalled()
  })

  it("extracts detail from error JSON blob body instead of using generic message", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(403, '{"detail":"Recruiter cannot access another tenant attempt","error_code":"FORBIDDEN"}', "application/json"))
    await expect(reportingApi.downloadIntegrityReportPdf("cross-tenant-attempt")).rejects.toThrow("Recruiter cannot access another tenant attempt")
  })
})
