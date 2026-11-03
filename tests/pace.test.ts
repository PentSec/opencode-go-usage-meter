import { describe, expect, test } from "bun:test"

import { expectedPercent, formatPace, paceOf, PACE_TOLERANCE } from "../src/pace.ts"
import type { UsageWindowKind } from "../src/usage.ts"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** Saturday 2026-10-31T00:00:00Z. */
const WEEKEND_START = Date.parse("2026-10-31T00:00:00Z")

function windowInput(windowKind: UsageWindowKind, startMs: number, lengthMs: number) {
  return { windowKind, resetsAt: new Date(startMs + lengthMs).toISOString() }
}

describe("calendar expected share", () => {
  test("advances linearly for rolling, weekly and monthly windows", () => {
    const windows = [
      { windowKind: "rolling" as const, start: Date.parse("2026-11-15T13:12:24.000Z"), length: 5 * HOUR_MS },
      { windowKind: "weekly" as const, start: Date.parse("2026-11-08T18:12:24.000Z"), length: 7 * DAY_MS },
      { windowKind: "monthly" as const, start: Date.parse("2026-10-15T18:12:24.000Z"), length: 31 * DAY_MS },
    ]

    for (const window of windows) {
      const input = windowInput(window.windowKind, window.start, window.length)

      expect(expectedPercent({ ...input, now: window.start })).toBe(0)
      expect(expectedPercent({ ...input, now: window.start + window.length / 4 })).toBeCloseTo(25, 10)
      expect(expectedPercent({ ...input, now: window.start + window.length / 2 })).toBeCloseTo(50, 10)
      expect(expectedPercent({ ...input, now: window.start + window.length })).toBe(100)
    }
  })

  test("uses a real UTC calendar month of 28, 29, 30 or 31 days", () => {
    const months = [
      { name: "31-day January", resetsAt: "2026-02-15T18:12:24.000Z", start: "2026-01-15T18:12:24.000Z", days: 31 },
      { name: "28-day February", resetsAt: "2026-03-15T18:12:24.000Z", start: "2026-02-15T18:12:24.000Z", days: 28 },
      { name: "29-day February", resetsAt: "2028-03-15T18:12:24.000Z", start: "2028-02-15T18:12:24.000Z", days: 29 },
      { name: "30-day April", resetsAt: "2026-05-15T18:12:24.000Z", start: "2026-04-15T18:12:24.000Z", days: 30 },
    ]

    for (const month of months) {
      const start = Date.parse(month.start)
      const resets = Date.parse(month.resetsAt)
      expect(resets - start, month.name).toBe(month.days * DAY_MS)

      expect(expectedPercent({ windowKind: "monthly", resetsAt: month.resetsAt, now: start })).toBe(0)
      expect(
        expectedPercent({ windowKind: "monthly", resetsAt: month.resetsAt, now: start + (resets - start) / 2 }),
        month.name,
      ).toBeCloseTo(50, 10)
      expect(expectedPercent({ windowKind: "monthly", resetsAt: month.resetsAt, now: resets })).toBe(100)
    }
  })

  test("clamps the start day to the last valid day of the previous month", () => {
    const cases = [
      { resetsAt: "2026-03-31T18:12:24.000Z", start: "2026-02-28T18:12:24.000Z" },
      { resetsAt: "2028-03-31T18:12:24.000Z", start: "2028-02-29T18:12:24.000Z" },
      { resetsAt: "2026-03-30T18:12:24.000Z", start: "2026-02-28T18:12:24.000Z" },
      { resetsAt: "2026-03-29T18:12:24.000Z", start: "2026-02-28T18:12:24.000Z" },
      { resetsAt: "2026-05-31T18:12:24.000Z", start: "2026-04-30T18:12:24.000Z" },
      { resetsAt: "2026-01-31T18:12:24.000Z", start: "2025-12-31T18:12:24.000Z" },
    ]

    for (const entry of cases) {
      const start = Date.parse(entry.start)
      const resets = Date.parse(entry.resetsAt)
      expect(expectedPercent({ windowKind: "monthly", resetsAt: entry.resetsAt, now: start }), entry.resetsAt).toBe(0)
      expect(
        expectedPercent({ windowKind: "monthly", resetsAt: entry.resetsAt, now: start + (resets - start) / 2 }),
        entry.resetsAt,
      ).toBeCloseTo(50, 10)
    }
  })

  test("crosses the year boundary and preserves the reset UTC time", () => {
    const resetsAt = "2026-01-15T18:12:24.500Z"
    const start = Date.parse("2025-12-15T18:12:24.500Z")
    const resets = Date.parse(resetsAt)

    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: start })).toBe(0)
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: start + (resets - start) / 2 })).toBeCloseTo(50, 10)
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: resets })).toBe(100)
  })

  test("preserves reset milliseconds instead of truncating to seconds", () => {
    const resetsAt = "2026-11-15T18:12:24.789Z"
    const start = Date.parse("2026-10-15T18:12:24.789Z")
    const resets = Date.parse(resetsAt)

    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: start })).toBe(0)
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: start + (resets - start) / 2 })).toBeCloseTo(50, 10)
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: resets - 1 })).toBeCloseTo(100, 6)
  })

  test("does not depend on local time or daylight saving transitions", () => {
    // This window crosses the US spring DST switch on 2026-03-08. A local-time
    // implementation would shift the start by an hour and miss the exact values.
    const resetsAt = "2026-03-15T18:12:24.000Z"
    const start = Date.parse("2026-02-15T18:12:24.000Z")
    const resets = Date.parse(resetsAt)

    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: start })).toBe(0)
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: start + (resets - start) / 2 })).toBeCloseTo(50, 10)
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: resets })).toBe(100)
  })

  test("counts Saturdays and Sundays as elapsed time", () => {
    // A 7d window starts on Saturday. One day later, Sunday has already used 1/7 of the budget.
    const resetsAt = new Date(WEEKEND_START + 7 * DAY_MS).toISOString()
    expect(
      expectedPercent({
        windowKind: "weekly",
        resetsAt,
        now: WEEKEND_START + DAY_MS,
      }),
    ).toBeCloseTo(100 / 7, 10)

    // A 5h window that starts on Friday night and ends on Saturday has no weekend pause.
    const friday = Date.parse("2026-10-30T22:00:00Z")
    expect(
      expectedPercent({
        windowKind: "rolling",
        resetsAt: new Date(friday + 5 * HOUR_MS).toISOString(),
        now: friday + 3 * HOUR_MS,
      }),
    ).toBeCloseTo(60, 10)
  })

  test("clamps the elapsed share to the window boundaries", () => {
    const start = Date.parse("2026-10-01T00:00:00Z")
    const resetsAt = new Date(start + 5 * HOUR_MS).toISOString()

    expect(expectedPercent({ windowKind: "rolling", resetsAt, now: start - HOUR_MS })).toBe(0)
    expect(expectedPercent({ windowKind: "rolling", resetsAt, now: start + 4 * HOUR_MS })).toBeCloseTo(80, 10)
    expect(expectedPercent({ windowKind: "rolling", resetsAt, now: start + 5 * HOUR_MS })).toBe(100)
    expect(expectedPercent({ windowKind: "rolling", resetsAt, now: start + 6 * HOUR_MS })).toBe(100)
  })

  test("omits the share when the reset is missing or invalid", () => {
    const input = { windowKind: "rolling" as const, now: WEEKEND_START }

    expect(expectedPercent({ ...input, resetsAt: undefined })).toBeUndefined()
    expect(expectedPercent({ ...input, resetsAt: "" })).toBeUndefined()
    expect(expectedPercent({ ...input, resetsAt: "not-a-date" })).toBeUndefined()
    expect(
      expectedPercent({ windowKind: "monthly", resetsAt: "not-a-date", now: WEEKEND_START }),
    ).toBeUndefined()
  })
})

