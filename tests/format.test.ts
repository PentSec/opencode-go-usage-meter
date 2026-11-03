import { describe, expect, test } from "bun:test"

import { BAR_WIDTH, bar, remaining, severity } from "../src/format.ts"

describe("characterization: severity thresholds stay unchanged", () => {
  test("maps usage onto ok, warn and danger buckets", () => {
    expect(severity(0)).toBe("ok")
    expect(severity(74)).toBe("ok")
    expect(severity(75)).toBe("warn")
    expect(severity(89)).toBe("warn")
    expect(severity(90)).toBe("danger")
    expect(severity(100)).toBe("danger")
  })
})

describe("characterization: reset countdown stays unchanged", () => {
  const now = Date.parse("2026-10-01T00:00:00Z")

  test("formats days, hours, minutes and the boundaries", () => {
    expect(remaining(new Date(now + 2 * 86_400_000 + 5 * 3_600_000).toISOString(), now)).toBe("2d 5h")
    expect(remaining(new Date(now + 3 * 3_600_000 + 12 * 60_000).toISOString(), now)).toBe("3h 12m")
    expect(remaining(new Date(now + 42 * 60_000).toISOString(), now)).toBe("42m")
    expect(remaining(new Date(now + 30_000).toISOString(), now)).toBe("<1m")
    expect(remaining(new Date(now).toISOString(), now)).toBe("now")
    expect(remaining(new Date(now - 1_000).toISOString(), now)).toBe("now")
    expect(remaining(undefined, now)).toBe("\u2014")
    expect(remaining("not-a-date", now)).toBe("\u2014")
  })
})

describe("changed: fixed ten-cell bar", () => {
  test("keeps combined filled and empty width at ten cells", () => {
    expect(BAR_WIDTH).toBe(10)

    for (const percent of [0, 9, 10, 99, 100]) {
      const segments = bar(percent)
      expect(segments.filled.length + segments.empty.length).toBe(BAR_WIDTH)
    }
  })

  test("rounds the filled cells at the boundary percentages", () => {
    expect(bar(0)).toEqual({ filled: "", empty: "\u2500".repeat(10) })
    expect(bar(9).filled).toBe("\u2501")
    expect(bar(10).filled).toBe("\u2501")
    expect(bar(99).filled).toBe("\u2501".repeat(10))
    expect(bar(100).filled).toBe("\u2501".repeat(10))
  })

  test("fills one cell for any non-zero usage below the first cell", () => {
    for (const percent of [1, 2, 3, 4]) {
      const segments = bar(percent)
      expect(segments.filled).toBe("\u2501")
      expect(segments.empty).toHaveLength(BAR_WIDTH - 1)
    }

    expect(bar(0).filled).toBe("")
  })
})
