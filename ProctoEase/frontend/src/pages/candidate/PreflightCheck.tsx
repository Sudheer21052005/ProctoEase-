import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useParams, useNavigate } from "react-router-dom"
import { useExam } from "@/hooks/useExams"
import { useCreateAttempt, useMyAttempts } from "@/hooks/useAttempts"
import { useActiveAttemptStore } from "@/stores/attempt.store"
import { toast } from "sonner"
import {
  CheckCircle,
  XCircle,
  Monitor,
  Camera,
  Mic,
  FileText,
  Loader2,
  ArrowRight,
  RefreshCw,
} from "lucide-react"
import type { AxiosError } from "axios"
import { formatDate } from "@/lib/utils"

interface CheckResult {
  passed: boolean
  label: string
}

export default function PreflightCheck() {
  const { examId } = useParams<{ examId: string }>()
  const navigate = useNavigate()
  const { data: exam, isLoading } = useExam(examId || "")
  const createAttempt = useCreateAttempt()
  const {
    data: myAttempts,
    isLoading: attemptsLoading,
    refetch: refetchAttempts,
  } = useMyAttempts()
  const setActiveAttempt = useActiveAttemptStore((s) => s.setActiveAttempt)

  // Two-page flow: 0 = Exam Readiness, 1 = Rules & Terms.
  const [step, setStep] = useState(0)
  const [checks, setChecks] = useState<CheckResult[]>([])
  const [checking, setChecking] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [verificationImage, setVerificationImage] = useState<string>("")
  const [capturing, setCapturing] = useState(false)
  const verificationVideoRef = useRef<HTMLVideoElement | null>(null)
  const verificationCanvasRef = useRef<HTMLCanvasElement>(null)
  const verificationStreamRef = useRef<MediaStream | null>(null)

  // Browser / media capability probe — synchronous, no permission prompt.
  // NOTE: this only detects that the Fullscreen API EXISTS; it does not enter
  // fullscreen. Fullscreen ENTRY happens on the final Start Exam click, and
  // fullscreen enforcement remains in the exam's background proctoring.
  const checkBrowser = useCallback(() => {
    const hasMedia = !!navigator.mediaDevices?.getUserMedia
    const hasFullscreen = !!document.documentElement.requestFullscreen
    const hasVisibility = "visibilityState" in document
    const allPass = hasMedia && hasFullscreen && hasVisibility
    setChecks([
      { passed: hasMedia, label: "getUserMedia API" },
      { passed: hasFullscreen, label: "Fullscreen API" },
      { passed: hasVisibility, label: "Visibility API" },
    ])
    return allPass
  }, [])

  // Camera — requests a REAL stream (genuine permission prompt). The stream is
  // retained for the mandatory identity photo and released on unmount. The
  // stream-reuse guard prevents re-prompting when the check is re-run.
  const [webcamOk, setWebcamOk] = useState<boolean | null>(null)
  const checkWebcam = useCallback(async () => {
    try {
      if (!verificationStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        verificationStreamRef.current = stream
        if (verificationVideoRef.current) {
          verificationVideoRef.current.srcObject = stream
        }
      }
      setWebcamOk(true)
    } catch {
      setWebcamOk(false)
    }
  }, [])

  // Reattach the retained camera stream whenever the <video> mounts (e.g. after
  // navigating back to the Readiness page). Reuses the single existing stream —
  // no duplicate getUserMedia.
  const setVideoNode = useCallback((node: HTMLVideoElement | null) => {
    verificationVideoRef.current = node
    if (node && verificationStreamRef.current) {
      node.srcObject = verificationStreamRef.current
    }
  }, [])

  const captureVerificationPhoto = useCallback(() => {
    const video = verificationVideoRef.current
    const canvas = verificationCanvasRef.current
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error("Webcam is not ready yet. Please try again.")
      return
    }

    setCapturing(true)
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      setCapturing(false)
      toast.error("Could not capture verification photo")
      return
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7)
    setVerificationImage(dataUrl)
    setCapturing(false)
    toast.success("Verification photo captured")
  }, [])

  // Microphone — requests a REAL stream, then releases it immediately (we only
  // need to confirm the permission/device works).
  const [micOk, setMicOk] = useState<boolean | null>(null)
  const checkMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMicOk(true)
    } catch {
      setMicOk(false)
    }
  }, [])

  // Single "Check All" action — verifies browser/media support, camera and
  // microphone in one click. Checks that already passed are not re-requested,
  // so permissions are never asked for repeatedly.
  const runAllChecks = useCallback(async () => {
    setChecking(true)
    try {
      checkBrowser()
      await Promise.all([
        webcamOk === true ? Promise.resolve() : checkWebcam(),
        micOk === true ? Promise.resolve() : checkMic(),
      ])
    } finally {
      setChecking(false)
    }
  }, [checkBrowser, checkWebcam, checkMic, webcamOk, micOk])

  // Probe browser support on mount (no permission prompt).
  useEffect(() => {
    checkBrowser()
  }, [checkBrowser])

  useEffect(() => {
    return () => {
      verificationStreamRef.current?.getTracks().forEach((t) => t.stop())
      verificationStreamRef.current = null
    }
  }, [])

  const browserReady = checks.length === 0 ? null : checks.every((c) => c.passed)

  const readinessItems: {
    key: string
    label: string
    icon: typeof Monitor
    ready: boolean | null
    retry: () => unknown
  }[] = [
    { key: "browser", label: "Browser & media support", icon: Monitor, ready: browserReady, retry: checkBrowser },
    { key: "camera", label: "Camera access", icon: Camera, ready: webcamOk, retry: checkWebcam },
    { key: "microphone", label: "Microphone access", icon: Mic, ready: micOk, retry: checkMic },
  ]

  // Readiness is complete when support + camera + microphone pass AND the
  // mandatory identity photo has been captured. Fullscreen is NOT gated here —
  // it is requested on the Start Exam click and enforced during the exam.
  const readinessComplete =
    browserReady === true &&
    webcamOk === true &&
    micOk === true &&
    !!verificationImage

  const canStart = readinessComplete && agreed

  const nowMs = Date.now()
  const startMs = exam?.start_time ? new Date(exam.start_time).getTime() : null
  const endMs = exam?.end_time ? new Date(exam.end_time).getTime() : null
  const isBeforeStart = startMs != null && nowMs < startMs
  const isAfterEnd = endMs != null && nowMs > endMs
  const outsideWindow = isBeforeStart || isAfterEnd

  const findActiveAttemptId = useCallback(
    (attempts: typeof myAttempts) => {
      if (!examId || !attempts) return null
      const active = attempts.find(
        (a) => a.exam_id === examId && a.status === "started" && a.is_active
      )
      return active?.id ?? null
    },
    [examId]
  )

  // If user already has an active attempt for this exam, bypass preflight and resume directly.
  useEffect(() => {
    if (!examId || attemptsLoading) return
    const activeAttemptId = findActiveAttemptId(myAttempts)
    if (activeAttemptId) {
      toast.info("Resuming your in-progress attempt")
      setActiveAttempt(examId, activeAttemptId)
      navigate(`/candidate/exam/${examId}/attempt/${activeAttemptId}`, {
        replace: true,
      })
    }
  }, [examId, attemptsLoading, myAttempts, findActiveAttemptId, navigate, setActiveAttempt])

  const handleBeginExam = () => {
    if (!examId) return

    // Guard against duplicate attempt creation if data is already available client-side.
    const existingAttemptId = findActiveAttemptId(myAttempts)
    if (existingAttemptId) {
      document.documentElement.requestFullscreen?.().catch(() => {})
      setActiveAttempt(examId, existingAttemptId)
      navigate(`/candidate/exam/${examId}/attempt/${existingAttemptId}`)
      return
    }

    if (outsideWindow) {
      toast.error(isBeforeStart ? "Exam not started yet" : "Exam expired")
      return
    }

    if (!verificationImage) {
      toast.error("Capture verification photo before starting the exam")
      return
    }

    // Synchronously request fullscreen from user gesture
    document.documentElement.requestFullscreen?.().catch(() => {})

    createAttempt.mutate({ examId, payload: { verification_image_base64: verificationImage } }, {
      onSuccess: (attempt) => {
        toast.success("Exam started!")
        setActiveAttempt(examId, attempt.id)
        navigate(`/candidate/exam/${examId}/attempt/${attempt.id}`)
      },
      onError: async (err) => {
        const axiosErr = err as AxiosError<{ detail: string; error_code?: string }>

        // Race-safe fallback: if server says attempt already exists, resolve and resume it.
        if (axiosErr.response?.data?.error_code === "ACTIVE_ATTEMPT_EXISTS") {
          const refreshed = await refetchAttempts()
          const activeAttemptId = findActiveAttemptId(refreshed.data)
          if (activeAttemptId) {
            toast.info("Resuming your existing attempt")
            setActiveAttempt(examId, activeAttemptId)
            navigate(`/candidate/exam/${examId}/attempt/${activeAttemptId}`)
            return
          }
        }

        // If createAttempt failed, exit fullscreen so candidate is not stranded
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {})
        }

        toast.error(axiosErr.response?.data?.detail || "Failed to start exam")
      },
    })
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const steps = [
    {
      icon: Monitor,
      title: "Exam Readiness",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Run a single check to confirm your browser, camera, and microphone
            are ready, then capture your identity photo.
          </p>

          <button
            onClick={runAllChecks}
            disabled={checking}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {checking ? "Checking…" : "Check All"}
          </button>

          {/* Per-item readiness status */}
          <div className="space-y-2">
            {readinessItems.map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-muted/20 px-3 py-2"
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                    <span className="text-sm">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.ready === null ? (
                      <span className="text-xs text-slate-500">Not checked</span>
                    ) : item.ready ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success">
                        <CheckCircle className="h-4 w-4" /> Ready
                      </span>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 text-xs text-danger">
                          <XCircle className="h-4 w-4" /> Not Ready
                        </span>
                        <button
                          onClick={item.retry}
                          className="inline-flex items-center gap-1 text-xs text-[#6366f1] hover:underline"
                        >
                          <RefreshCw className="h-3 w-3" /> Try Again
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Identity verification photo (mandatory) — reuses the camera stream */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-2">
              Identity verification photo (mandatory)
            </p>
            <video
              ref={setVideoNode}
              autoPlay
              muted
              playsInline
              className="w-full rounded border border-border bg-black"
              style={{ transform: "scaleX(-1)" }}
            />
            <canvas ref={verificationCanvasRef} className="hidden" />

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={captureVerificationPhoto}
                disabled={webcamOk !== true || capturing}
                className="px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded hover:bg-primary-700 disabled:opacity-50"
              >
                {capturing ? "Capturing..." : "Capture Photo"}
              </button>
              {verificationImage ? (
                <span className="text-xs text-success">Captured</span>
              ) : (
                <span className="text-xs text-muted-foreground">Not captured</span>
              )}
            </div>

            {verificationImage && (
              <img
                src={verificationImage}
                alt="Verification preview"
                className="mt-3 w-32 h-24 object-cover rounded border border-border"
              />
            )}
          </div>
        </div>
      ),
    },
    {
      icon: FileText,
      title: "Rules & Terms",
      content: (
        <div className="space-y-4">
          <div className="bg-muted rounded-lg p-4 text-sm space-y-2">
            <p>By starting this exam you agree to:</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>
                The exam duration is{" "}
                <strong>{exam?.duration_minutes} minutes</strong>
              </li>
              <li>Your webcam must remain on throughout the exam</li>
              <li>Tab switching and window changes will be recorded</li>
              <li>Copy, paste, and right-click are disabled</li>
              <li>The exam auto-submits when time runs out</li>
              <li>
                Excessive violations may result in automatic submission
              </li>
            </ul>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="h-4 w-4 accent-primary rounded"
            />
            <span className="text-sm font-medium">
              I have read and understood the rules.
            </span>
          </label>
        </div>
      ),
    },
  ]

  return (
    <div className="min-h-[100dvh] bg-[#0f1117] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Ambient background blob */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(99,102,241,0.09) 0, transparent 60%)",
        }}
      />

      <div className="max-w-lg w-full relative z-10">
        {/* Exam title */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
          className="text-center mb-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6366f1] mb-2">
            System Check
          </p>
          <h1 className="text-2xl font-bold text-white">{exam?.title || "Exam"}</h1>
          <p className="text-sm text-slate-400 mt-1">Pre-exam security verification</p>
          <p className="text-xs text-slate-600 mt-1.5 font-mono">
            {exam?.start_time ? formatDate(exam.start_time) : "Open"} — {exam?.end_time ? formatDate(exam.end_time) : "No end time"}
          </p>
          {outsideWindow && (
            <p className="text-xs text-red-400 mt-2 font-medium">
              {isBeforeStart ? "Exam has not started yet" : "Exam window has expired"}
            </p>
          )}
        </motion.div>

        {/* Step indicator — pill spine */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          {steps.map((_, i) => (
            <motion.div
              key={i}
              animate={{
                width: i === step ? 28 : 8,
                backgroundColor: i < step
                  ? "#10b981"
                  : i === step
                    ? "#6366f1"
                    : "rgba(255,255,255,0.12)",
              }}
              transition={{ type: "spring", stiffness: 200, damping: 22 }}
              className="h-2 rounded-full"
            />
          ))}
        </div>

        {/* Step label */}
        <p className="text-center text-xs text-slate-500 mb-4">
          Step <span className="text-slate-300 font-semibold">{step + 1}</span> of {steps.length}
        </p>

        {/* Current step card — double bezel */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: "spring", stiffness: 160, damping: 20 }}
          >
            {/* Outer bezel */}
            <div className="rounded-[1.25rem] p-[2px] bg-gradient-to-b from-[#6366f1]/25 to-white/[0.04]">
              {/* Inner card */}
              <div className="rounded-[1.1rem] bg-[#161b27] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_48px_-12px_rgba(0,0,0,0.5)]">
                {/* Step header */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 rounded-xl bg-[#6366f1]/12 border border-[#6366f1]/20 flex items-center justify-center shrink-0">
                    {(() => {
                      const Icon = steps[step].icon
                      return <Icon className="h-5 w-5 text-[#6366f1]" strokeWidth={1.5} />
                    })()}
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      Step {step + 1}
                    </p>
                    <h2 className="text-base font-bold text-white leading-tight">
                      {steps[step].title}
                    </h2>
                  </div>
                </div>

                {steps[step].content}

                {/* Navigation */}
                <div className="flex justify-between mt-6 pt-4 border-t border-white/[0.07]">
                  <button
                    onClick={() => setStep(Math.max(0, step - 1))}
                    disabled={step === 0}
                    className="px-4 py-2 text-sm font-medium border border-white/[0.08] rounded-xl text-slate-300 hover:bg-white/[0.06] hover:text-white transition-all disabled:opacity-30"
                  >
                    Previous
                  </button>

                  {step < steps.length - 1 ? (
                    <button
                      onClick={() => setStep(step + 1)}
                      disabled={!readinessComplete || outsideWindow}
                      className="inline-flex items-center gap-2 px-5 py-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-semibold rounded-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_6px_20px_-6px_rgba(99,102,241,0.5)] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
                    >
                      Continue <ArrowRight className="h-4 w-4" strokeWidth={2} />
                    </button>
                  ) : (
                    <button
                      onClick={handleBeginExam}
                      disabled={!canStart || outsideWindow || createAttempt.isPending || attemptsLoading}
                      className="group relative inline-flex items-center gap-2.5 px-6 py-2.5 rounded-full font-semibold text-sm transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      style={{
                        background: (!canStart || outsideWindow)
                          ? "rgba(255,255,255,0.07)"
                          : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                        color: (!canStart || outsideWindow) ? "rgba(255,255,255,0.3)" : "#fff",
                        boxShadow: (!canStart || outsideWindow)
                          ? "none"
                          : "0 0 0 0 rgba(16,185,129,0)",
                      }}
                    >
                      {createAttempt.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center">
                          <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
                        </span>
                      )}
                      {createAttempt.isPending ? "Starting…" : "Start Exam"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
