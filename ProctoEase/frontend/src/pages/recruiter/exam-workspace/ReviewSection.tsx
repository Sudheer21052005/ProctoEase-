import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { ClipboardList, Loader2, CheckCircle2, XCircle } from "lucide-react"
import { useExamAttempts, useAnswers } from "@/hooks/useAttempts"
import { useQuestionsForExam } from "@/hooks/useQuestions"
import { useAttemptCodeSubmissions } from "@/hooks/useCodeExecution"
import FeatureGuard from "@/components/security/FeatureGuard"
import FormattedText from "@/components/common/FormattedText"
import type { AnswerRead } from "@/api/attempt.api"

function optionLabel(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ")
  return value != null ? String(value) : "—"
}

export default function ReviewSection() {
  const { examId } = useParams<{ examId: string }>()
  const {
    data: attempts = [],
    isLoading: attemptsLoading,
    isError: attemptsError,
  } = useExamAttempts(examId || "")
  const {
    data: questions = [],
    isLoading: questionsLoading,
  } = useQuestionsForExam(examId || "")

  const [selectedAttemptId, setSelectedAttemptId] = useState("")

  // Deep-link support: /recruiter/exams/:examId/review?attemptId=<id>
  // pre-selects that attempt. Honored exactly ONCE (ref-guarded) so a later
  // manual <select> change is never overridden; without a valid requested id
  // the default selection falls back to attempts[0] exactly as before.
  const [searchParams] = useSearchParams()
  const requestedAttemptId = searchParams.get("attemptId") || ""
  const deepLinkConsumedRef = useRef(false)

  useEffect(() => {
    if (!selectedAttemptId && attempts.length > 0) {
      setSelectedAttemptId(attempts[0].id)
    }
  }, [attempts, selectedAttemptId])

  useEffect(() => {
    if (deepLinkConsumedRef.current || attempts.length === 0) return
    const requested = requestedAttemptId
    if (requested && attempts.some((a) => a.id === requested)) {
      deepLinkConsumedRef.current = true
      setSelectedAttemptId(requested)
    }
  }, [attempts, requestedAttemptId])

  const {
    data: answerData,
    isLoading: answersLoading,
    isError: answersError,
  } = useAnswers(selectedAttemptId, !!selectedAttemptId)

  const { data: codeSubs = [], isLoading: codeLoading } = useAttemptCodeSubmissions(
    selectedAttemptId,
    !!selectedAttemptId
  )

  const answersByQuestion = useMemo(() => {
    const map = new Map<string, AnswerRead>()
    answerData?.answers.forEach((a) => map.set(a.question_id, a))
    return map
  }, [answerData])

  const codeByQuestion = useMemo(() => {
    const map = new Map<string, typeof codeSubs>()
    codeSubs.forEach((s) => {
      if (!s.question_id) return
      const bucket = map.get(s.question_id) || []
      bucket.push(s)
      map.set(s.question_id, bucket)
    })
    return map
  }, [codeSubs])

  const autoTotal = answerData?.total_score || 0
  const maxScore = answerData?.max_score || questions.reduce((acc, q) => acc + q.points, 0)

  if (attemptsLoading || questionsLoading) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (attemptsError) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">Could not load attempt review data.</p>
      </div>
    )
  }

  if (attempts.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">No attempts available for review.</p>
      </div>
    )
  }

  return (
    <FeatureGuard allowedRoles={["recruiter", "admin"]}>
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          Candidate Answer Review
        </h2>

        <label className="text-sm text-muted-foreground block mb-2">Attempt</label>
        <select
          value={selectedAttemptId}
          onChange={(e) => setSelectedAttemptId(e.target.value)}
          className="w-full max-w-xl px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          {attempts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.candidate_email
                ? `${a.candidate_email} | ${a.status}`
                : `${a.id.slice(0, 8)}… | ${a.status}`}
            </option>
          ))}
        </select>

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Auto-Graded Score</p>
            <p className="text-xl font-bold">{autoTotal}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Max Score</p>
            <p className="text-xl font-bold">{maxScore}</p>
          </div>
        </div>
      </div>

      {answersLoading || codeLoading ? (
        <div className="rounded-xl border border-border bg-card p-10 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : answersError || !answerData ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">Could not load answers for selected attempt.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, idx) => {
            const answer = answersByQuestion.get(q.id)
            const isCode = q.question_type === "code"
            const codeForQuestion = codeByQuestion.get(q.id) || []
            const maxPts = q.points

            return (
              <div key={q.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-primary">Q{idx + 1}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                    {q.question_type.replace("_", " ")}
                  </span>
                  <span className="text-xs text-muted-foreground">{q.points} points</span>
                </div>

                <div className="mb-4">
                  <FormattedText text={q.question_text} />
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground mb-1">Candidate Response</p>
                    {isCode ? (() => {
                      const latestSub = codeForQuestion[0]
                      const answerEntry = answersByQuestion.get(q.id)
                      // Source code: prefer CodeSubmission.source_code, fallback to answer.text_answer
                      const sourceCode = latestSub?.source_code || answerEntry?.text_answer || null
                      const languageName = latestSub?.language_name || (
                        answerEntry?.language_id ? `Language ${answerEntry.language_id}` : "Unknown"
                      )
                      if (!sourceCode) {
                        return <p className="text-sm text-muted-foreground">No code submitted.</p>
                      }
                      return (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            {latestSub && (
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                latestSub.status === "accepted"
                                  ? "bg-green-500/20 text-green-400"
                                  : latestSub.status === "wrong_answer"
                                  ? "bg-red-500/20 text-red-400"
                                  : latestSub.status === "runtime_error"
                                  ? "bg-orange-500/20 text-orange-400"
                                  : latestSub.status === "compilation_error"
                                  ? "bg-red-700/20 text-red-500"
                                  : "bg-muted text-muted-foreground"
                              }`}>
                                {latestSub.status.replace(/_/g, " ").toUpperCase()}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">{languageName}</span>
                            {latestSub?.time_sec != null && (
                              <span className="text-xs text-muted-foreground">{latestSub.time_sec}s</span>
                            )}
                          </div>
                          {/* Submitted source code */}
                          <pre className="text-xs rounded bg-muted/50 p-2 overflow-x-auto max-h-48 border border-border whitespace-pre-wrap break-words">
                            {sourceCode}
                          </pre>
                          {/* Compilation error */}
                          {latestSub?.compile_output && (
                            <div className="rounded bg-red-500/10 border border-red-500/20 p-2">
                              <p className="text-xs text-red-400 font-semibold mb-1">Compilation Output:</p>
                              <pre className="text-xs text-red-300 whitespace-pre-wrap break-words">{latestSub.compile_output}</pre>
                            </div>
                          )}
                          {/* Runtime stderr */}
                          {latestSub?.stderr && !latestSub?.compile_output && (
                            <div className="rounded bg-orange-500/10 border border-orange-500/20 p-2">
                              <p className="text-xs text-orange-400 font-semibold mb-1">Runtime Error / Stderr:</p>
                              <pre className="text-xs text-orange-300 whitespace-pre-wrap break-words">{latestSub.stderr}</pre>
                            </div>
                          )}
                          {/* Stdout */}
                          {latestSub?.stdout && (
                            <div className="rounded bg-muted/50 border border-border p-2">
                              <p className="text-xs text-muted-foreground font-semibold mb-1">Output:</p>
                              <pre className="text-xs text-foreground whitespace-pre-wrap break-words">{latestSub.stdout}</pre>
                            </div>
                          )}
                        </div>
                      )
                    })() : (
                      <p className="text-sm">{optionLabel(answer?.selected_option_ids)}</p>
                    )}
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground mb-1">Scoring</p>
                    {isCode ? (
                      <div className="text-sm space-y-1">
                        <p>
                          Auto Result:{" "}
                          {answer?.is_correct == null
                            ? "Pending"
                            : answer.is_correct
                            ? "✅ Passed"
                            : "❌ Failed"}
                        </p>
                        <p>
                          Points Earned: {answer?.points_earned ?? 0} / {maxPts}
                        </p>
                        {answer?.is_correct == null && (
                          <p className="text-xs text-muted-foreground italic">
                            Graded automatically when the exam is submitted.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm space-y-1">
                        <p>
                          Auto Result: {answer?.is_correct == null ? "Pending" : answer.is_correct ? "Correct" : "Incorrect"}
                        </p>
                        <p>
                          Points Earned: {answer?.points_earned ?? 0} / {maxPts}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Correct Answer: {optionLabel(q.correct_answer)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Test Case Results Section */}
                {isCode && q.correct_answer && typeof q.correct_answer === "object" && "test_cases" in q.correct_answer && Array.isArray((q.correct_answer as { test_cases?: unknown[] }).test_cases) && (
                  (() => {
                    const allCases = ((q.correct_answer as { test_cases: Array<{ input: string; expected: unknown; is_public?: boolean }> }).test_cases) || []
                    const hasPublic = allCases.some((tc) => tc.is_public === true)
                    const publicCases = hasPublic
                      ? allCases.filter((tc) => tc.is_public === true)
                      : allCases.slice(0, 1)
                    const hiddenCases = hasPublic
                      ? allCases.filter((tc) => tc.is_public === false || tc.is_public == null)
                      : allCases.slice(1)

                    const isAllPassed = answer?.is_correct === true
                    const hasGrading = answer?.is_correct != null
                    const casesPassed = answer?.cases_passed ?? (isAllPassed ? allCases.length : 0)
                    const totalCases = answer?.total_cases ?? allCases.length

                    const publicPassed = isAllPassed
                      ? publicCases.length
                      : Math.min(casesPassed, publicCases.length)
                    const hiddenPassed = isAllPassed
                      ? hiddenCases.length
                      : Math.max(0, casesPassed - publicCases.length)

                    const latestSub = codeForQuestion[0]

                    return (
                      <div className="mt-4 pt-4 border-t border-border">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                            Test Case Results
                          </h4>
                          <div className="flex items-center gap-3 text-xs font-mono">
                            <span className="text-muted-foreground">
                              Public Tests:{" "}
                              <strong className={publicPassed === publicCases.length ? "text-green-400" : "text-amber-400"}>
                                {publicPassed} / {publicCases.length} Passed
                              </strong>
                            </span>
                            {hiddenCases.length > 0 && (
                              <span className="text-muted-foreground">
                                Hidden Tests:{" "}
                                <strong className={hiddenPassed === hiddenCases.length ? "text-green-400" : "text-amber-400"}>
                                  {hasGrading ? `${hiddenPassed} / ${hiddenCases.length} Passed` : "Evaluated during final submission"}
                                </strong>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          {allCases.map((tc, tcIdx) => {
                            const isPublic = tc.is_public !== false
                            const casePassed = isAllPassed || (casesPassed > tcIdx)
                            const actualVal = casePassed
                              ? tc.expected
                              : latestSub?.compile_output
                              ? "[Compilation Error]"
                              : latestSub?.stderr
                              ? "[Runtime Error]"
                              : latestSub?.stdout?.trim() || "Wrong Output"

                            return (
                              <div
                                key={tcIdx}
                                className={`rounded-lg border p-3 text-xs font-mono ${
                                  casePassed
                                    ? "border-green-500/30 bg-green-500/5"
                                    : "border-red-500/30 bg-red-500/5"
                                }`}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                                      {casePassed ? (
                                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                                      ) : (
                                        <XCircle className="h-4 w-4 text-red-400" />
                                      )}
                                      Test Case {tcIdx + 1}
                                    </span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-semibold">
                                      {isPublic ? "Public" : "Hidden"}
                                    </span>
                                  </div>
                                  <span
                                    className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                                      casePassed
                                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                        : "bg-red-500/20 text-red-400 border border-red-500/30"
                                    }`}
                                  >
                                    {casePassed ? "PASSED" : "FAILED"}
                                  </span>
                                </div>
                                <div className="grid sm:grid-cols-3 gap-2">
                                  <div>
                                    <span className="text-muted-foreground block text-[11px]">Input:</span>
                                    <pre className="text-foreground bg-muted/40 p-1.5 rounded mt-0.5 whitespace-pre-wrap">{tc.input}</pre>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground block text-[11px]">Expected:</span>
                                    <pre className="text-foreground bg-muted/40 p-1.5 rounded mt-0.5 whitespace-pre-wrap">{String(tc.expected)}</pre>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground block text-[11px]">Actual:</span>
                                    <pre className={`p-1.5 rounded mt-0.5 whitespace-pre-wrap ${casePassed ? "text-green-400 bg-green-950/20" : "text-red-400 bg-red-950/20"}`}>{String(actualVal)}</pre>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border">
                          <span>
                            Total: <strong>{hasGrading ? `${casesPassed} / ${totalCases} test cases passed` : "Pending evaluation"}</strong>
                          </span>
                          <span>
                            Points Earned: <strong>{answer?.points_earned ?? 0} / {maxPts}</strong>
                          </span>
                        </div>
                      </div>
                    )
                  })()
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
    </FeatureGuard>
  )
}

