import { useState } from "react"
import { Editor } from "@monaco-editor/react"
import {
  Play, Loader2, Maximize2, Minimize2, CheckCircle2, XCircle,
  AlertTriangle, ChevronDown, ChevronUp, Lock,
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
  hiddenCasesCount = 0,
}: CodeEditorProps) {
  const { data: languages = [], isError: languagesError } = useCodeLanguages()
  const runSubmission = useRunCodeSubmission()
  const runPublic = useRunCodePublic()
  const [languageId, setLanguageId] = useState<number>(initialLanguageId ?? 71)
  const [code, setCode] = useState(() => initialCode || PYTHON_STUB)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [submission, setSubmission] = useState<CodeSubmission | null>(null)
  const [publicRunResults, setPublicRunResults] = useState<CodeRunCaseResult[] | null>(null)
  const [activeTab, setActiveTab] = useState<"results" | "terminal">("terminal")
  const [customInput, setCustomInput] = useState("")
  const [showCustomInput, setShowCustomInput] = useState(false)

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

    setSubmission(null)
    setPublicRunResults(null)
    setActiveTab("terminal")

    // Determine stdin: custom input > first public test case > empty
    const stdin =
      customInput.trim() ||
      (publicTestCases.length > 0 ? String(publicTestCases[0].input) : "")

    try {
      const result = await runSubmission.mutateAsync({
        attemptId,
        data: {
          source_code: code,
          language_id: languageId,
          question_id: questionId,
          stdin: stdin || undefined,
        },
      })

      if (!isTerminalCodeStatus(result.status)) {
        toast.warning("Execution is taking longer than expected. Please check again shortly.")
      }

      setSubmission(result)
    } catch (err) {
      toast.error("Code execution failed")
      console.error(err)
    }
  }

  const handleRunPublic = async () => {
    if (!code.trim()) {
      toast.error("Code cannot be empty")
      return
    }
    if (publicTestCases.length === 0) {
      toast.info("No public sample cases for this question")
      return
    }
    setPublicRunResults(null)
    setSubmission(null)
    setActiveTab("results")
    try {
      const result = await runPublic.mutateAsync({
        attemptId,
        data: {
          source_code: code,
          language_id: languageId,
          question_id: questionId,
        },
      })
      setPublicRunResults(result.cases)
    } catch (err) {
      toast.error("Public test run failed")
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

  // Status badge helpers
  const statusBadgeClass = (status: string) => {
    if (status === "accepted") return "bg-green-500/20 text-green-400"
    if (status === "runtime_error") return "bg-orange-500/20 text-orange-400"
    if (status === "compilation_error") return "bg-red-600/20 text-red-400"
    if (status === "time_limit_exceeded") return "bg-amber-500/20 text-amber-400"
    if (status === "queued" || status === "processing") return "bg-amber-500/20 text-amber-400"
    return "bg-red-500/20 text-red-400"
  }

  return (
    <div
      className={`flex flex-col bg-card border border-border overflow-hidden ${
        isFullscreen
          ? "fixed inset-0 z-50 rounded-none bg-background"
          : "h-full min-h-0"
      }`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-3">
          <select
            value={languageId}
            onChange={(e) => handleLanguageChange(Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm font-medium focus:ring-2 focus:ring-primary/30"
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
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground mr-2"
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
            disabled={runSubmission.isPending || runPublic.isPending || !code.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 transition"
          >
            {runSubmission.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" fill="currentColor" />
            )}
            Run Code
          </button>
          {publicTestCases.length > 0 && (
            <button
              onClick={handleRunPublic}
              disabled={runPublic.isPending || runSubmission.isPending || !code.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-secondary text-secondary-foreground text-sm font-bold rounded-lg hover:bg-secondary/80 disabled:opacity-50 transition"
            >
              {runPublic.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" fill="currentColor" />
              )}
              Run Sample Tests
            </button>
          )}
        </div>
      </div>

      {/* Monaco Editor — flex-1 so it takes remaining space */}
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

      {/* Bottom panel — custom input + output/results, bounded height */}
      <div className="shrink-0 border-t border-border" style={{ maxHeight: "260px" }}>
        {/* Custom input toggle */}
        <div className="px-3 py-1.5 border-b border-border bg-muted/20 flex items-center justify-between">
          <button
            onClick={() => setShowCustomInput(!showCustomInput)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showCustomInput ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Custom Input
            {customInput.trim() && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-medium">set</span>
            )}
          </button>
          {/* Tab switcher */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab("terminal")}
              className={`text-xs px-2 py-0.5 rounded ${activeTab === "terminal" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              Terminal
            </button>
            {publicTestCases.length > 0 && (
              <button
                onClick={() => setActiveTab("results")}
                className={`text-xs px-2 py-0.5 rounded ${activeTab === "results" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                Test Results
                {publicRunResults && (
                  <span className={`ml-1 font-bold ${
                    publicRunResults.every(r => r.passed) ? "text-green-400" : "text-red-400"
                  }`}>
                    {publicRunResults.filter(r => r.passed).length}/{publicRunResults.length}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Custom input textarea */}
        {showCustomInput && (
          <div className="px-3 py-2 border-b border-border bg-muted/20">
            <textarea
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder={
                publicTestCases.length > 0
                  ? `Custom stdin (leave empty to use first sample: ${String(publicTestCases[0].input).substring(0, 30)}${String(publicTestCases[0].input).length > 30 ? "…" : ""})`
                  : "Custom stdin for Run Code"
              }
              className="w-full text-xs font-mono bg-zinc-950 border border-border rounded p-2 text-zinc-300 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
              rows={2}
            />
          </div>
        )}

        {/* Output area */}
        <div className="overflow-y-auto bg-zinc-950 text-zinc-300 font-mono text-xs p-3" style={{ maxHeight: showCustomInput ? "130px" : "200px" }}>
          {activeTab === "terminal" && (
            <>
              {!submission && !runSubmission.isPending && (
                <p className="text-zinc-600 italic">Click "Run Code" to execute…</p>
              )}
              {runSubmission.isPending && (
                <div className="flex items-center gap-2 text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Executing in sandbox…</span>
                </div>
              )}
              {submission && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusBadgeClass(submission.status)}`}>
                      {submission.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                    {submission.time_sec != null && (
                      <span className="text-zinc-500">{submission.time_sec}s</span>
                    )}
                    {submission.memory_kb != null && (
                      <span className="text-zinc-500">{submission.memory_kb} KB</span>
                    )}
                    {submission.exit_code != null && (
                      <span className="text-zinc-500">Exit {submission.exit_code}</span>
                    )}
                  </div>

                  {submission.compile_output && (
                    <div>
                      <p className="text-red-400 mb-1">Compilation Error:</p>
                      <pre className="whitespace-pre-wrap text-zinc-300 break-words">{submission.compile_output}</pre>
                    </div>
                  )}

                  {submission.stderr && (
                    <div>
                      <p className="text-orange-400 mb-1">Runtime Error (Stderr):</p>
                      <pre className="whitespace-pre-wrap text-zinc-300 break-words">{submission.stderr}</pre>
                    </div>
                  )}

                  {submission.stdout && (
                    <div>
                      <p className="text-zinc-500 mb-1">Stdout:</p>
                      <pre className="whitespace-pre-wrap text-zinc-300 break-words">{submission.stdout}</pre>
                    </div>
                  )}

                  {!submission.stdout && !submission.stderr && !submission.compile_output && (
                    <p className="text-zinc-600 italic">No output.</p>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === "results" && (
            <>
              {runPublic.isPending && (
                <div className="flex items-center gap-2 text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Running sample tests…</span>
                </div>
              )}

              {!publicRunResults && !runPublic.isPending && (
                <p className="text-zinc-600 italic">Click "Run Sample Tests" to run all public cases…</p>
              )}

              {publicRunResults && (
                <div className="space-y-2">
                  {publicTestCases.map((tc, idx) => {
                    const result = publicRunResults[idx]
                    if (!result) return null
                    const statusIcon =
                      result.status === "accepted" && result.passed ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                      ) : result.status === "runtime_error" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
                      ) : result.status === "compilation_error" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-400" />
                      )

                    return (
                      <div
                        key={idx}
                        className={`rounded border p-2 ${
                          result.passed
                            ? "border-green-500/30 bg-green-500/5"
                            : "border-red-500/30 bg-red-500/5"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          {statusIcon}
                          <span className="font-semibold text-zinc-300">Case {idx + 1}</span>
                          <span className={`ml-auto text-[10px] font-bold ${result.passed ? "text-green-400" : "text-red-400"}`}>
                            {result.status.replace(/_/g, " ").toUpperCase()}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                          <span className="text-zinc-500">Input:</span>
                          <pre className="text-zinc-300 whitespace-pre-wrap">{result.input}</pre>
                          <span className="text-zinc-500">Expected:</span>
                          <pre className="text-zinc-300 whitespace-pre-wrap">{String(result.expected)}</pre>
                          <span className="text-zinc-500">Actual:</span>
                          <pre className={`whitespace-pre-wrap ${result.passed ? "text-green-300" : "text-red-300"}`}>
                            {result.actual || "(no output)"}
                          </pre>
                        </div>
                      </div>
                    )
                  })}

                  {/* Hidden test case indicator */}
                  {hiddenCasesCount > 0 && (
                    <div className="flex items-center gap-2 rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-zinc-500">
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs">
                        {hiddenCasesCount} hidden test {hiddenCasesCount === 1 ? "case" : "cases"} will be evaluated during final submission.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Static hidden indicator when no run yet */}
              {!publicRunResults && !runPublic.isPending && hiddenCasesCount > 0 && (
                <div className="flex items-center gap-2 mt-2 rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-zinc-500">
                  <Lock className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-xs">
                    {hiddenCasesCount} hidden test {hiddenCasesCount === 1 ? "case" : "cases"} evaluated during final submission only.
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
