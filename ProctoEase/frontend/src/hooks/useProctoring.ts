import { useEffect, useCallback, useRef } from "react"
import { useProctoringStore } from "@/stores/proctoring.store"
import { API_BASE_URL } from "@/lib/constants"
import {
  loadMLModels,
  detectFacesAndGaze,
  detectObjects,
  areModelsLoaded,
} from "@/lib/ml-detection"

interface UseProctoringOptions {
  enabled: boolean
  examId?: string
  attemptId?: string
  onMaxViolations: () => void
}

type CanonicalViolationType =
  | "tab_switch"
  | "fullscreen_exit"
  | "keyboard_block"
  | "copy_paste"
  | "right_click"
  | "browser_devtools"
  | "inactivity"
  | "multiple_faces"
  | "no_face"
  | "audio_anomaly"
  | "custom"
  | "rapid_tab_switching"
  | "suspicious_activity_burst"
  | "bulk_paste_detected"
  | "impossible_answer_speed"
  | "periodic_check"
  | "face_inconsistency"
  | "gaze_away"
  | "head_turned"
  | "phone_detected"
  | "unauthorized_object"

const DERIVED_TYPES = new Set<CanonicalViolationType>([
  "rapid_tab_switching",
  "suspicious_activity_burst",
  "bulk_paste_detected",
  "impossible_answer_speed",
])

const INACTIVITY_MS = 90_000
const DEVTOOLS_CHECK_MS = 2_000
const DEVTOOLS_THRESHOLD = 160
const SNAPSHOT_THROTTLE_MS = 7_000
const PERIODIC_SNAPSHOT_MS = 75_000
const FACE_SCAN_MS = 2_000
const ML_FACE_SCAN_MS   = 500     // ML face+gaze check every 500ms
const ML_OBJECT_SCAN_MS = 10_000  // Object detection every 10 seconds
const GAZE_GRACE_MS     = 3_000   // Sustained gaze needed before event fires
const ML_SNAP_THROTTLE_MS = 8_000 // Separate throttle for ML snapshot events
const NO_FACE_PERSIST_MS = 2_000
const MULTI_FACE_PERSIST_MS = 1_500
const FACE_VIOLATION_COOLDOWN_MS = 4_000
const LIVE_WEBCAM_SELECTOR = 'video[data-proctoring-webcam="true"]'
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
  const { addViolation, setFullscreen, setIsFullscreenArmed, isMaxViolations } = useProctoringStore()
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
  const mlModelsReadyRef  = useRef<boolean>(false)
  const captureVideoRef = useRef<HTMLVideoElement | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const captureStreamRef = useRef<MediaStream | null>(null)

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
        video: { width: 320, height: 240, facingMode: "user" },
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

    console.log("Capture attempt - readyState:", video.readyState, "videoWidth:", video.videoWidth)
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      console.warn("captureSnapshot: video not ready", video.readyState, video.videoWidth)
      return undefined
    }

    const width = video.videoWidth
    const height = video.videoHeight
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext("2d")
    if (!ctx) return undefined

    ctx.drawImage(video, 0, 0, width, height)
    return canvas.toDataURL("image/jpeg", 0.7)
  }, [ensureCaptureStream])

  const checkAndTrigger = useCallback(() => {
    if (isMaxViolations()) {
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
        console.warn("[WS QUEUE] Event queued", { eventType })
        console.warn("[WS ERROR] Event not sent", { eventType })
      }
    },
    []
  )

  const getSmoothedFaceCount = useCallback((source: "ML" | "Fallback", rawFaceCount: number) => {
    const historyRef = source === "ML" ? mlFaceCountHistoryRef : fallbackFaceCountHistoryRef
    historyRef.current.push(rawFaceCount)
    if (historyRef.current.length > 3) {
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
      console.warn("[SNAPSHOT] fallback triggered")
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
          console.log("[VIOLATION TRIGGERED]", {
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
          console.log("[VIOLATION TRIGGERED]", {
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
      const tabEvents = recent.filter((e) => e.type === "tab_switch" && eventTs - e.ts <= 10_000)
      if (tabEvents.length > 3) {
        const last = lastDerivedRef.current.rapid_tab_switching || 0
        if (eventTs - last >= 10_000) {
          lastDerivedRef.current.rapid_tab_switching = eventTs
          addViolation("rapid_tab_switching", "Rapid tab switching pattern detected")
          sendEvent(
            "rapid_tab_switching",
            {
              description: "More than 3 tab switches within 10 seconds",
              count: tabEvents.length,
              window_ms: 10000,
            },
            2,
            new Date(eventTs).toISOString()
          )
        }
      }

      const burstEvents = recent.filter((e) => eventTs - e.ts <= 30_000)
      if (burstEvents.length > 5) {
        const last = lastDerivedRef.current.suspicious_activity_burst || 0
        if (eventTs - last >= 15_000) {
          lastDerivedRef.current.suspicious_activity_burst = eventTs
          addViolation("suspicious_activity_burst", "Suspicious burst of violations detected")
          sendEvent(
            "suspicious_activity_burst",
            {
              description: "More than 5 violations within 30 seconds",
              count: burstEvents.length,
              window_ms: 30000,
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
        (e) => eventTs - e.ts <= 30_000
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

      // Start heartbeat every 30s
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "heartbeat" }))
        }
      }, 30_000)
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
      // Deduplicate with visibilitychange — skip if fired within 500ms
      if (Date.now() - lastTabViolationRef.current < 500) return

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
      if (text.length > 50) {
        addViolation("bulk_paste_detected", "Large paste payload detected")
        sendEvent(
          "bulk_paste_detected",
          {
            description: "Paste content exceeded 50 characters",
            length: text.length,
            threshold: 50,
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
        if (now - last > 15_000) {
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
  useEffect(() => {
    if (!enabled) return
    if (areModelsLoaded()) {
      mlModelsReadyRef.current = true
      console.log("[ProctoEase] ML face detection active")
      return
    }
    loadMLModels().then((success) => {
      mlModelsReadyRef.current = success || areModelsLoaded()
      if (success) {
        console.log("[ProctoEase] ML face detection active")
      } else {
        console.warn("[ProctoEase] ML load failed — browser FaceDetector fallback active")
      }
    })
  }, [enabled])

  // ── ML Face + Gaze Detection ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return

    mlFaceTimerRef.current = setInterval(async () => {
      if (!mlModelsReadyRef.current && areModelsLoaded()) {
        mlModelsReadyRef.current = true
      }
      if (!mlModelsReadyRef.current || !areModelsLoaded()) return

      const ok = await ensureCaptureStream()
      if (!ok) return

      const video = captureVideoRef.current
      const hasStream = Boolean(captureStreamRef.current || video?.srcObject)
      if (!video || video.readyState !== 4 || video.videoWidth <= 0 || !hasStream) return

      const result = detectFacesAndGaze(video)
      if (result.faceCount === -1) return   // models not ready

      console.log("[FACE DETECTION]", {
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
      if (result.faceCount === 1) {

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

    mlObjectTimerRef.current = setInterval(async () => {
      if (!mlModelsReadyRef.current && areModelsLoaded()) {
        mlModelsReadyRef.current = true
      }
      if (!mlModelsReadyRef.current || !areModelsLoaded()) return

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
        if (now - lastSnap >= ML_SNAP_THROTTLE_MS * 2) {
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
        if (now - lastSnap >= ML_SNAP_THROTTLE_MS * 2) {
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
  useEffect(() => {
    if (!enabled) return

    faceTimerRef.current = setInterval(async () => {
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

        console.log("[FACE DETECTION]", {
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
