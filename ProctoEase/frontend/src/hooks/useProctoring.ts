import { useEffect, useCallback, useRef } from "react"
import { useProctoringStore } from "@/stores/proctoring.store"
import { API_BASE_URL } from "@/lib/constants"
import type { CanonicalViolationType } from "@/lib/proctoring.catalog"
import {
  loadMLModels,
  detectFacesAndGaze,
  detectObjects,
  isFaceModelReady,
  isObjectModelReady,
} from "@/lib/ml-detection"
import { startAudioMonitor, type AudioMonitorHandle } from "@/lib/audio-detection"
import {
  AUDIO_COOLDOWN_MS,
  AUDIO_SUSTAINED_MS,
  BULK_PASTE_THRESHOLD,
  BURST_COOLDOWN_MS,
  BURST_THRESHOLD,
  BURST_WINDOW_MS,
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  DEVTOOLS_CHECK_MS,
  DEVTOOLS_COOLDOWN_MS,
  DEVTOOLS_THRESHOLD,
  ENABLE_AUDIO_DEBUG,
  ENABLE_AUDIO_DETECTION,
  ENABLE_FACE_DETECTOR_FALLBACK,
  ENABLE_FACE_ML,
  ENABLE_GAZE,
  ENABLE_OBJECT_DETECTION,
  FACE_COUNT_SMOOTHING_WINDOW,
  FACE_SCAN_MS,
  FACE_VIOLATION_COOLDOWN_MS,
  GAZE_GRACE_MS,
  HEARTBEAT_MS,
  INACTIVITY_MS,
  LIVE_WEBCAM_SELECTOR,
  ML_FACE_SCAN_MS,
  ML_OBJECT_SCAN_MS,
  ML_SNAP_THROTTLE_MS,
  MULTI_FACE_PERSIST_MS,
  NO_FACE_PERSIST_MS,
  OBJECT_SNAP_THROTTLE_MS,
  PERIODIC_SNAPSHOT_MS,
  PROCTORING_DEBUG_LOGS,
  RAPID_TAB_COOLDOWN_MS,
  RAPID_TAB_THRESHOLD,
  RAPID_TAB_WINDOW_MS,
  SNAPSHOT_JPEG_QUALITY,
  SNAPSHOT_THROTTLE_MS,
  TAB_SWITCH_DEDUPE_MS,
} from "@/lib/proctoring.config"

interface UseProctoringOptions {
  enabled: boolean
  examId?: string
  attemptId?: string
  onMaxViolations: () => void
}

const DERIVED_TYPES = new Set<CanonicalViolationType>([
  "rapid_tab_switching",
  "suspicious_activity_burst",
  "bulk_paste_detected",
  "impossible_answer_speed",
])

const SNAPSHOT_EVENTS = new Set<CanonicalViolationType>([
  "no_face",
  "multiple_faces",
  "face_inconsistency",
  "tab_switch",
  "fullscreen_exit",
  "gaze_away",
  "head_turned",
  "phone_detected",
  "unauthorized_object",
])

/** Per-frame detector logging, off unless PROCTORING_DEBUG_LOGS is enabled. */
function debugLog(label: string, detail?: unknown) {
  if (!PROCTORING_DEBUG_LOGS) return
  if (detail === undefined) console.log(label)
  else console.log(label, detail)
}

/**
 * Build the WebSocket URL from the REST API base URL.
 * http://localhost:8000/api/v1 → ws://localhost:8000/api/v1
 */
function buildWsUrl(examId: string, attemptId: string, token: string): string {
  const base = API_BASE_URL.replace(/^http/, "ws")
  return `${base}/exams/${examId}/attempts/${attemptId}/proctor?token=${encodeURIComponent(token)}`
}

