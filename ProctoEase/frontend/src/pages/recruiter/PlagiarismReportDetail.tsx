import { useState, useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import { type PlagiarismPair } from "@/api/plagiarism.api"
import { useCodeSubmission } from "@/hooks/useCodeExecution"
import { usePlagiarismReport } from "@/hooks/usePlagiarism"
import { DiffEditor } from "@monaco-editor/react"
import { Loader2, ArrowLeft, CheckCircle, AlertTriangle } from "lucide-react"
import { toast } from "sonner"

export default function PlagiarismReportDetail() {
  const { reportId } = useParams<{ reportId: string }>()
  const {
    data: report,
    isLoading: loading,
    isError,
  } = usePlagiarismReport(reportId || "")

  const [selectedPair, setSelectedPair] = useState<PlagiarismPair | null>(null)
  const {
    data: subA,
    isLoading: loadingSubA,
    isError: subAError,
  } = useCodeSubmission(selectedPair?.submission_a_id || "", !!selectedPair)
  const {
    data: subB,
    isLoading: loadingSubB,
    isError: subBError,
  } = useCodeSubmission(selectedPair?.submission_b_id || "", !!selectedPair)
  const loadingPair = loadingSubA || loadingSubB

  useEffect(() => {
    if (!report) return
    // Auto-select the highest similarity flagged pair if it exists.
    if (report.pairs.length > 0) {
      const flagged = [...report.pairs].sort((a, b) => b.similarity_score - a.similarity_score)
      if (flagged.length > 0) {
        setSelectedPair(flagged[0])
      }
    }
  }, [report])

  useEffect(() => {
    if (isError) {
      toast.error("Failed to load report details")
    }
  }, [isError])

  useEffect(() => {
    if (subAError || subBError) {
      toast.error("Failed to load submission source code for diff")
    }
  }, [subAError, subBError])

  if (loading || !report) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-[#6366f1]" />
      </div>
    )
  }

  return (
    <div className="max-w-[1400px] mx-auto h-[calc(100vh-100px)] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link
            to={`/recruiter/exams/${report.exam_id}/plagiarism`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-2 font-medium"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Scans
          </Link>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            Detailed Plagiarism Report
            <span className="text-sm font-normal text-slate-500 ml-2">
              (Threshold: {(report.threshold * 100).toFixed(0)}%)
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm mt-2">
          <div className="flex items-center gap-1.5 bg-[#161b27] border border-white/[0.07] px-3 py-1.5 rounded-lg text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <span className="font-bold">{report.total_pairs}</span>
            <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Pairs Analyzed</span>
          </div>
          <div className="flex items-center gap-1.5 bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-bold">{report.flagged_pairs}</span>
            <span className="text-xs uppercase tracking-wide font-medium">Flagged</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Left Side: Pairs List */}
        <div className="border border-white/[0.07] bg-[#161b27] rounded-xl overflow-hidden flex flex-col relative">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/20 to-transparent z-10" />
          <div className="bg-white/[0.02] p-3 border-b border-white/[0.07] text-xs font-semibold uppercase tracking-wide text-slate-400 relative z-20">
            Top Similarities
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1 relative z-20">
            {report.pairs.length === 0 && (
              <p className="text-sm text-center text-slate-500 py-4">
                No pairs analyzed.
              </p>
            )}
            {[...report.pairs]
              .sort((a, b) => b.similarity_score - a.similarity_score)
              .map((pair) => {
                const isActive = selectedPair?.id === pair.id
                return (
                  <button
                    key={pair.id}
                    onClick={() => setSelectedPair(pair)}
                    className={`w-full text-left p-3 rounded-lg border text-sm transition-all flex flex-col gap-1 ${
                      isActive
                        ? "bg-[#6366f1]/10 border-[#6366f1]/30 shadow-[inset_0_0_12px_rgba(99,102,241,0.1)]"
                        : "border-transparent hover:bg-white/[0.04] text-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-slate-500">
                        {pair.candidate_a_id.slice(0, 6)} vs {pair.candidate_b_id.slice(0, 6)}
                      </span>
                      {pair.is_flagged ? (
                        <span className="text-red-400 font-bold bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-md text-xs">
                          {(pair.similarity_score * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-emerald-400 font-bold text-xs pr-1">
                          {(pair.similarity_score * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
          </div>
        </div>

        {/* Right Side: Diff Viewer */}
        <div className="lg:col-span-3 border border-white/[0.07] bg-[#161b27] rounded-xl overflow-hidden flex flex-col">
          {!selectedPair ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
              <CheckCircle className="h-10 w-10 text-emerald-500/20 mb-3" />
              <p>Select a pair on the left to view the code diff.</p>
            </div>
          ) : loadingPair ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#6366f1]" />
            </div>
          ) : subA && subB ? (
            <>
              {/* Diff Header */}
              <div className="grid grid-cols-2 bg-white/[0.02] border-b border-white/[0.07] pl-12 pr-4 py-2.5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.5)]">
                <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-[#6366f1]/50" />
                  Candidate A: <span className="font-bold text-white">{selectedPair.candidate_a_id}</span>
                </div>
                <div className="text-xs font-mono text-slate-400 border-l border-white/[0.07] pl-4 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-amber-400/50" />
                  Candidate B: <span className="font-bold text-white">{selectedPair.candidate_b_id}</span>
                </div>
              </div>

              {/* Code Diff area */}
              <div className="flex-1 min-h-0 bg-[#1e1e1e]">
                <DiffEditor
                  height="100%"
                  theme="vs-dark"
                  language="python" // Assumption; could be dynamic based on subA language
                  original={subA.source_code || ""}
                  modified={subB.source_code || ""}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    wordWrap: "on",
                    scrollBeyondLastLine: false,
                    readOnly: true,
                    renderSideBySide: true,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-danger">
              Failed to load submission source code.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
