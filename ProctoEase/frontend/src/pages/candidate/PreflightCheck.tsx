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
  Maximize,
  FileText,
  Loader2,
  ArrowRight,
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

  const [step, setStep] = useState(0)
  const [checks, setChecks] = useState<CheckResult[]>([])
  const [agreed, setAgreed] = useState(false)
  const [verificationImage, setVerificationImage] = useState<string>("")
  const [capturing, setCapturing] = useState(false)
  const verificationVideoRef = useRef<HTMLVideoElement>(null)
  const verificationCanvasRef = useRef<HTMLCanvasElement>(null)
  const verificationStreamRef = useRef<MediaStream | null>(null)

  // Step 0: Browser compatibility
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

  // Step 1: Webcam
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

  // Step 2: Microphone
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

  // Step 3: Fullscreen
  const [fsOk, setFsOk] = useState<boolean | null>(null)
  const checkFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen()
      setFsOk(true)
      // Exit fullscreen for now; exam screen will re-enter
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      setFsOk(false)
    }
  }, [])

  // Run browser check on mount
  useEffect(() => {
    checkBrowser()
  }, [checkBrowser])

  useEffect(() => {
    return () => {
      verificationStreamRef.current?.getTracks().forEach((t) => t.stop())
      verificationStreamRef.current = null
    }
  }, [])

  const allChecksPassed =
    checks.every((c) => c.passed) &&
    webcamOk === true &&
    micOk === true &&
    fsOk === true &&
    !!verificationImage &&
    agreed

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
      title: "Browser Compatibility",
      content: (
        <div className="space-y-3">
          {checks.map((c) => (
            <div key={c.label} className="flex items-center gap-3">
              {c.passed ? (
                <CheckCircle className="h-5 w-5 text-success" />
              ) : (
                <XCircle className="h-5 w-5 text-danger" />
              )}
              <span className="text-sm">{c.label}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: Camera,
      title: "Webcam Permission",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click the button below to grant webcam access.
          </p>
          <button
            onClick={checkWebcam}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary-700 transition"
          >
            Check Webcam
          </button>
          {webcamOk !== null && (
            <div className="flex items-center gap-2 mt-2">
              {webcamOk ? (
                <CheckCircle className="h-5 w-5 text-success" />
              ) : (
                <XCircle className="h-5 w-5 text-danger" />
              )}
              <span className="text-sm">
                {webcamOk ? "Webcam access granted" : "Webcam access denied"}
              </span>
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-2">Identity verification photo (mandatory)</p>
            <video
              ref={verificationVideoRef}
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
      icon: Mic,
      title: "Microphone Permission",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click the button below to grant microphone access.
          </p>
          <button
            onClick={checkMic}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary-700 transition"
          >
            Check Microphone
          </button>
          {micOk !== null && (
            <div className="flex items-center gap-2 mt-2">
              {micOk ? (
                <CheckCircle className="h-5 w-5 text-success" />
              ) : (
                <XCircle className="h-5 w-5 text-danger" />
              )}
              <span className="text-sm">
                {micOk
                  ? "Microphone access granted"
                  : "Microphone access denied"}
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      icon: Maximize,
      title: "Fullscreen Test",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click below to test entering fullscreen mode.
          </p>
          <button
            onClick={checkFullscreen}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary-700 transition"
          >
            Enter Fullscreen
          </button>
          {fsOk !== null && (
            <div className="flex items-center gap-2 mt-2">
              {fsOk ? (
                <CheckCircle className="h-5 w-5 text-success" />
              ) : (
                <XCircle className="h-5 w-5 text-danger" />
              )}
              <span className="text-sm">
                {fsOk ? "Fullscreen works" : "Fullscreen failed"}
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      icon: FileText,
      title: "Rules Agreement",
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
              I agree to the proctoring terms
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
                      className="inline-flex items-center gap-2 px-5 py-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-semibold rounded-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_6px_20px_-6px_rgba(99,102,241,0.5)] active:scale-[0.97]"
                    >
                      Next <ArrowRight className="h-4 w-4" strokeWidth={2} />
                    </button>
                  ) : (
                    <button
                      onClick={handleBeginExam}
                      disabled={!allChecksPassed || outsideWindow || createAttempt.isPending || attemptsLoading}
                      className="group relative inline-flex items-center gap-2.5 px-6 py-2.5 rounded-full font-semibold text-sm transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      style={{
                        background: (!allChecksPassed || outsideWindow)
                          ? "rgba(255,255,255,0.07)"
                          : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                        color: (!allChecksPassed || outsideWindow) ? "rgba(255,255,255,0.3)" : "#fff",
                        boxShadow: (!allChecksPassed || outsideWindow)
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
                      {createAttempt.isPending ? "Starting…" : "Begin Exam"}
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
