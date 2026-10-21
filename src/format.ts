import { clampPercent } from "./usage.ts"

/** Width of the drawing area in characters. */
export const BAR_WIDTH = 16

const FILLED = "\u2501" // ━
const EMPTY = "\u2500" // ─

export type Bar = { filled: string; empty: string }

/** Build a bar of `width` characters filled according to `percent`. */
export function bar(percent: number, width: number = BAR_WIDTH): Bar {
  const clamped = clampPercent(percent)
  const safeWidth = Math.max(1, Math.floor(width))
  const filled = Math.round((clamped / 100) * safeWidth)

  return {
    filled: FILLED.repeat(filled),
    empty: EMPTY.repeat(safeWidth - filled),
  }
}

export type Severity = "ok" | "warn" | "danger"

/** Map a percentage onto a severity bucket. */
export function severity(percent: number): Severity {
  const clamped = clampPercent(percent)
  if (clamped >= 90) return "danger"
  if (clamped >= 75) return "warn"
  return "ok"
}

/** Human-readable time until `iso`, relative to `now` (epoch ms). */
export function remaining(iso: string | undefined, now: number): string {
  if (!iso) return "\u2014"

  const target = new Date(iso).getTime()
  if (!Number.isFinite(target)) return "\u2014"

  const ms = target - now
  if (ms <= 0) return "now"

  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m`
  return "<1m"
}