describe("monthly pace alignment", () => {
  // 2026-10-15T18:12:24Z to 2026-11-15T18:12:24Z is a 31-day calendar month.
  const resetsAt = "2026-11-15T18:12:24.000Z"
  const start = Date.parse("2026-10-15T18:12:24.000Z")
  const resets = Date.parse(resetsAt)
  const midpoint = start + (resets - start) / 2

  test("measures the expected share from the derived calendar start", () => {
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: midpoint })).toBeCloseTo(50, 10)

    expect(paceOf({ windowKind: "monthly", resetsAt, now: midpoint, usedPercent: 50 })).toEqual({ kind: "on-pace" })
    expect(paceOf({ windowKind: "monthly", resetsAt, now: midpoint, usedPercent: 44.5 })).toEqual({
      kind: "reserve",
      delta: 6,
    })
    expect(paceOf({ windowKind: "monthly", resetsAt, now: midpoint, usedPercent: 55.5 })).toEqual({
      kind: "deficit",
      delta: 6,
    })
  })

  test("handles the boundaries before and after the derived start", () => {
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: start - 1 })).toBe(0)
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: start })).toBe(0)
    expect(expectedPercent({ windowKind: "monthly", resetsAt, now: resets + 1 })).toBe(100)
    expect(paceOf({ windowKind: "monthly", resetsAt, now: start - 1, usedPercent: 0 })).toEqual({ kind: "on-pace" })
  })

  test("does not reuse a fixed thirty-day window", () => {
    // February 2026 is a 28-day month. At its start a fixed 30-day window would
    // already report 6.67% elapsed, so 1% used would show a +6pp reserve.
    const februaryReset = "2026-03-15T18:12:24.000Z"
    const februaryStart = Date.parse("2026-02-15T18:12:24.000Z")

    expect(expectedPercent({ windowKind: "monthly", resetsAt: februaryReset, now: februaryStart })).toBe(0)
    expect(paceOf({ windowKind: "monthly", resetsAt: februaryReset, now: februaryStart, usedPercent: 1 })).toEqual({
      kind: "on-pace",
    })
  })
})

