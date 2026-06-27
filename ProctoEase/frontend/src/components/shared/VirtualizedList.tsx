import { useMemo, useState, type ReactNode } from "react"

interface VirtualizedListProps<T> {
  items: T[]
  height: number
  rowHeight: number
  overscan?: number
  renderRow: (item: T, index: number) => ReactNode
}

export default function VirtualizedList<T>({
  items,
  height,
  rowHeight,
  overscan = 6,
  renderRow,
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0)

  const totalHeight = items.length * rowHeight
  const visibleCount = Math.ceil(height / rowHeight)

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const firstVisible = Math.floor(scrollTop / rowHeight)
    const start = Math.max(0, firstVisible - overscan)
    const end = Math.min(items.length, firstVisible + visibleCount + overscan)
    return {
      startIndex: start,
      endIndex: end,
      offsetY: start * rowHeight,
    }
  }, [scrollTop, rowHeight, visibleCount, overscan, items.length])

  const windowed = items.slice(startIndex, endIndex)

  return (
    <div
      style={{ height }}
      className="overflow-auto"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {windowed.map((item, i) => renderRow(item, startIndex + i))}
        </div>
      </div>
    </div>
  )
}
