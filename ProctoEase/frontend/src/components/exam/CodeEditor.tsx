import { useState, useEffect } from "react"
import { Editor } from "@monaco-editor/react"
import {
  Play, Loader2, Maximize2, Minimize2,
  Terminal, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Edit3, Maximize, Minimize,
} from "lucide-react"
import {
  isTerminalCodeStatus,
  type CodeSubmission,
  type CodeRunCaseResult,
} from "@/api/code.api"
import { useCodeLanguages, useRunCodeSubmission, useRunCodePublic } from "@/hooks/useCodeExecution"
import type { PublicTestCase } from "@/api/question.api"
import { toast } from "sonner"

interface CodeEditorProps {
  attemptId: string
  questionId: string
  initialCode?: string
  initialLanguageId?: number
  onChange?: (code: string, languageId: number) => void
  publicTestCases?: PublicTestCase[]
  hiddenCasesCount?: number
}

// Generic stdin starter template — does not suggest any problem-specific logic
const PYTHON_STUB = `import sys

def main():
    # Read all inputs from standard input (stdin)
    input_data = sys.stdin.read().split()
    if not input_data:
        return

    # TODO: Write your solution logic here

if __name__ == "__main__":
    main()
`

export default function CodeEditor({
  attemptId,
  questionId,
  initialCode = "",
  initialLanguageId,
  onChange,
  publicTestCases = [],
}: CodeEditorProps) {
  const { data: languages = [], isError: languagesError } = useCodeLanguages()
  const runSubmission = useRunCodeSubmission()
  const runPublic = useRunCodePublic()

  const [languageId, setLanguageId] = useState<number>(initialLanguageId ?? 71)
  const [code, setCode] = useState(() => initialCode || PYTHON_STUB)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Terminal state
  const [isTerminalOpen, setIsTerminalOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [activeTab, setActiveTab] = useState<"terminal" | "results" | "custom_input">("terminal")
  const [submission, setSubmission] = useState<CodeSubmission | null>(null)
  const [publicResults, setPublicResults] = useState<CodeRunCaseResult[] | null>(null)
  const [customInput, setCustomInput] = useState("")

  // Pre-fill custom input with first public test case input if empty
  useEffect(() => {
    if (!customInput && publicTestCases.length > 0 && publicTestCases[0].input) {
      setCustomInput(publicTestCases[0].input)
    }
  }, [publicTestCases, customInput])

  const handleLanguageChange = (newLangId: number) => {
    setLanguageId(newLangId)
    if (onChange) onChange(code, newLangId)
  }

  const handleEditorChange = (value: string | undefined) => {
    const val = value || ""
    setCode(val)
    if (onChange) onChange(val, languageId)
  }

  const handleRunCode = async () => {
    if (!code.trim()) {
      toast.error("Code cannot be empty")
      return
    }

    // Automatically expand the terminal upward
    setIsTerminalOpen(true)
    setActiveTab("terminal")
    setSubmission(null)

    // Determine stdin: custom input > first public test case > empty
    const stdin =
      customInput.trim() ||
      (publicTestCases.length > 0 ? String(publicTestCases[0].input) : "")

    try {
      // 1. Run single execution (with custom stdin / sample stdin)
      const subPromise = runSubmission.mutateAsync({
        attemptId,
        data: {
          source_code: code,
          language_id: languageId,
          question_id: questionId,
          stdin: stdin || undefined,
        },
      })

      // 2. Also evaluate public test cases if available
      let pubPromise: Promise<unknown> = Promise.resolve(null)
      if (publicTestCases.length > 0) {
        pubPromise = runPublic.mutateAsync({
          attemptId,
          data: {
            source_code: code,
            language_id: languageId,
            question_id: questionId,
          },
        }).then((res) => {
          setPublicResults(res.cases || [])
        }).catch((err) => {
          console.warn("Public test run error:", err)
        })
      }

      const [result] = await Promise.all([subPromise, pubPromise])

      if (!isTerminalCodeStatus(result.status)) {
        toast.warning("Execution is taking longer than expected. Please check again shortly.")
      }

      setSubmission(result)
    } catch (err) {
      toast.error("Code execution failed")
      console.error(err)
    }
  }

  // Find language name for Monaco
  const currentLang = languages.find((l) => l.id === languageId)?.name.toLowerCase() || "python"
  const monacoLang = currentLang.includes("python")
    ? "python"
    : currentLang.includes("javascript")
    ? "javascript"
    : currentLang.includes("c++")
    ? "cpp"
    : currentLang.includes("java")
    ? "java"
    : "plaintext"

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen)
    if (!isFullscreen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
  }

  const passedPublicCount = publicResults
    ? publicResults.filter((r) => r.passed).length
    : submission?.status === "accepted"
    ? publicTestCases.length
    : 0

  const statusBadgeClass = (status: string) => {
    if (status === "accepted") return "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
    if (status === "runtime_error") return "bg-orange-500/20 text-orange-400 border border-orange-500/30"
    if (status === "compilation_error") return "bg-red-600/20 text-red-400 border border-red-600/30"
    if (status === "time_limit_exceeded") return "bg-amber-500/20 text-amber-400 border border-amber-500/30"
    return "bg-red-500/20 text-red-400 border border-red-500/30"
  }

  // Terminal height: collapsed (38px), normal (240px), maximized (380px)
  const terminalHeightStyle = !isTerminalOpen
    ? "h-9"
    : isMaximized
    ? "h-96"
    : "h-60"

  return (
    <div
      className={`flex flex-col bg-card border border-border overflow-hidden h-full min-h-0 ${
        isFullscreen
          ? "fixed inset-0 z-50 rounded-none bg-background"
          : "relative"
      }`}
    >
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-[#161b27] shrink-0">
        <div className="flex items-center gap-3">
          <select
            value={languageId}
            onChange={(e) => handleLanguageChange(Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg border border-border bg-[#1c2333] text-sm font-medium text-slate-200 focus:ring-2 focus:ring-primary/30"
            disabled={languagesError}
          >
            {languages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 mr-1"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>

          <button
            onClick={handleRunCode}
            disabled={runSubmission.isPending || !code.trim()}
            className="inline-flex items-center gap-2 px-4 py-1.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-all hover:-translate-y-[0.5px]"
          >
            {runSubmission.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4 fill-currentColor" />
            )}
            <span>Run Code</span>
          </button>
        </div>
      </div>

      {/* Monaco Code Editor */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="python"
          language={monacoLang}
          theme="vs-dark"
          value={code}
          onChange={handleEditorChange}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: "on",
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
            renderLineHighlight: "line",
            cursorBlinking: "smooth",
            smoothScrolling: true,
            padding: { top: 16, bottom: 16 },
          }}
        />
        {!code.trim() && (
          <div className="absolute top-8 left-12 text-slate-600 text-sm font-mono pointer-events-none select-none">
            # Write your solution here...
          </div>
        )}
      </div>

      {/* Adjustable Bottom Terminal Panel (Slide-up / Retract with Arrow) */}
      <div
        className={`border-t border-border bg-[#10141d] flex flex-col shrink-0 transition-all duration-200 ${terminalHeightStyle}`}
      >
        {/* Terminal Header Bar */}
        <div className="flex items-center justify-between px-3 h-9 bg-[#161b27] border-b border-border/80 shrink-0 select-none">
          {/* Tab Navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setActiveTab("terminal")
                setIsTerminalOpen(true)
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors ${
                activeTab === "terminal" && isTerminalOpen
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Terminal</span>
            </button>

            {publicTestCases.length > 0 && (
              <button
                onClick={() => {
                  setActiveTab("results")
                  setIsTerminalOpen(true)
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors ${
                  activeTab === "results" && isTerminalOpen
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  Test Results
                  {submission && (
                    <span className="ml-1 text-[11px] font-mono text-emerald-400">
                      ({passedPublicCount}/{publicTestCases.length})
                    </span>
                  )}
                </span>
              </button>
            )}

            <button
              onClick={() => {
                setActiveTab("custom_input")
                setIsTerminalOpen(true)
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors ${
                activeTab === "custom_input" && isTerminalOpen
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
              }`}
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>Custom Input</span>
              {customInput.trim() && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              )}
            </button>
          </div>

          {/* Right Controls: Status & Expand/Retract Arrow */}
          <div className="flex items-center gap-2">
            {runSubmission.isPending ? (
              <div className="flex items-center gap-1.5 text-xs text-primary font-mono">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Running...</span>
              </div>
            ) : submission ? (
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${statusBadgeClass(submission.status)}`}>
                  {submission.status.replace(/_/g, " ").toUpperCase()}
                </span>
                {submission.time_sec != null && (
                  <span className="text-slate-400 hidden sm:inline">{submission.time_sec}s</span>
                )}
                {submission.memory_kb != null && (
                  <span className="text-slate-400 hidden sm:inline">{submission.memory_kb} KB</span>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-slate-500 hidden sm:inline">
                {isTerminalOpen ? "Standard Output / Test Results" : "Click to expand terminal"}
              </span>
            )}

            {/* Maximize / Normal Toggle */}
            {isTerminalOpen && (
              <button
                onClick={() => setIsMaximized(!isMaximized)}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition"
                title={isMaximized ? "Restore Height" : "Maximize Terminal"}
              >
                {isMaximized ? (
                  <Minimize className="h-3.5 w-3.5" />
                ) : (
                  <Maximize className="h-3.5 w-3.5" />
                )}
              </button>
            )}

            {/* Adjustable Retract / Expand Arrow */}
            <button
              onClick={() => setIsTerminalOpen(!isTerminalOpen)}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition"
              title={isTerminalOpen ? "Retract Terminal (Collapse)" : "Expand Terminal"}
            >
              {isTerminalOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Terminal Body (Scrollable, rendered when open) */}
        {isTerminalOpen && (
          <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
            {/* Tab 1: Terminal Stdout / Diagnostics */}
            {activeTab === "terminal" && (
              <div className="space-y-3">
                {runSubmission.isPending && (
                  <div className="flex items-center gap-2 text-slate-400 py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span>Executing code on runner...</span>
                  </div>
                )}

                {submission?.compile_output && (
                  <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-2.5">
                    <p className="text-red-400 font-bold uppercase tracking-wider text-[11px] mb-1">
                      Compilation Output:
                    </p>
                    <pre className="text-red-300 whitespace-pre-wrap">{submission.compile_output}</pre>
                  </div>
                )}

                {submission?.stderr && (
                  <div className="rounded-lg border border-orange-500/30 bg-orange-950/20 p-2.5">
                    <p className="text-orange-400 font-bold uppercase tracking-wider text-[11px] mb-1">
                      Runtime Error / Stderr:
                    </p>
                    <pre className="text-orange-300 whitespace-pre-wrap">{submission.stderr}</pre>
                  </div>
                )}

                {submission?.stdout ? (
                  <div>
                    <pre className="text-slate-100 whitespace-pre-wrap leading-relaxed">
                      {submission.stdout}
                    </pre>
                  </div>
                ) : submission && !submission.compile_output && !submission.stderr ? (
                  <p className="text-slate-500 italic">No output.</p>
                ) : !runSubmission.isPending && !submission ? (
                  <p className="text-slate-500 italic">Click "Run Code" to execute your program.</p>
                ) : null}
              </div>
            )}

            {/* Tab 2: Test Results */}
            {activeTab === "results" && (
              <div className="space-y-3">
                {publicTestCases.map((tc, idx) => {
                  const caseRes = publicResults?.find(
                    (r) => String(r.input).trim() === String(tc.input).trim()
                  ) || (publicResults && publicResults[idx])
                  const hasRun = Boolean(caseRes || submission)
                  const isPassed = caseRes
                    ? caseRes.passed
                    : submission?.status === "accepted"
                  const actual = caseRes?.actual != null
                    ? String(caseRes.actual)
                    : isPassed
                    ? String(tc.expected)
                    : submission?.compile_output
                    ? "[Compilation Error]"
                    : submission?.stderr
                    ? "[Runtime Error]"
                    : submission?.stdout?.trim() || "—"

                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border p-2.5 ${
                        !hasRun
                          ? "border-white/[0.08] bg-white/[0.02]"
                          : isPassed
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-red-500/30 bg-red-500/5"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                          {hasRun ? (
                            isPassed ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-red-400" />
                            )
                          ) : (
                            <span className="w-3.5 h-3.5 rounded-full border border-slate-600 inline-block" />
                          )}
                          Sample Case {idx + 1}
                        </span>
                        {hasRun && (
                          <span
                            className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              isPassed
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : "bg-red-500/20 text-red-400 border border-red-500/30"
                            }`}
                          >
                            {isPassed ? "PASSED" : "FAILED"}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-500 block mb-0.5">Input:</span>
                          <pre className="text-slate-200 bg-black/30 p-1.5 rounded">{tc.input}</pre>
                        </div>
                        <div>
                          <span className="text-slate-500 block mb-0.5">Expected:</span>
                          <pre className="text-slate-200 bg-black/30 p-1.5 rounded">{String(tc.expected)}</pre>
                        </div>
                        <div>
                          <span className="text-slate-500 block mb-0.5">Actual:</span>
                          <pre
                            className={`p-1.5 rounded ${
                              isPassed ? "text-emerald-300 bg-emerald-950/30" : "text-red-300 bg-red-950/30"
                            }`}
                          >
                            {actual}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Tab 3: Custom Input */}
            {activeTab === "custom_input" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    Standard input (stdin) to pass to your program:
                  </span>
                  <div className="flex items-center gap-1.5">
                    {publicTestCases.map((tc, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCustomInput(tc.input)}
                        className="text-[11px] px-2 py-0.5 rounded border border-white/[0.08] bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] transition"
                      >
                        Use Sample {idx + 1}
                      </button>
                    ))}
                    {customInput && (
                      <button
                        onClick={() => setCustomInput("")}
                        className="text-[11px] px-2 py-0.5 rounded border border-white/[0.08] text-slate-400 hover:text-red-400 transition"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="Type standard input here (e.g. 12 8)..."
                  rows={4}
                  className="w-full text-xs font-mono bg-zinc-950 border border-white/[0.1] rounded p-2 text-zinc-200 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
