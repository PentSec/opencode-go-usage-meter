/** @jsxImportSource @opentui/solid */
/**
 * Renderer checks for the sidebar layout.
 *
 * Each test sets the environment credential and mocks `fetch`, so no test reads
 * the real credential stores or calls the usage API. A fake host records the
 * sidebar slot claim, and the real OpenTUI test renderer mounts it.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"
import type { Usage } from "../src/usage.ts"
import { testRender } from "@opentui/solid"

const BASE = Date.parse("2030-01-01T00:00:00Z")
const POLL_MS = 60_000
const CLOCK_MS = 30_000

/**
 * A monthly window from 2029-12-16T12:00:00Z to 2030-01-16T12:00:00Z. It is a
 * 31-day UTC calendar month, and BASE is exactly its midpoint.
 */
const MONTHLY_RESET = "2030-01-16T12:00:00.000Z"

/** Payload the mocked `fetch` answers with on the next load. */
let nextPayload: unknown

/** Set the environment credential so no test reads the real credential stores. */
const initialApiKey = process.env.OPENCODE_GO_API_KEY

const { default: plugin } = await import("../tui.tsx")

type Claim = { render: (input: { sessionID: string }) => unknown }

type Scheduled = {
  id: ReturnType<typeof setInterval>
  run: () => void
  ms: number
}

const schedules: Scheduled[] = []
const views: Array<{ dispose: () => Promise<void> }> = []
const cleanups: Array<() => void> = []
let cleared: Array<ReturnType<typeof setInterval>> = []

const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval

let intervalSpy: ReturnType<typeof spyOn>
let clearSpy: ReturnType<typeof spyOn>
let fetchSpy: ReturnType<typeof spyOn>
let nowSpy: ReturnType<typeof spyOn>

const THEME = {
  text: {
    base: "#FFFFFF",
    muted: "#AAAAAA",
    feedback: {
      success: { base: "#00FF00" },
      warning: { base: "#FFFF00" },
      error: { base: "#FF0000" },
      info: { base: "#00FFFF" },
    },
  },
  border: { base: "#123456" },
}

function fakeHost() {
  const claims: Claim[] = []
  const context = {
    theme: THEME,
    ui: {
      slot: (claim: Claim) => {
        claims.push(claim)
        return () => {}
      },
    },
  } as unknown as Plugin.Context

  return { context, claims }
}

function usage(
  percent: { rolling: number; weekly: number; monthly: number },
  withResets = true,
): { usage: Usage } {
  const half = (seconds: number) => new Date(BASE + (seconds * 1000) / 2).toISOString()

  return {
    usage: {
      rolling: { percent: percent.rolling, resetsAt: withResets ? half(5 * 3_600) : undefined },
      weekly: { percent: percent.weekly, resetsAt: withResets ? half(7 * 86_400) : undefined },
      monthly: { percent: percent.monthly, resetsAt: withResets ? MONTHLY_RESET : undefined },
    },
  }
}

async function mount(payload: ReturnType<typeof usage>) {
  nextPayload = payload
  const host = fakeHost()
  const cleanup = (await plugin.setup(host.context)) as (() => void) | undefined
  // Register the setup cleanup before any assertion, so a failing mount still
  // stops the setup-owned polling and releases the sidebar slot.
  if (cleanup) cleanups.push(cleanup)

  const claim = host.claims[0]
  if (!claim) throw new Error("plugin did not claim the sidebar slot")

  const view = await testRender(() => claim.render({ sessionID: "session" }) as any, {
    width: 80,
    height: 10,
  })
  views.push(view)
  await settle()
  await view.flush()

  return { view }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function row(frame: string, label: string): string {
  const line = frame.split("\n").find((entry) => entry.startsWith(`${label} `))
  if (line === undefined) throw new Error(`missing row ${label} in:\n${frame}`)
  return line
}

function fillCount(line: string): number {
  return [...line.slice(4, 14)].filter((cell) => cell === "\u2501").length
}

beforeEach(() => {
  schedules.length = 0
  cleared = []
  process.env.OPENCODE_GO_API_KEY = "test-key"
  nextPayload = usage({ rolling: 0, weekly: 0, monthly: 0 })
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
    return new Response(JSON.stringify(nextPayload), { status: 200 })
  }) as unknown as typeof fetch)
  nowSpy = spyOn(Date, "now").mockReturnValue(BASE)
  intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, ms?: number) => {
    const id = realSetInterval(callback, ms)
    schedules.push({ id, run: callback, ms: Number(ms) })
    return id
  }) as typeof setInterval)
  clearSpy = spyOn(globalThis, "clearInterval").mockImplementation(((id: ReturnType<typeof setInterval>) => {
    cleared.push(id)
    realClearInterval(id)
  }) as typeof clearInterval)
})

