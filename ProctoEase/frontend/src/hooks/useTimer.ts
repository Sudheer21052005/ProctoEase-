import { useEffect, useRef, useState, useCallback } from "react"

interface UseTimerOptions {
  totalSeconds: number
  onTimeUp: () => void
}

export function useTimer({ totalSeconds, onTimeUp }: UseTimerOptions) {
  const [remaining, setRemaining] = useState(totalSeconds)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onTimeUpRef = useRef(onTimeUp)
  onTimeUpRef.current = onTimeUp

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          onTimeUpRef.current()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  const isWarning = remaining <= 300 // 5 min
  const isUrgent = remaining <= 60 // 1 min
  const progress = ((totalSeconds - remaining) / totalSeconds) * 100

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [])

  return { remaining, formatted, isWarning, isUrgent, progress, stop }
}
