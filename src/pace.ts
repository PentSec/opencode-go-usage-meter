/**
 * Pace indicator: compare used percentage against the share of the window that
 * has already elapsed.
 *
 * Rolling is exactly 5 hours and weekly is exactly 7 days. Monthly follows the
 * subscription anniversary, so its length is one UTC calendar month (28 to 31
 * days). The monthly start is the reset timestamp minus one UTC calendar month,
 * with the day clamped to the last valid day of the previous month. Only UTC
 * fields are used, so local time and daylight saving transitions do not shift
 * the result.
 *
 * Positive values mean a reserve (used less than the elapsed share), negative
 * values mean a deficit (used more). Every elapsed second counts, including
 * Saturdays and Sundays.
 */
import type { UsageWindowKind } from "./usage.ts"

/** Percentage points either way before the indicator leaves "on pace". */
export const PACE_TOLERANCE = 5

const ROLLING_WINDOW_MS = 5 * 3_600_000
const WEEKLY_WINDOW_MS = 7 * 86_400_000

export type Pace =
  | { kind: "reserve"; delta: number }
  | { kind: "deficit"; delta: number }
  | { kind: "on-pace" }

type PaceInput = {
  /** Used percentage reported by the API. */
  usedPercent: number
  /** ISO timestamp of the window reset. */
  resetsAt: string | undefined
  /** Length policy of the window: fixed 5h, fixed 7d, or one UTC calendar month. */
  windowKind: UsageWindowKind
  /** Current time in epoch milliseconds. */
  now: number
}

/**
 * Start of the monthly window, one UTC calendar month before `resetsMs`.
 *
 * The day is clamped to the last valid day of that month, so 31 March starts on
 * 28 February (29 February in a leap year) and 31 May starts on 30 April. Hours,
 * minutes, seconds and milliseconds are preserved.
 */
function monthlyStartMs(resetsMs: number): number {
  const resets = new Date(resetsMs)
  const year = resets.getUTCFullYear()
  const month = resets.getUTCMonth()
  const day = resets.getUTCDate()
  const lastDayOfPreviousMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  const start = new Date(resetsMs)
  // Move through the first of the month so the current day cannot overflow.
  start.setUTCDate(1)
  start.setUTCMonth(month - 1)
  start.setUTCDate(Math.min(day, lastDayOfPreviousMonth))

  return start.getTime()
}

/** Start of the window that ends at `resetsMs`, in epoch milliseconds. */
function windowStartMs(resetsMs: number, kind: UsageWindowKind): number {
  if (kind === "rolling") return resetsMs - ROLLING_WINDOW_MS
  if (kind === "weekly") return resetsMs - WEEKLY_WINDOW_MS

  return monthlyStartMs(resetsMs)
}

/** Length of the window that ends at `resetsMs`, in milliseconds. */
function windowMsOf(resetsMs: number, kind: UsageWindowKind): number {
  return resetsMs - windowStartMs(resetsMs, kind)
}

/** Expected share of the budget already spent at `now`, in percent. */
export function expectedPercent(input: Omit<PaceInput, "usedPercent">): number | undefined {
  if (input.resetsAt === undefined) return undefined

  const resets = Date.parse(input.resetsAt)
  if (!Number.isFinite(resets)) return undefined

  const windowMs = windowMsOf(resets, input.windowKind)
  if (!(windowMs > 0)) return undefined

  const start = resets - windowMs
  const elapsed = Math.min(windowMs, Math.max(0, input.now - start))

  return (elapsed / windowMs) * 100
}

export function paceOf(input: PaceInput): Pace | undefined {
  const expected = expectedPercent(input)
  if (expected === undefined) return undefined

  const delta = input.usedPercent - expected
  // Round the magnitude, not the signed value: -5.5 and +5.5 must both leave
  // the on-pace band with an absolute deviation of 6 points.
  const magnitude = Math.round(Math.abs(delta))

  if (magnitude <= PACE_TOLERANCE) return { kind: "on-pace" }

  return delta < 0 ? { kind: "reserve", delta: magnitude } : { kind: "deficit", delta: magnitude }
}

/** Fixed-width label: `+12pp`, `-3pp`, `on pace`. */
export function formatPace(pace: Pace | undefined): string {
  if (pace === undefined) return ""
  if (pace.kind === "on-pace") return "on pace"

  return `${pace.kind === "reserve" ? "+" : "-"}${pace.delta}pp`
}
