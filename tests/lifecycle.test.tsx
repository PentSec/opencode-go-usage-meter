/** @jsxImportSource @opentui/solid */
/**
 * Lifecycle reproduction against the real plugin setup and a fake host.
 *
 * The fake host records the slot claim, so a test can mount the claim's render
 * function, dispose it, and mount the same claim again. The real OpenTUI test
 * renderer provides the Solid root for each mount.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import type { Plugin } from "@opencode/plugin/tui"
import { testRender } from "@opentui/solid"

const POLL_MS = 60_000
const CLOCK_MS = 30_000

type Deferred<Value> = {
  promise: Promise<Value>
  resolve: (value: Value) => void
  reject: (error: unknown) => void
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((onValue, onError) => {
    resolve = onValue
    reject = onError
  })

  return { promise, resolve, reject }
}

type Scheduled = { id: ReturnType<typeof setInterval>; run: () => void; ms: number }

const loads: Deferred<Response>[] = []

/** Set the environment credential so no test reads the real credential stores. */
const initialApiKey = process.env.OPENCODE_GO_API_KEY

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

const { default: plugin } = await import("../tui.tsx")

type Claim = { render: (input: { sessionID: string }) => unknown }

function fakeHost() {
  const claims: Claim[] = []
  let released = 0
  const context = {
    theme: {},
    ui: {
      slot: (claim: Claim) => {
        claims.push(claim)
        return () => {
          released += 1
        }
      },
    },
  } as unknown as Plugin.Context

  return {
    context,
    claims,
    released: () => released,
  }
}

async function startPlugin() {
  const host = fakeHost()
  const cleanup = await plugin.setup(host.context)

  return { ...host, cleanup: cleanup as (() => void) | undefined }
}

async function mount(claim: Claim) {
  const view = await testRender(() => claim.render({ sessionID: "session" }) as any, { width: 60, height: 10 })
  await view.flush()
  await waitForLoads(1)
  return view
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Wait until the plugin registered `count` loads, instead of assuming timing. */
async function waitForLoads(count: number) {
  for (let attempt = 0; attempt < 50 && loads.length < count; attempt += 1) await settle()
}

function ready(percent: number): Response {
  return json(200, {
    usage: {
      rolling: { percent, resetsAt: new Date(Date.now() + 3_600_000).toISOString() },
      weekly: { percent: 10 },
      monthly: { percent: 5 },
    },
  })
}

let schedules: Scheduled[] = []
let cleared: Array<ReturnType<typeof setInterval>> = []
let intervalSpy: ReturnType<typeof spyOn>
let clearSpy: ReturnType<typeof spyOn>
let fetchSpy: ReturnType<typeof spyOn>
let dateSpy: ReturnType<typeof spyOn> | undefined

const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval

beforeEach(() => {
  loads.length = 0
  schedules = []
  cleared = []
  process.env.OPENCODE_GO_API_KEY = "test-key"

  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
    const load = deferred<Response>()
    loads.push(load)
    return load.promise
  }) as unknown as typeof fetch)

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

afterEach(() => {
  for (const entry of schedules) realClearInterval(entry.id)
  dateSpy?.mockRestore()
  dateSpy = undefined
  fetchSpy.mockRestore()
  clearSpy.mockRestore()
  intervalSpy.mockRestore()

  if (initialApiKey === undefined) delete process.env.OPENCODE_GO_API_KEY
  else process.env.OPENCODE_GO_API_KEY = initialApiKey
})

const polls = () => schedules.filter((entry) => entry.ms === POLL_MS)
const clocks = () => schedules.filter((entry) => entry.ms === CLOCK_MS)

describe("panel lifecycle", () => {
  test("keeps ready state and the in-flight cycle across a panel remount", async () => {
    const host = await startPlugin()
    expect(host.claims).toHaveLength(1)

    const first = await mount(host.claims[0]!)
    expect(loads, "one load after the first panel mount").toHaveLength(1)
    expect(first.captureCharFrame()).toContain("\u2026")
    await first.dispose()

    expect(loads).toHaveLength(1)

    const second = await mount(host.claims[0]!)
    expect(second.captureCharFrame()).toContain("\u2026")
    expect(loads, "the panel remount must reuse the in-flight load").toHaveLength(1)

    loads[0]!.resolve(ready(42))
    await settle()
    await second.flush()

    const frame = second.captureCharFrame()
    expect(frame).toContain("42%")
    expect(frame).toContain("10%")
    expect(loads).toHaveLength(1)

    expect(polls()).toHaveLength(1)
    expect(clocks()).toHaveLength(1)

    host.cleanup?.()
    await second.dispose()
  })

  test("keeps error state across a panel remount without a new load", async () => {
    const host = await startPlugin()
    const first = await mount(host.claims[0]!)

    loads[0]!.resolve(json(429, {}))
    await settle()
    await first.flush()
    expect(first.captureCharFrame(), "error visible before the panel remount").toContain("rate limited")

    await first.dispose()

    const second = await mount(host.claims[0]!)
    const frame = second.captureCharFrame()
    expect(frame, "error retained after the panel remount").toContain("rate limited")
    expect(loads).toHaveLength(1)

    expect(polls()).toHaveLength(1)
    expect(clocks()).toHaveLength(1)

    host.cleanup?.()
    await second.dispose()
  })

  test("keeps ready state across a remount and follows the setup-owned clock", async () => {
    const host = await startPlugin()
    const first = await mount(host.claims[0]!)
    const base = Date.parse("2030-01-01T00:00:00Z")

    dateSpy = spyOn(Date, "now").mockReturnValue(base)
    loads[0]!.resolve(
      json(200, {
        usage: {
          rolling: { percent: 42, resetsAt: new Date(base + 3_600_000).toISOString() },
          weekly: { percent: 10 },
          monthly: { percent: 5 },
        },
      }),
    )
    await settle()
    await first.flush()
    clocks()[0]!.run()
    await settle()
    await first.flush()
    expect(first.captureCharFrame(), "usage visible before the panel remount").toContain("42%")
    expect(first.captureCharFrame()).toContain("1h 0m")
    await first.dispose()

    const second = await mount(host.claims[0]!)
    expect(second.captureCharFrame(), "usage retained after the panel remount").toContain("42%")
    expect(loads).toHaveLength(1)
    expect(second.captureCharFrame()).toContain("1h 0m")

    dateSpy.mockReturnValue(base + 1_800_000)
    clocks()[0]!.run()
    await settle()
    await second.flush()
    expect(second.captureCharFrame()).toContain("30m")

    dateSpy.mockRestore()
    dateSpy = undefined
    host.cleanup?.()
    await second.dispose()
  })

  test("cleanup stops timers, drops a late write and releases the slot", async () => {
    const host = await startPlugin()
    const view = await mount(host.claims[0]!)
    expect(loads).toHaveLength(1)
    expect(polls()).toHaveLength(1)
    expect(clocks()).toHaveLength(1)

    host.cleanup?.()

    expect(host.released()).toBe(1)
    expect(cleared).toContain(polls()[0]!.id)
    expect(cleared).toContain(clocks()[0]!.id)

    // A stale poll callback must not start new work after cleanup.
    polls()[0]!.run()
    await settle()
    expect(loads).toHaveLength(1)

    loads[0]!.resolve(ready(42))
    await settle()
    await view.flush()

    const frame = view.captureCharFrame()
    expect(frame).toContain("\u2026")
    expect(frame).not.toContain("42%")

    await view.dispose()
  })
})
