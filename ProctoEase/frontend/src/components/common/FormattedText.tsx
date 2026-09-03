import React from "react"

interface FormattedTextProps {
  text: string
  className?: string
}

/**
 * Lightweight text formatter for problem statements and instructions.
 * Renders markdown-style headers (###), bold (**text**), inline code (`code`),
 * bullets (- ), and preserves paragraphs without adding external dependencies.
 */
export default function FormattedText({ text, className = "" }: FormattedTextProps) {
  if (!text) return null

  // Split lines
  const lines = text.split("\n")

  const renderInline = (line: string): React.ReactNode[] => {
    // Regex matches inline code `...` or bold **...**
    const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    return parts.map((part, i) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return (
          <code
            key={i}
            className="px-1.5 py-0.5 rounded bg-white/[0.08] text-primary text-xs font-mono border border-white/[0.06]"
          >
            {part.slice(1, -1)}
          </code>
        )
      }
      if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
        return (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        )
      }
      return <React.Fragment key={i}>{part}</React.Fragment>
    })
  }

  const elements: React.ReactNode[] = []
  let buffer: string[] = []

  const flushParagraph = (idx: number) => {
    if (buffer.length === 0) return
    const content = buffer.join(" ").trim()
    buffer = []
    if (!content) return
    elements.push(
      <p key={`p-${idx}`} className="text-sm leading-relaxed text-slate-300 mb-3">
        {renderInline(content)}
      </p>
    )
  }

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim()

    // Header 3 or 2
    if (trimmed.startsWith("### ") || trimmed.startsWith("## ")) {
      flushParagraph(idx)
      const headerTitle = trimmed.replace(/^#{2,3}\s+/, "")
      elements.push(
        <h4
          key={`h-${idx}`}
          className="text-xs font-bold text-slate-200 uppercase tracking-wider mt-5 mb-2 border-b border-white/[0.06] pb-1"
        >
          {headerTitle}
        </h4>
      )
      return
    }

    // Bullet point
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      flushParagraph(idx)
      elements.push(
        <div key={`li-${idx}`} className="flex items-start gap-2 text-sm text-slate-300 ml-2 mb-1.5">
          <span className="text-primary font-bold mt-0.5">•</span>
          <div>{renderInline(trimmed.slice(2))}</div>
        </div>
      )
      return
    }

    // Empty line separates paragraphs
    if (!trimmed) {
      flushParagraph(idx)
      return
    }

    // Regular line accumulator
    buffer.push(trimmed)
  })

  flushParagraph(lines.length)

  return <div className={`space-y-1 ${className}`}>{elements}</div>
}
