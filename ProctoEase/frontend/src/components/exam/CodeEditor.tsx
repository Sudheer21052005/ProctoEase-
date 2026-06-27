import { useState } from "react"
import { Editor } from "@monaco-editor/react"
import { Play, Loader2, Maximize2, Minimize2 } from "lucide-react"
import {
  isTerminalCodeStatus,
  type CodeSubmission,
} from "@/api/code.api"
import { useCodeLanguages, useRunCodeSubmission } from "@/hooks/useCodeExecution"
import { toast } from "sonner"

interface CodeEditorProps {
  attemptId: string
  questionId: string
  initialCode?: string
  onChange?: (code: string) => void
}

export default function CodeEditor({
  attemptId,
  questionId,
  initialCode = "",
  onChange,
}: CodeEditorProps) {
  const { data: languages = [], isError: languagesError } = useCodeLanguages()
  const runSubmission = useRunCodeSubmission()
  const [languageId, setLanguageId] = useState<number>(71) // Python default in Judge0
  const [code, setCode] = useState(initialCode)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [submission, setSubmission] = useState<CodeSubmission | null>(null)

  const handleEditorChange = (value: string | undefined) => {
    const val = value || ""
    setCode(val)
    if (onChange) onChange(val)
  }

  const handleRunCode = async () => {
    if (!code.trim()) {
      toast.error("Code cannot be empty")
      return
    }

    setSubmission(null)

    try {
      const result = await runSubmission.mutateAsync({
        attemptId,
        data: {
          source_code: code,
          language_id: languageId,
          question_id: questionId,
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

  // Find language name for Monaco
  const currentLang = languages.find((l) => l.id === languageId)?.name.toLowerCase() || "python"
  // Map Judge0 language name to Monaco language string
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
    // Optional: lock scroll on body
    if (!isFullscreen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
  }

  return (
    <div
      className={`flex flex-col bg-card border border-border overflow-hidden ${
        isFullscreen
          ? "fixed inset-0 z-50 rounded-none bg-background"
          : "rounded-xl h-[600px] mt-6"
      }`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <select
            value={languageId}
            onChange={(e) => setLanguageId(Number(e.target.value))}
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
            disabled={runSubmission.isPending || !code.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 transition"
          >
            {runSubmission.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" fill="currentColor" />
            )}
            Run Code
          </button>
        </div>
      </div>

      {/* Editor & Output Split */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        {/* Editor */}
        <div className="relative flex-1 md:basis-3/5 md:max-w-[60%] border-b md:border-b-0 md:border-r border-border h-[60%] md:h-full">
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

        {/* Output */}
        <div className="w-full md:basis-2/5 md:max-w-[40%] bg-zinc-950 text-zinc-300 p-4 font-mono text-sm overflow-y-auto flex flex-col">
          <h3 className="text-zinc-500 font-bold mb-4 uppercase tracking-wider text-xs">
            Terminal Output
          </h3>

          {!submission && !runSubmission.isPending && (
            <p className="text-zinc-600 italic">Click "Run Code" to execute...</p>
          )}

          {runSubmission.isPending && (
            <div className="flex items-center gap-2 text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Executing in sandbox...</span>
            </div>
          )}

          {submission && (
            <div className="space-y-4">
              <div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    submission.status === "accepted"
                      ? "bg-green-500/20 text-green-400"
                      : submission.status === "queued" || submission.status === "processing"
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {submission.status.replace("_", " ").toUpperCase()}
                </span>
                <span className="text-zinc-500 text-xs ml-3">
                  {submission.time_sec != null ? `${submission.time_sec}s` : ""}
                </span>
                <span className="text-zinc-500 text-xs ml-3">
                  {submission.memory_kb != null ? `${submission.memory_kb} KB` : ""}
                </span>
                <span className="text-zinc-500 text-xs ml-3">
                  {submission.exit_code != null ? `Exit ${submission.exit_code}` : ""}
                </span>
              </div>

              {submission.compile_output && (
                <div>
                  <p className="text-red-400 text-xs mb-1">Compilation Error:</p>
                  <pre className="whitespace-pre-wrap text-zinc-300 break-words">
                    {submission.compile_output}
                  </pre>
                </div>
              )}

              {submission.stderr && (
                <div>
                  <p className="text-red-400 text-xs mb-1">Stderr:</p>
                  <pre className="whitespace-pre-wrap text-zinc-300 break-words">
                    {submission.stderr}
                  </pre>
                </div>
              )}

              {submission.stdout && (
                <div>
                  <p className="text-zinc-500 text-xs mb-1">Stdout:</p>
                  <pre className="whitespace-pre-wrap text-zinc-300 break-words">
                    {submission.stdout}
                  </pre>
                </div>
              )}

              {!submission.stdout && !submission.stderr && !submission.compile_output && (
                <p className="text-zinc-600 italic">No output.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