afterEach(async () => {
  try {
    // Stop setup-owned polling before the views go away.
    for (const cleanup of cleanups.splice(0)) cleanup()
  } finally {
    try {
      for (const view of views.splice(0)) await view.dispose()
    } finally {
      const leaked = schedules.filter((entry) => !cleared.includes(entry.id))
      for (const entry of schedules) realClearInterval(entry.id)
      intervalSpy.mockRestore()
      clearSpy.mockRestore()
      fetchSpy.mockRestore()
      nowSpy.mockRestore()

      if (initialApiKey === undefined) delete process.env.OPENCODE_GO_API_KEY
      else process.env.OPENCODE_GO_API_KEY = initialApiKey

      if (leaked.length > 0) {
        throw new Error(`setup cleanup left ${leaked.length} interval(s) running`)
      }
    }
  }
})

describe("fixed sidebar columns", () => {
  test("aligns label, bar, percent, pace and countdown at boundary percentages", async () => {
    const first = await mount(usage({ rolling: 0, weekly: 9, monthly: 10 }))
    const firstFrame = first.view.captureCharFrame()

    const low = [
      row(firstFrame, "5h"),
      row(firstFrame, "7d"),
      row(firstFrame, "1mo"),
    ]

    expect(low[0]!.slice(0, 4)).toBe("5h  ")
    expect(low[1]!.slice(0, 4)).toBe("7d  ")
    expect(low[2]!.slice(0, 4)).toBe("1mo ")

    for (const line of low) {
      expect(line.slice(4, 14)).toHaveLength(10)
      expect(line.charAt(14)).toBe(" ")
      expect(line.slice(20, 27)).toHaveLength(7)
      expect(line.charAt(29)).toBe("\u21bb")
    }

    expect(low[0]!.slice(14, 19)).toBe("   0%")
    expect(low[1]!.slice(14, 19)).toBe("   9%")
    expect(low[2]!.slice(14, 19)).toBe("  10%")

    expect(fillCount(low[0]!)).toBe(0)
    expect(fillCount(low[1]!)).toBe(1)
    expect(fillCount(low[2]!)).toBe(1)

    const second = await mount(usage({ rolling: 99, weekly: 100, monthly: 42 }))
    const secondFrame = second.view.captureCharFrame()

    const high = [
      row(secondFrame, "5h"),
      row(secondFrame, "7d"),
      row(secondFrame, "1mo"),
    ]

    expect(high[0]!.slice(14, 19)).toBe("  99%")
    expect(high[1]!.slice(14, 19)).toBe(" 100%")
    expect(high[2]!.slice(14, 19)).toBe("  42%")

    expect(high[0]!.slice(20, 27)).toBe("-49pp  ")
    expect(high[1]!.slice(20, 27)).toBe("-50pp  ")
    expect(high[2]!.slice(20, 27)).toBe("+8pp   ")

    expect(fillCount(high[0]!)).toBe(10)
    expect(fillCount(high[1]!)).toBe(10)
    expect(fillCount(high[2]!)).toBe(4)

    for (const line of high) {
      expect(line.slice(4, 14)).toHaveLength(10)
      expect(line.charAt(14)).toBe(" ")
      expect(line.slice(20, 27)).toHaveLength(7)
      expect(line.charAt(29)).toBe("\u21bb")
    }
  })

  test("renders labels, bars, on-pace labels and reset countdowns", async () => {
    const { view } = await mount(usage({ rolling: 50, weekly: 50, monthly: 50 }))
    const frame = view.captureCharFrame()

    expect(row(frame, "5h")).toContain("5h  \u2501\u2501\u2501\u2501\u2501\u2500\u2500\u2500\u2500\u2500  50% on pace")
    expect(row(frame, "5h")).toContain("\u21bb 2h 30m")
    expect(row(frame, "7d")).toContain("\u21bb 3d 12h")
    expect(row(frame, "1mo")).toContain("\u21bb 15d 12h")

    for (const label of ["5h", "7d", "1mo"]) {
      expect(fillCount(row(frame, label))).toBe(5)
      expect(row(frame, label).slice(20, 27)).toBe("on pace")
    }
  })

  test("omits the pace column when a reset is missing", async () => {
    const { view } = await mount(usage({ rolling: 42, weekly: 10, monthly: 5 }, false))
    const frame = view.captureCharFrame()

    for (const label of ["5h", "7d", "1mo"]) {
      expect(row(frame, label).slice(20, 27)).toBe("       ")
      expect(row(frame, label)).toContain("\u21bb \u2014")
    }
  })

  test("updates pace when the clock signal advances", async () => {
    const { view } = await mount(usage({ rolling: 50, weekly: 50, monthly: 50 }))
    expect(row(view.captureCharFrame(), "5h").slice(20, 27)).toBe("on pace")

    const clock = schedules.find((entry) => entry.ms === CLOCK_MS)
    if (!clock) throw new Error("panel did not schedule the clock")

    // 30 minutes later in a 5h window: the expected share grows from 50% to 60%.
    nowSpy.mockReturnValue(BASE + 30 * 60_000)
    clock.run()
    await settle()
    await view.flush()

    expect(row(view.captureCharFrame(), "5h").slice(20, 27)).toBe("+10pp  ")
  })
})