export function useProctoring({
  enabled,
  examId,
  attemptId,
  onMaxViolations,
}: UseProctoringOptions) {
  const { addViolation, isMaxViolations } = useProctoringStore()
  const wsRef = useRef<WebSocket | null>(null)
  const eventQueueRef = useRef<Array<{
    type: "event"
    event_type: CanonicalViolationType
    detail: Record<string, unknown>
    severity: number
    timestamp: string
    snapshot_base64?: string
  }>>([])
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recentBaseEventsRef = useRef<Array<{ type: CanonicalViolationType; ts: number }>>([])
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const devtoolsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const periodicTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const faceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const devtoolsWasOpenRef = useRef(false)
  const lastDerivedRef = useRef<Record<string, number>>({})
  const lastSnapshotByTypeRef = useRef<Record<string, number>>({})
  const lastFaceCountRef = useRef<number | null>(null)
  const noFaceStartRef = useRef<number | null>(null)
  const multiFaceStartRef = useRef<number | null>(null)
  const faceViolationLastFiredRef = useRef<{ no_face: number; multiple_faces: number }>({
    no_face: 0,
    multiple_faces: 0,
  })
  const mlFaceCountHistoryRef = useRef<number[]>([])
  const fallbackFaceCountHistoryRef = useRef<number[]>([])
  const mlFaceTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const mlObjectTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const gazeAwayStartRef  = useRef<number | null>(null)
  const headTurnedStartRef = useRef<number | null>(null)
  const faceModelReadyRef = useRef<boolean>(false)
  const objectModelReadyRef = useRef<boolean>(false)
  const audioMonitorRef = useRef<AudioMonitorHandle | null>(null)
  const captureVideoRef = useRef<HTMLVideoElement | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const captureStreamRef = useRef<MediaStream | null>(null)
  const maxViolationsFiredRef = useRef(false)

  const ensureCaptureStream = useCallback(async () => {
    const liveVideo = document.querySelector(LIVE_WEBCAM_SELECTOR) as HTMLVideoElement | null
    if (liveVideo) {
      captureVideoRef.current = liveVideo
      if (!captureCanvasRef.current) {
        captureCanvasRef.current = document.createElement("canvas")
      }
      return true
    }

    if (captureStreamRef.current) return true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT, facingMode: "user" },
        audio: false,
      })
      captureStreamRef.current = stream

      if (captureVideoRef.current) {
        captureVideoRef.current.srcObject = stream
        await captureVideoRef.current.play().catch(() => {})
      } else {
        const video = document.createElement("video")
        video.autoplay = true
        video.muted = true
        video.playsInline = true
        video.srcObject = stream
        await video.play().catch(() => {})
        captureVideoRef.current = video
      }

      const canvas = document.createElement("canvas")
      captureCanvasRef.current = canvas
      return true
    } catch {
      return false
    }
  }, [])

  const captureSnapshot = useCallback(async () => {
    const ok = await ensureCaptureStream()
    if (!ok) return undefined

    const video = captureVideoRef.current
    const canvas = captureCanvasRef.current
    if (!video || !canvas) return undefined

    debugLog("Capture attempt - readyState:", {
      readyState: video.readyState,
      videoWidth: video.videoWidth,
    })
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      debugLog("captureSnapshot: video not ready", {
        readyState: video.readyState,
        videoWidth: video.videoWidth,
      })
      return undefined
    }

    const width = video.videoWidth
    const height = video.videoHeight
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext("2d")
    if (!ctx) return undefined

    ctx.drawImage(video, 0, 0, width, height)
    return canvas.toDataURL("image/jpeg", SNAPSHOT_JPEG_QUALITY)
  }, [ensureCaptureStream])

  const checkAndTrigger = useCallback(() => {
    // Latch: auto-submit must fire at most once per attempt. Without this,
    // every subsequent violation re-triggers onMaxViolations (duplicate toasts
    // and repeated submit attempts) once the threshold has been crossed.
    if (maxViolationsFiredRef.current) return
    if (isMaxViolations()) {
      maxViolationsFiredRef.current = true
      onMaxViolations()
    }
  }, [isMaxViolations, onMaxViolations])

  const requestFullscreen = useCallback(() => {
    if (document.fullscreenElement) return
    document.documentElement.requestFullscreen().catch(() => {})
  }, [])

  const stopCamera = useCallback(() => {
    captureStreamRef.current?.getTracks().forEach((t) => t.stop())
    captureStreamRef.current = null
    captureVideoRef.current = null
    captureCanvasRef.current = null
    // Releases the microphone too: this is the "exam is over, release capture
    // devices" teardown (ExamScreen calls it at the top of handleSubmit), and
    // leaving the mic open would keep the browser recording indicator lit
    // after submission.
    audioMonitorRef.current?.stop()
    audioMonitorRef.current = null
  }, [])

  // ── Send violation event via WebSocket ──
  const sendEvent = useCallback(
    (
      eventType: CanonicalViolationType,
      detail: Record<string, unknown>,
      severity = 1,
      timestamp?: string,
      snapshotBase64?: string
    ) => {
      const payload = {
        type: "event" as const,
        event_type: eventType,
        detail,
        severity,
        timestamp: timestamp || new Date().toISOString(),
        snapshot_base64: snapshotBase64,
      }

      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload))
      } else {
        eventQueueRef.current.push(payload)
        debugLog("[WS QUEUE] Event queued while socket was not open", { eventType })
      }
    },
    []
  )

  const getSmoothedFaceCount = useCallback((source: "ML" | "Fallback", rawFaceCount: number) => {
    const historyRef = source === "ML" ? mlFaceCountHistoryRef : fallbackFaceCountHistoryRef
    historyRef.current.push(rawFaceCount)
    if (historyRef.current.length > FACE_COUNT_SMOOTHING_WINDOW) {
      historyRef.current.shift()
    }

    const counts = historyRef.current.reduce<Record<number, number>>((acc, value) => {
      acc[value] = (acc[value] || 0) + 1
      return acc
    }, {})

    let winningValue = rawFaceCount
    let winningCount = 0
    for (const [value, count] of Object.entries(counts)) {
      if (count > winningCount) {
        winningCount = count
        winningValue = Number(value)
      }
    }
    return winningValue
  }, [])

  const captureSnapshotWithFallback = useCallback(async () => {
    let snapshot = await captureSnapshot()
    if (!snapshot) {
      snapshot = await captureSnapshot()
    }
    if (!snapshot) {
      debugLog("[SNAPSHOT] fallback triggered")
      snapshot = "fallback-empty"
    }
    return snapshot
  }, [captureSnapshot])

  const processFacePresence = useCallback(
    async (source: "ML" | "Fallback", rawFaceCount: number) => {
      const now = Date.now()
      const faceCount = getSmoothedFaceCount(source, rawFaceCount)

      if (faceCount === 0) {
        if (noFaceStartRef.current === null) {
          noFaceStartRef.current = now
        }
        multiFaceStartRef.current = null

        const duration = now - noFaceStartRef.current
        const lastFired = faceViolationLastFiredRef.current.no_face
        if (duration >= NO_FACE_PERSIST_MS && now - lastFired >= FACE_VIOLATION_COOLDOWN_MS) {
          debugLog("[VIOLATION TRIGGERED]", {
            type: "no_face",
            faceCount,
            duration,
          })
          const snapshot = await captureSnapshotWithFallback()
          faceViolationLastFiredRef.current.no_face = now
          addViolation("no_face", "No face detected")
          sendEvent(
            "no_face",
            {
              description: "No face detected",
              face_count: faceCount,
              source,
              duration_ms: duration,
              ml_detected: source === "ML",
            },
            2,
            new Date(now).toISOString(),
            snapshot
          )
          checkAndTrigger()
        }
        return
      }
      noFaceStartRef.current = null

      if (faceCount >= 2) {
        if (multiFaceStartRef.current === null) {
          multiFaceStartRef.current = now
        }

        const duration = now - multiFaceStartRef.current
        const lastFired = faceViolationLastFiredRef.current.multiple_faces
        if (duration >= MULTI_FACE_PERSIST_MS && now - lastFired >= FACE_VIOLATION_COOLDOWN_MS) {
          debugLog("[VIOLATION TRIGGERED]", {
            type: "multiple_faces",
            faceCount,
            duration,
          })
          const snapshot = await captureSnapshotWithFallback()
          faceViolationLastFiredRef.current.multiple_faces = now
          addViolation("multiple_faces", `${faceCount} faces detected`)
          sendEvent(
            "multiple_faces",
            {
              description: `${faceCount} faces detected`,
              face_count: faceCount,
              source,
              duration_ms: duration,
              ml_detected: source === "ML",
            },
            3,
            new Date(now).toISOString(),
            snapshot
          )
          checkAndTrigger()
        }
        return
      }

      multiFaceStartRef.current = null
    },
    [addViolation, sendEvent, checkAndTrigger, captureSnapshotWithFallback, getSmoothedFaceCount]
  )

  const maybeEmitDerived = useCallback(
    (eventTs: number) => {
      const recent = recentBaseEventsRef.current
      const tabEvents = recent.filter(
        (e) => e.type === "tab_switch" && eventTs - e.ts <= RAPID_TAB_WINDOW_MS
      )
      if (tabEvents.length > RAPID_TAB_THRESHOLD) {
        const last = lastDerivedRef.current.rapid_tab_switching || 0
        if (eventTs - last >= RAPID_TAB_COOLDOWN_MS) {
          lastDerivedRef.current.rapid_tab_switching = eventTs
          addViolation("rapid_tab_switching", "Rapid tab switching pattern detected")
          sendEvent(
            "rapid_tab_switching",
            {
              description: `More than ${RAPID_TAB_THRESHOLD} tab switches within ${RAPID_TAB_WINDOW_MS / 1000} seconds`,
              count: tabEvents.length,
              window_ms: RAPID_TAB_WINDOW_MS,
            },
            2,
            new Date(eventTs).toISOString()
          )
        }
      }

      const burstEvents = recent.filter((e) => eventTs - e.ts <= BURST_WINDOW_MS)
      if (burstEvents.length > BURST_THRESHOLD) {
        const last = lastDerivedRef.current.suspicious_activity_burst || 0
        if (eventTs - last >= BURST_COOLDOWN_MS) {
          lastDerivedRef.current.suspicious_activity_burst = eventTs
          addViolation("suspicious_activity_burst", "Suspicious burst of violations detected")
          sendEvent(
            "suspicious_activity_burst",
            {
              description: `More than ${BURST_THRESHOLD} violations within ${BURST_WINDOW_MS / 1000} seconds`,
              count: burstEvents.length,
              window_ms: BURST_WINDOW_MS,
            },
            2,
            new Date(eventTs).toISOString()
          )
        }
      }
    },
    [addViolation, sendEvent]
  )

  const recordBaseEvent = useCallback(
    (eventType: CanonicalViolationType, eventTs: number) => {
      if (DERIVED_TYPES.has(eventType)) return

      recentBaseEventsRef.current.push({ type: eventType, ts: eventTs })
      recentBaseEventsRef.current = recentBaseEventsRef.current.filter(
        (e) => eventTs - e.ts <= BURST_WINDOW_MS
      )
      maybeEmitDerived(eventTs)
    },
    [maybeEmitDerived]
  )

  const reportViolation = useCallback(
    (
      eventType: CanonicalViolationType,
      description: string,
      severity = 1,
      detail?: Record<string, unknown>,
      snapshotBase64?: string
    ) => {
      const ts = Date.now()
      // Catch-all for `audio_anomaly` regardless of caller, with a stack trace
      // so an unexpected emitter is identifiable. Gated by ENABLE_AUDIO_DEBUG.
      if (ENABLE_AUDIO_DEBUG && eventType === "audio_anomaly") {
        console.log(`[AUDIO DEBUG] reportViolation received audio_anomaly timestamp=${ts}`)
        console.trace("[AUDIO DEBUG] audio_anomaly call site")
      }
      addViolation(eventType, description)
      sendEvent(
        eventType,
        {
          description,
          ...(detail || {}),
        },
        severity,
        new Date(ts).toISOString(),
        snapshotBase64
      )
      recordBaseEvent(eventType, ts)
      checkAndTrigger()
    },
    [addViolation, sendEvent, recordBaseEvent, checkAndTrigger]
  )

  // Stable handle onto the latest reportViolation. Long-lived resources (the
  // microphone) must not be torn down and re-acquired just because the
  // callback identity changed on a re-render.
  const reportViolationRef = useRef(reportViolation)
  useEffect(() => {
    reportViolationRef.current = reportViolation
  }, [reportViolation])

  // ── WebSocket connection ──
  useEffect(() => {
    if (!enabled) return
    if (!examId || !attemptId || examId === "undefined" || attemptId === "undefined" || examId === "null" || attemptId === "null") {
      console.warn("WebSocket: missing or invalid examId/attemptId, skipping", { examId, attemptId })
      return
    }

    const token = window.__proctoease_access_token || localStorage.getItem("proctoease_access_token")
    if (!token) return

    const ws = new WebSocket(buildWsUrl(examId, attemptId, token))
    wsRef.current = ws
    let closeAfterOpen = false

    ws.onopen = () => {
      if (closeAfterOpen) {
        ws.close()
        return
      }

      while (eventQueueRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
        const queued = eventQueueRef.current.shift()
        if (!queued) break
        ws.send(JSON.stringify(queued))
      }

      // Start heartbeat
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "heartbeat" }))
        }
      }, HEARTBEAT_MS)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "ack" && typeof msg.violation_count === "number") {
          // Sync backend violation count with store
          const store = useProctoringStore.getState()
          if (msg.violation_count > store.violationCount) {
            // Backend has more violations — sync our count up
            store.setViolationCount(msg.violation_count)
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onerror = () => {
      // WebSocket errors are non-fatal — proctoring continues locally
    }

    ws.onclose = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
    }

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
      if (mlFaceTimerRef.current) {
        clearInterval(mlFaceTimerRef.current)
        mlFaceTimerRef.current = null
      }
      if (mlObjectTimerRef.current) {
        clearInterval(mlObjectTimerRef.current)
        mlObjectTimerRef.current = null
      }
      noFaceStartRef.current = null
      multiFaceStartRef.current = null
      faceViolationLastFiredRef.current = {
        no_face: 0,
        multiple_faces: 0,
      }
      mlFaceCountHistoryRef.current = []
      fallbackFaceCountHistoryRef.current = []
      gazeAwayStartRef.current   = null
      headTurnedStartRef.current = null

      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      } else if (ws.readyState === WebSocket.CONNECTING) {
        // In React StrictMode cleanup can run while CONNECTING. Delay close to avoid noisy browser error.
        closeAfterOpen = true
      }

      if (wsRef.current === ws) {
        wsRef.current = null
      }
    }
  }, [enabled, examId, attemptId])

  // ── Tab / window visibility change ──
  useEffect(() => {
    if (!enabled) return

    const lastTabViolationRef = { current: 0 }

    const handleVisibility = async () => {
      if (document.visibilityState === "hidden") {
        lastTabViolationRef.current = Date.now()
        const now = Date.now()
        let snapshot: string | undefined
        if (SNAPSHOT_EVENTS.has("tab_switch")) {
          const lastSnapAt = lastSnapshotByTypeRef.current["tab_switch"] || 0
          if (now - lastSnapAt >= SNAPSHOT_THROTTLE_MS) {
            snapshot = await captureSnapshot()
            if (snapshot) {
              lastSnapshotByTypeRef.current["tab_switch"] = now
            }
          }
        }

        reportViolation("tab_switch", "Tab or window switch detected", 1, undefined, snapshot)
      }
    }

    const handleBlur = async () => {
      // Deduplicate with visibilitychange
      if (Date.now() - lastTabViolationRef.current < TAB_SWITCH_DEDUPE_MS) return

      const now = Date.now()
      let snapshot: string | undefined
      if (SNAPSHOT_EVENTS.has("tab_switch")) {
        const lastSnapAt = lastSnapshotByTypeRef.current["tab_switch"] || 0
        if (now - lastSnapAt >= SNAPSHOT_THROTTLE_MS) {
          snapshot = await captureSnapshot()
          if (snapshot) {
            lastSnapshotByTypeRef.current["tab_switch"] = now
          }
        }
      }

      reportViolation("tab_switch", "Window lost focus", 1, undefined, snapshot)
    }

    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("blur", handleBlur)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("blur", handleBlur)
    }
  }, [enabled, reportViolation, captureSnapshot])

  // Sync store to the real fullscreen state exactly once on mount
  useEffect(() => {
    const s = useProctoringStore.getState()
    const initialFs = !!document.fullscreenElement
    if (s.isFullscreen !== initialFs) s.setFullscreen(initialFs)
    if (initialFs && !s.isFullscreenArmed) s.setIsFullscreenArmed(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Fullscreen exit detection ──
  useEffect(() => {
    if (!enabled) return

    const handleFsChange = async () => {
      const isFs = !!document.fullscreenElement
      const store = useProctoringStore.getState()
      if (store.isFullscreen !== isFs) {
        store.setFullscreen(isFs)
      }

      if (isFs) {
        if (!store.isFullscreenArmed) {
          store.setIsFullscreenArmed(true)
        }
      } else {
        // Record violation ONLY if fullscreen was already armed
        if (store.isFullscreenArmed) {
          const now = Date.now()
          let snapshot: string | undefined
          if (SNAPSHOT_EVENTS.has("fullscreen_exit")) {
            const lastSnapAt = lastSnapshotByTypeRef.current["fullscreen_exit"] || 0
            if (now - lastSnapAt >= SNAPSHOT_THROTTLE_MS) {
              snapshot = await captureSnapshot()
              if (snapshot) {
                lastSnapshotByTypeRef.current["fullscreen_exit"] = now
              }
            }
          }

          reportViolation("fullscreen_exit", "Exited fullscreen mode", 2, undefined, snapshot)

          // Try to re-enter fullscreen
          document.documentElement.requestFullscreen().catch(() => {})
        }
      }
    }

    document.addEventListener("fullscreenchange", handleFsChange)
    return () =>
      document.removeEventListener("fullscreenchange", handleFsChange)
  }, [enabled, reportViolation, captureSnapshot])

  // ── Keyboard shortcuts detection ──
  useEffect(() => {
    if (!enabled) return

    const handleKeydown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const isCopyPasteCombo = e.ctrlKey && ["c", "v"].includes(key)
      const blocked =
        (e.ctrlKey && ["c", "v", "x", "a", "p", "s"].includes(key)) ||
        (e.altKey && e.key === "Tab") ||
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(key))

      if (blocked) {
        e.preventDefault()
        e.stopPropagation()
        const desc = `Blocked shortcut: ${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key}`
        if (isCopyPasteCombo) {
          reportViolation("copy_paste", desc, 2, { key: e.key, action: key === "c" ? "copy" : "paste" })
        } else {
          reportViolation("keyboard_block", desc, 1, { key: e.key, action: "blocked_shortcut" })
        }
      }
    }

    window.addEventListener("keydown", handleKeydown, true)
    return () => window.removeEventListener("keydown", handleKeydown, true)
  }, [enabled, reportViolation])

  // ── Copy/paste + right-click detection ──
  useEffect(() => {
    if (!enabled) return

    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault()
      reportViolation("copy_paste", "Copy action blocked", 2, { action: "copy" })
    }

    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault()
      const text = e.clipboardData?.getData("text") || ""
      reportViolation("copy_paste", "Paste action blocked", 2, {
        action: "paste",
        length: text.length,
      })
      if (text.length > BULK_PASTE_THRESHOLD) {
        addViolation("bulk_paste_detected", "Large paste payload detected")
        sendEvent(
          "bulk_paste_detected",
          {
            description: `Paste content exceeded ${BULK_PASTE_THRESHOLD} characters`,
            length: text.length,
            threshold: BULK_PASTE_THRESHOLD,
          },
          2
        )
        checkAndTrigger()
      }
    }

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      reportViolation("right_click", "Right-click is blocked", 1, { action: "contextmenu" })
    }

    document.addEventListener("copy", onCopy)
    document.addEventListener("paste", onPaste)
    document.addEventListener("contextmenu", onContextMenu)

    return () => {
      document.removeEventListener("copy", onCopy)
      document.removeEventListener("paste", onPaste)
      document.removeEventListener("contextmenu", onContextMenu)
    }
  }, [enabled, reportViolation, addViolation, sendEvent, checkAndTrigger])

  // ── Inactivity detection ──
  useEffect(() => {
    if (!enabled) return

    const resetInactivity = () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
      }
      inactivityTimerRef.current = setTimeout(() => {
        reportViolation("inactivity", "No activity detected", 1, {
          threshold_ms: INACTIVITY_MS,
        })
      }, INACTIVITY_MS)
    }

    const activityEvents: Array<keyof DocumentEventMap> = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
    ]

    activityEvents.forEach((evt) => document.addEventListener(evt, resetInactivity))
    resetInactivity()

    return () => {
      activityEvents.forEach((evt) => document.removeEventListener(evt, resetInactivity))
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
    }
  }, [enabled, reportViolation])

  // ── Devtools heuristic detection ──
  useEffect(() => {
    if (!enabled) return

    devtoolsTimerRef.current = setInterval(() => {
      const widthDiff = Math.abs(window.outerWidth - window.innerWidth)
      const heightDiff = Math.abs(window.outerHeight - window.innerHeight)
      const open = widthDiff > DEVTOOLS_THRESHOLD || heightDiff > DEVTOOLS_THRESHOLD
      const now = Date.now()

      if (open && !devtoolsWasOpenRef.current) {
        const last = lastDerivedRef.current.browser_devtools || 0
        if (now - last > DEVTOOLS_COOLDOWN_MS) {
          lastDerivedRef.current.browser_devtools = now
          reportViolation("browser_devtools", "Developer tools likely open", 2, {
            width_diff: widthDiff,
            height_diff: heightDiff,
          })
        }
      }

      devtoolsWasOpenRef.current = open
    }, DEVTOOLS_CHECK_MS)

    return () => {
      if (devtoolsTimerRef.current) {
        clearInterval(devtoolsTimerRef.current)
        devtoolsTimerRef.current = null
      }
    }
  }, [enabled, reportViolation])

  // ── Periodic snapshots ──
  useEffect(() => {
    if (!enabled) return

    periodicTimerRef.current = setInterval(async () => {
      const snapshot = await captureSnapshot()
      sendEvent(
        "periodic_check",
        { description: "Periodic monitoring checkpoint" },
        1,
        new Date().toISOString(),
        snapshot
      )
    }, PERIODIC_SNAPSHOT_MS)

    return () => {
      if (periodicTimerRef.current) {
        clearInterval(periodicTimerRef.current)
        periodicTimerRef.current = null
      }
    }
  }, [enabled, captureSnapshot, sendEvent])

  // ── Load ML models on exam start ─────────────────────────────────────────
  // The two models are tracked separately: COCO-SSD weights are fetched from
  // Google storage, so an object-model failure must not disable face detection.
  useEffect(() => {
    if (!enabled) return
    if (!ENABLE_FACE_ML && !ENABLE_OBJECT_DETECTION) return

    faceModelReadyRef.current = isFaceModelReady()
    objectModelReadyRef.current = isObjectModelReady()
    if (
      (faceModelReadyRef.current || !ENABLE_FACE_ML) &&
      (objectModelReadyRef.current || !ENABLE_OBJECT_DETECTION)
    ) {
      return
    }

    let cancelled = false
    loadMLModels().then((report) => {
      if (cancelled) return
      faceModelReadyRef.current = report.face
      objectModelReadyRef.current = report.object

      if (report.face) {
        console.log("[ProctoEase] ML face detection active")
      } else if (ENABLE_FACE_ML) {
        console.warn("[ProctoEase] ML face model unavailable — browser FaceDetector fallback active")
      }
      if (!report.object && ENABLE_OBJECT_DETECTION) {
        console.warn("[ProctoEase] Object detection unavailable — phone/object checks disabled")
      }
    })

    return () => {
      cancelled = true
    }
  }, [enabled])

  // ── ML Face + Gaze Detection ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return
    if (!ENABLE_FACE_ML) return

    mlFaceTimerRef.current = setInterval(async () => {
      if (!faceModelReadyRef.current && isFaceModelReady()) {
        faceModelReadyRef.current = true
      }
      if (!faceModelReadyRef.current || !isFaceModelReady()) return

      const ok = await ensureCaptureStream()
      if (!ok) return

      const video = captureVideoRef.current
      const hasStream = Boolean(captureStreamRef.current || video?.srcObject)
      if (!video || video.readyState !== 4 || video.videoWidth <= 0 || !hasStream) return

      const result = detectFacesAndGaze(video)
      if (result.faceCount === -1) return   // model not ready

      debugLog("[FACE DETECTION]", {
        source: "ML",
        faceCount: result.faceCount,
        timestamp: Date.now()
      })

      await processFacePresence("ML", result.faceCount)

      const now = Date.now()

      if (result.faceCount === 0 || result.faceCount >= 2) {
        gazeAwayStartRef.current  = null
        headTurnedStartRef.current = null
      }

      // ── Single face — check gaze ───────────────────────────────────────
      if (ENABLE_GAZE && result.faceCount === 1) {

        // HEAD TURNED (left/right)
        if (result.headTurned) {
          if (headTurnedStartRef.current === null) {
            headTurnedStartRef.current = now
          } else if (now - headTurnedStartRef.current >= GAZE_GRACE_MS) {
            const lastSnap = lastSnapshotByTypeRef.current["head_turned"] || 0
            if (now - lastSnap >= ML_SNAP_THROTTLE_MS) {
              const snapshot = await captureSnapshot()
              lastSnapshotByTypeRef.current["head_turned"] = now
              addViolation("head_turned", "Head turned away from screen")
              sendEvent(
                "head_turned",
                {
                  description: "Head turned away from screen",
                  duration_ms: now - headTurnedStartRef.current,
                  ml_detected: true,
                },
                2,
                new Date(now).toISOString(),
                snapshot
              )
              checkAndTrigger()
            }
            // Reset so it fires again after another grace period
            headTurnedStartRef.current = now + GAZE_GRACE_MS
          }
        } else {
          headTurnedStartRef.current = null
        }

        // GAZE AWAY (up/down)
        if (result.gazeAway) {
          if (gazeAwayStartRef.current === null) {
            gazeAwayStartRef.current = now
          } else if (now - gazeAwayStartRef.current >= GAZE_GRACE_MS) {
            const lastSnap = lastSnapshotByTypeRef.current["gaze_away"] || 0
            if (now - lastSnap >= ML_SNAP_THROTTLE_MS) {
              const snapshot = await captureSnapshot()
              lastSnapshotByTypeRef.current["gaze_away"] = now
              addViolation("gaze_away", "Candidate not looking at screen")
              sendEvent(
                "gaze_away",
                {
                  description: "Gaze directed away from screen",
                  duration_ms: now - gazeAwayStartRef.current,
                  ml_detected: true,
                },
                2,
                new Date(now).toISOString(),
                snapshot
              )
              checkAndTrigger()
            }
            gazeAwayStartRef.current = now + GAZE_GRACE_MS
          }
        } else {
          gazeAwayStartRef.current = null
        }
      }

    }, ML_FACE_SCAN_MS)

    return () => {
      if (mlFaceTimerRef.current) {
        clearInterval(mlFaceTimerRef.current)
        mlFaceTimerRef.current = null
      }
    }
  }, [enabled, ensureCaptureStream, addViolation, sendEvent, checkAndTrigger, captureSnapshot, processFacePresence])

  // ── Object Detection (phone / unauthorized items) ────────────────────────
  useEffect(() => {
    if (!enabled) return
    if (!ENABLE_OBJECT_DETECTION) return

    mlObjectTimerRef.current = setInterval(async () => {
      if (!objectModelReadyRef.current && isObjectModelReady()) {
        objectModelReadyRef.current = true
      }
      if (!objectModelReadyRef.current || !isObjectModelReady()) return

      const ok = await ensureCaptureStream()
      if (!ok) return

      const video = captureVideoRef.current
      const hasStream = Boolean(captureStreamRef.current || video?.srcObject)
      if (!video || video.readyState !== 4 || video.videoWidth <= 0 || !hasStream) return

      const result = await detectObjects(video)
      const now = Date.now()

      // Phone detected
      if (result.phoneDetected) {
        const lastSnap = lastSnapshotByTypeRef.current["phone_detected"] || 0
        if (now - lastSnap >= OBJECT_SNAP_THROTTLE_MS) {
          const snapshot = await captureSnapshot()
          lastSnapshotByTypeRef.current["phone_detected"] = now
          addViolation("phone_detected", "Mobile phone detected in camera view")
          sendEvent(
            "phone_detected",
            {
              description: "Mobile phone detected in camera view",
              detected_objects: result.detectedObjects,
              ml_detected: true,
            },
            3,
            new Date(now).toISOString(),
            snapshot
          )
          checkAndTrigger()
        }
      }

      // Other unauthorized object (only if no phone — avoid double-firing)
      if (result.unauthorizedObjectDetected && !result.phoneDetected) {
        const lastSnap = lastSnapshotByTypeRef.current["unauthorized_object"] || 0
        if (now - lastSnap >= OBJECT_SNAP_THROTTLE_MS) {
          const snapshot = await captureSnapshot()
          lastSnapshotByTypeRef.current["unauthorized_object"] = now
          addViolation(
            "unauthorized_object",
            `Unauthorized item: ${result.detectedObjects.join(", ")}`
          )
          sendEvent(
            "unauthorized_object",
            {
              description: "Unauthorized object detected in camera view",
              detected_objects: result.detectedObjects,
              ml_detected: true,
            },
            2,
            new Date(now).toISOString(),
            snapshot
          )
          checkAndTrigger()
        }
      }

    }, ML_OBJECT_SCAN_MS)

    return () => {
      if (mlObjectTimerRef.current) {
        clearInterval(mlObjectTimerRef.current)
        mlObjectTimerRef.current = null
      }
    }
  }, [enabled, ensureCaptureStream, captureSnapshot, addViolation, sendEvent, checkAndTrigger])

  // ── Basic face consistency check (FaceDetector API when available) ──
  //
  // This is a FALLBACK for the MediaPipe path, not a second opinion. Both
  // paths call processFacePresence(), which writes the same persistence and
  // cooldown refs (noFaceStartRef, multiFaceStartRef, faceViolationLastFiredRef).
  // Running them together lets the 500ms ML tick clear a timer the 2000ms
  // fallback tick had just started, so whenever the two disagree the
  // fallback's persistence window never accumulates and real no_face /
  // multiple_faces events are delayed or dropped.
  //
  // The mutual exclusion was always the intent — the loader logs "browser
  // FaceDetector fallback active" only on ML failure — but it was never
  // enforced. It is enforced here, inside the tick rather than in the effect
  // deps, so the handover happens as soon as the async model load resolves.
  useEffect(() => {
    if (!enabled) return
    if (!ENABLE_FACE_DETECTOR_FALLBACK) return

    faceTimerRef.current = setInterval(async () => {
      // Yield to MediaPipe whenever it is usable.
      if (faceModelReadyRef.current || isFaceModelReady()) return

      const detectorCtor = (window as unknown as { FaceDetector?: new () => { detect: (input: CanvasImageSource) => Promise<Array<unknown>> } }).FaceDetector
      if (!detectorCtor) return

      const ok = await ensureCaptureStream()
      if (!ok) return

      const video = captureVideoRef.current
      const hasStream = Boolean(captureStreamRef.current || video?.srcObject)
      if (!video || video.readyState !== 4 || video.videoWidth <= 0 || !hasStream) return

      try {
        const detector = new detectorCtor()
        const faces = await detector.detect(video)
        const count = faces.length

        debugLog("[FACE DETECTION]", {
          source: "Fallback",
          faceCount: count,
          timestamp: Date.now()
        })

        await processFacePresence("Fallback", count)

        const prev = lastFaceCountRef.current
        lastFaceCountRef.current = count

        const now = Date.now()

        if (prev === 1 && (count === 0 || count >= 2)) {
          addViolation("face_inconsistency", "Face consistency changed abruptly")
          sendEvent(
            "face_inconsistency",
            {
              description: "Face consistency changed abruptly",
              previous_face_count: prev,
              current_face_count: count,
            },
            2,
            new Date(now).toISOString()
          )
          checkAndTrigger()
        }
      } catch {
        // FaceDetector may fail on some devices/browsers; keep proctoring non-blocking.
      }
    }, FACE_SCAN_MS)

    return () => {
      if (faceTimerRef.current) {
        clearInterval(faceTimerRef.current)
        faceTimerRef.current = null
      }
    }
  }, [enabled, ensureCaptureStream, addViolation, sendEvent, checkAndTrigger, processFacePresence])

  // ── Sustained voice / audio activity detection (microphone level) ─────────
  //
  // Energy-only: no speech-to-text, no recording, nothing leaves the browser.
  // This detects sustained audio ACTIVITY relative to the measured room noise
  // floor — it cannot tell a voice from any other sustained sound of similar
  // loudness. Events go through the same reportViolation() path as every other
  // detector, so `audio_anomaly` reaches the canonical catalog, the risk
  // weighting and the WebSocket persistence pipeline with no separate mechanism.
  //
  // Deps are [enabled] only, deliberately: getUserMedia must run exactly once
  // per exam. reportViolation is read through a ref for that reason.
  useEffect(() => {
    if (!enabled) return
    if (!ENABLE_AUDIO_DETECTION) return

    let cancelled = false

    void startAudioMonitor({
      onAnomaly: (details) => {
        // Marks the hand-off from the detector into the shared violation
        // pipeline. If an ANOMALY FIRED line appears without this one, the hook
        // dropped it; if `audio_anomaly` shows in the UI without either line,
        // something else emitted that type.
        if (ENABLE_AUDIO_DEBUG) {
          console.log(
            `[AUDIO DEBUG] -> reportViolation("audio_anomaly")` +
              ` peak=${details.peakLevel.toFixed(4)}` +
              ` voicedMs=${details.durationMs}` +
              ` activityRatio=${details.activityRatio.toFixed(2)} timestamp=${Date.now()}`
          )
        }
        reportViolationRef.current(
          "audio_anomaly",
          "Sustained voice or background audio activity detected",
          2,
          {
            peak_level: Number(details.peakLevel.toFixed(4)),
            average_level: Number(details.averageLevel.toFixed(4)),
            activity_ratio: Number(details.activityRatio.toFixed(2)),
            duration_ms: details.durationMs,
            segment_ms: details.segmentMs,
            noise_floor: Number(details.noiseFloor.toFixed(5)),
            enter_threshold: Number(details.threshold.toFixed(4)),
            exit_threshold: Number(details.exitThreshold.toFixed(4)),
            sustained_ms: AUDIO_SUSTAINED_MS,
            cooldown_ms: AUDIO_COOLDOWN_MS,
          }
        )
      },
    }).then((result) => {
      // The effect may have been cleaned up while getUserMedia was pending.
      if (cancelled) {
        if (result.ok) result.handle.stop()
        return
      }
      if (result.ok) {
        audioMonitorRef.current = result.handle
        console.log("[ProctoEase] Audio monitoring active")
      } else {
        // Denied or unavailable microphone is non-fatal: every other detector
        // keeps running and the exam is unaffected.
        console.warn(
          `[ProctoEase] Audio monitoring unavailable (${result.reason}) — audio_anomaly disabled`
        )
      }
    })

    return () => {
      cancelled = true
      audioMonitorRef.current?.stop()
      audioMonitorRef.current = null
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void ensureCaptureStream()

    return () => {
      stopCamera()
    }
  }, [enabled, ensureCaptureStream, stopCamera])

  return {
    reportViolation,
    requestFullscreen,
    stopCamera,
  }
}
