import { useProctoringStore } from "@/stores/proctoring.store"
import { motion, AnimatePresence } from "framer-motion"
import { Maximize2, AlertTriangle } from "lucide-react"

export default function FullscreenWarning() {
  const isFullscreen = useProctoringStore((s) => s.isFullscreen)

  const requestFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  return (
    <AnimatePresence>
      {!isFullscreen && (
        <motion.div
          key="fullscreen-warning"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
          style={{
            background: "rgba(10, 10, 18, 0.93)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {/* Pulsing border */}
          <motion.div
            animate={{ boxShadow: ["0 0 0 0px rgba(239,68,68,0.3)", "0 0 0 18px rgba(239,68,68,0)"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            className="absolute inset-4 rounded-2xl border border-red-500/40 pointer-events-none"
          />

          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 22 }}
            className="flex flex-col items-center gap-6 text-center max-w-sm px-6"
          >
            {/* Icon */}
            <div className="h-16 w-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-red-400" strokeWidth={1.5} />
            </div>

            <div>
              <h2 className="text-xl font-bold text-white mb-2">Fullscreen required</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Exiting fullscreen is a proctoring violation. Return to fullscreen to continue the exam.
              </p>
            </div>

            <button
              onClick={requestFullscreen}
              className="flex items-center gap-2.5 px-7 py-3 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] text-white font-semibold text-sm transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_24px_-8px_rgba(99,102,241,0.55)] active:scale-[0.98]"
            >
              <Maximize2 className="h-4 w-4" strokeWidth={2} />
              Return to fullscreen
            </button>

            <p className="text-xs text-slate-600">
              This violation has been recorded.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