describe("pace tolerance", () => {
  const start = Date.parse("2026-10-01T00:00:00Z")
  const resetsAt = new Date(start + 5 * HOUR_MS).toISOString()
  // Half of the window has elapsed, so the expected share is exactly 50%.
  const now = start + 2.5 * HOUR_MS
  const input = { resetsAt, windowKind: "rolling" as const, now }

  test("stays on pace within five percentage points, boundary included", () => {
    const inside = [50, 50 - PACE_TOLERANCE, 50 + PACE_TOLERANCE, 49.8, 50.2]

    for (const usedPercent of inside) {
      expect(paceOf({ ...input, usedPercent })).toEqual({ kind: "on-pace" })
    }
  })

  test("rounds the absolute deviation before choosing the bucket", () => {
    // 5.4 points rounds to 5 and stays on pace on both sides of the expected share.
    expect(paceOf({ ...input, usedPercent: 44.6 })).toEqual({ kind: "on-pace" })
    expect(paceOf({ ...input, usedPercent: 55.4 })).toEqual({ kind: "on-pace" })

    // 5.5 points rounds to 6 and leaves the band symmetrically.
    expect(paceOf({ ...input, usedPercent: 44.5 })).toEqual({ kind: "reserve", delta: 6 })
    expect(paceOf({ ...input, usedPercent: 55.5 })).toEqual({ kind: "deficit", delta: 6 })
  })

  test("reports reserve when usage is below the expected share", () => {
    expect(paceOf({ ...input, usedPercent: 44 })).toEqual({ kind: "reserve", delta: 6 })
    expect(paceOf({ ...input, usedPercent: 43.6 })).toEqual({ kind: "reserve", delta: 6 })
    expect(paceOf({ ...input, usedPercent: 0 })).toEqual({ kind: "reserve", delta: 50 })
  })

  test("reports deficit when usage is above the expected share", () => {
    expect(paceOf({ ...input, usedPercent: 56 })).toEqual({ kind: "deficit", delta: 6 })
    expect(paceOf({ ...input, usedPercent: 100 })).toEqual({ kind: "deficit", delta: 50 })
  })

  test("omits pace when the reset is invalid", () => {
    expect(paceOf({ ...input, resetsAt: undefined, usedPercent: 40 })).toBeUndefined()
    expect(paceOf({ ...input, resetsAt: "not-a-date", usedPercent: 40 })).toBeUndefined()
  })
})

describe("pace labels", () => {
  test("uses a sign for reserve and deficit, and a fixed label for on pace", () => {
    expect(formatPace({ kind: "reserve", delta: 12 })).toBe("+12pp")
    expect(formatPace({ kind: "deficit", delta: 3 })).toBe("-3pp")
    expect(formatPace({ kind: "on-pace" })).toBe("on pace")
    expect(formatPace(undefined)).toBe("")
  })
})
