import { useEffect, useRef, useCallback, useState } from "react"
import { motion } from "framer-motion"
import { useProctoringStore } from "@/stores/proctoring.store"
import { CameraOff } from "lucide-react"
import { areModelsLoaded } from "@/lib/ml-detection"

interface WebcamMonitorProps {
  enabled: boolean
}

export default function WebcamMonitor({ enabled }: WebcamMonitorProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const { webcamActive, setWebcamActive } = useProctoringStore()
  const [mlReady, setMlReady] = useState(false)

  const startWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setWebcamActive(true)
    } catch {
      setWebcamActive(false)
    }
  }, [setWebcamActive])

  const stopWebcam = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setWebcamActive(false)
  }, [setWebcamActive])

  useEffect(() => {
    if (enabled) {
      startWebcam()
    }
    return () => stopWebcam()
  }, [enabled, startWebcam, stopWebcam])

  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const check = setInterval(() => {
      if (areModelsLoaded()) {
        setMlReady(true)
        clearInterval(check)
      }
    }, 1000)
    return () => clearInterval(check)
  }, [enabled])

  if (!enabled) return null

  if (!webcamActive) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-[#161b27] aspect-[4/3] flex flex-col items-center justify-center gap-2">
        <CameraOff className="h-6 w-6 text-slate-600" strokeWidth={1.5} />
        <p className="text-[11px] text-slate-600">Camera unavailable</p>
      </div>
    )
  }

  return (
    <div className="relative rounded-xl overflow-hidden border border-white/[0.07] bg-black">
      {/* Pulsing ring when active */}
      <motion.div
        className="absolute inset-0 rounded-xl pointer-events-none z-10"
        animate={{
          boxShadow: [
            "inset 0 0 0 1.5px rgba(99,102,241,0.35)",
            "inset 0 0 0 1.5px rgba(99,102,241,0.65)",
            "inset 0 0 0 1.5px rgba(99,102,241,0.35)",
          ],
        }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />

      <video
        ref={videoRef}
        data-proctoring-webcam="true"
        autoPlay
        muted
        playsInline
        className="w-full h-auto block"
        style={{ transform: "scaleX(-1)" }}
      />

      {/* LIVE badge */}
      <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 bg-black/70 px-2 py-1 rounded-md backdrop-blur-sm">
        <motion.span
          className="h-1.5 w-1.5 rounded-full bg-red-500 block"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
        <span className="text-[9px] font-bold tracking-widest text-white uppercase">Live</span>
      </div>

      {/* PROCTORED label */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        <p className="text-[9px] font-semibold tracking-[0.15em] text-slate-400 uppercase text-center">
          Proctored
        </p>
      </div>

      {/* AI Status indicator */}
      <div className="absolute bottom-6 left-0 right-0 z-30 flex justify-center">
        {!mlReady ? (
          <div className="flex items-center gap-1.5 bg-black/80 px-2 py-1 rounded-md">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[9px] font-semibold text-amber-400 tracking-wider">
              AI loading...
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-black/80 px-2 py-1 rounded-md">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-[9px] font-semibold text-emerald-400 tracking-wider">
              AI active
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