describe("characterization: unchanged theme colors", () => {
  test("paints the empty bar track with the theme track color", async () => {
    const { view } = await mount(usage({ rolling: 0, weekly: 10, monthly: 100 }))
    const frame = view.captureSpans()

    const empty = frame.lines
      .flatMap((line) => line.spans)
      .find((span) => span.text === "\u2500".repeat(10))
    if (!empty) throw new Error("no empty bar span in the rendered frame")

    expect(empty.fg.toInts().slice(0, 3)).toEqual([0x12, 0x34, 0x56])

    const filled = frame.lines
      .flatMap((line) => line.spans)
      .find((span) => span.text === "\u2501")
    if (!filled) throw new Error("no filled bar span in the rendered frame")

    // 10% stays in the ok bucket, so the existing severity color is unchanged.
    expect(filled.fg.toInts().slice(0, 3)).toEqual([0x00, 0xff, 0x00])
  })
})

describe("severity colors per row", () => {
  const COLORS: Record<"ok" | "warn" | "danger", number[]> = {
    ok: [0x00, 0xff, 0x00],
    warn: [0xff, 0xff, 0x00],
    danger: [0xff, 0x00, 0x00],
  }

  type Span = { text: string; fg: { toInts(): number[] } }

  function rowSpans(frame: { lines: Array<{ spans: Span[] }> }, label: string) {
    const line = frame.lines.find((entry) =>
      entry.spans.some((span) => span.text === `${label.padEnd(3)} `),
    )
    if (!line) throw new Error(`missing row ${label}`)

    const pick = (pattern: RegExp, what: string) => {
      const span = line.spans.find((entry) => pattern.test(entry.text))
      if (!span) throw new Error(`missing ${what} in row ${label}: ${JSON.stringify(line.spans.map((entry) => entry.text))}`)
      return span
    }

    return {
      label: pick(/^\S+\s+$/, "label"),
      filled: pick(/^\u2501+$/, "filled bar"),
      empty: pick(/^\u2500+$/, "empty bar"),
      percent: pick(/^\s*\d+%/, "percent"),
      pace: pick(/\+\d+pp|on pace|-\d+pp/, "pace"),
    }
  }

  test("each row takes the color of its own percentage", async () => {
    const { view } = await mount(usage({ rolling: 74, weekly: 75, monthly: 90 }))
    const frame = view.captureSpans()

    const expected = [
      { label: "5h", percent: "74%", color: COLORS.ok },
      { label: "7d", percent: "75%", color: COLORS.warn },
      { label: "1mo", percent: "90%", color: COLORS.danger },
    ]

    for (const row of expected) {
      const spans = rowSpans(frame, row.label)
      expect(spans.percent.text.match(/^\s*(\d+)%/)![1] + "%").toBe(row.percent)
      expect(spans.filled.fg.toInts().slice(0, 3)).toEqual(row.color)
      expect(spans.percent.fg.toInts().slice(0, 3)).toEqual(row.color)
      expect(spans.empty.fg.toInts().slice(0, 3)).toEqual([0x12, 0x34, 0x56])
      expect(spans.label.fg.toInts().slice(0, 3)).toEqual([0xaa, 0xaa, 0xaa])
    }
  })

  test("pins the 89 to 90 boundary of the danger bucket", async () => {
    const { view } = await mount(usage({ rolling: 89, weekly: 90, monthly: 10 }))
    const frame = view.captureSpans()

    const expected = [
      { label: "5h", color: COLORS.warn },
      { label: "7d", color: COLORS.danger },
      { label: "1mo", color: COLORS.ok },
    ]

    for (const row of expected) {
      const spans = rowSpans(frame, row.label)
      expect(spans.filled.fg.toInts().slice(0, 3)).toEqual(row.color)
      expect(spans.percent.fg.toInts().slice(0, 3)).toEqual(row.color)
    }
  })
})

describe("low usage stays visible", () => {
  test("draws one colored cell for 2% and 4%, and none for 0%", async () => {
    const { view } = await mount(usage({ rolling: 2, weekly: 4, monthly: 0 }))
    const frame = view.captureSpans()

    for (const label of ["5h", "7d"]) {
      const line = frame.lines.find((entry) =>
        entry.spans.some((span) => span.text === `${label.padEnd(3)} `),
      )
      if (!line) throw new Error(`missing row ${label}`)

      const filled = line.spans.filter((span) => /^\u2501+$/.test(span.text))
      const colored = filled.find((span) => span.fg.toInts().slice(0, 3).join(",") === "0,255,0")
      if (!colored) throw new Error(`${label} has no colored filled cell`)
      expect(colored.text).toHaveLength(1)
    }

    const monthly = frame.lines.find((entry) =>
      entry.spans.some((span) => span.text === "1mo "),
    )
    if (!monthly) throw new Error("missing row 1mo")
    expect(monthly.spans.some((span) => /^\u2501+$/.test(span.text))).toBe(false)
  })
})

describe("characterization: unchanged poll schedule", () => {
  test("schedules one refresh poll and one clock", async () => {
    await mount(usage({ rolling: 1, weekly: 2, monthly: 3 }))

    expect(schedules.filter((entry) => entry.ms === POLL_MS)).toHaveLength(1)
    expect(schedules.filter((entry) => entry.ms === CLOCK_MS)).toHaveLength(1)
  })
})
