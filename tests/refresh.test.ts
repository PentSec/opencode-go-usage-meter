import { describe, expect, test } from "bun:test"
import { createRefresher, type RefreshOptions } from "../src/refresh.ts"

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

/** Records what a refresher reported, in order. */
function recorder() {
  const values: string[] = []
  const errors: string[] = []

  return { values, errors }
}

function refresherWith(load: () => Promise<string>, timeoutMs: number, seen: ReturnType<typeof recorder>) {
  const options: RefreshOptions<string> = {
    load,
    timeoutMs,
    onValue: (value) => seen.values.push(value),
    onError: (message) => seen.errors.push(message),
  }

  return createRefresher(options)
}

describe("createRefresher", () => {
  test("reports the value of a cycle that finishes in time", async () => {
    const load = deferred<string>()
    const seen = recorder()
    const refresher = refresherWith(() => load.promise, 1_000, seen)

    const cycle = refresher.refresh()
    load.resolve("usage")
    await cycle

    expect(seen.values).toEqual(["usage"])
    expect(seen.errors).toEqual([])
  })

  test("reports a timeout when the cycle outlives the deadline", async () => {
    const seen = recorder()
    const refresher = refresherWith(() => new Promise<string>(() => {}), 5, seen)

    await refresher.refresh()

    expect(seen.errors).toEqual(["request timed out"])
    expect(seen.values).toEqual([])
  })

  test("drops a value that arrives after the deadline", async () => {
    const load = deferred<string>()
    const seen = recorder()
    const refresher = refresherWith(() => load.promise, 5, seen)

    await refresher.refresh()
    load.resolve("late")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(seen.values).toEqual([])
    expect(seen.errors).toEqual(["request timed out"])
  })

  test("keeps the load running after the deadline and starts a new cycle", async () => {
    const first = deferred<string>()
    const seen = recorder()
    let loads = 0
    const refresher = refresherWith(
      () => {
        loads += 1
        return loads === 1 ? first.promise : Promise.resolve("second")
      },
      5,
      seen,
    )

    await refresher.refresh()
    await refresher.refresh()

    // The timed-out load was not cancelled, and its late value is dropped.
    first.resolve("late")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(loads).toBe(2)
    expect(seen.errors).toEqual(["request timed out"])
    expect(seen.values).toEqual(["second"])
  })

  test("starts a new cycle after a timeout", async () => {
    const seen = recorder()
    let loads = 0
    const refresher = refresherWith(
      () => {
        loads += 1
        return loads === 1 ? new Promise<string>(() => {}) : Promise.resolve("second")
      },
      5,
      seen,
    )

    await refresher.refresh()
    await refresher.refresh()

    expect(loads).toBe(2)
    expect(seen.errors).toEqual(["request timed out"])
    expect(seen.values).toEqual(["second"])
  })

  test("keeps a second call from overlapping the cycle in flight", async () => {
    const load = deferred<string>()
    const seen = recorder()
    let loads = 0
    const refresher = refresherWith(() => {
      loads += 1
      return load.promise
    }, 1_000, seen)

    const cycle = refresher.refresh()
    await refresher.refresh()

    expect(loads).toBe(1)

    load.resolve("usage")
    await cycle
    expect(seen.values).toEqual(["usage"])
  })

  test("starts a new cycle once the previous one settles", async () => {
    const seen = recorder()
    let loads = 0
    const refresher = refresherWith(() => {
      loads += 1
      return Promise.resolve(`usage ${loads}`)
    }, 1_000, seen)

    await refresher.refresh()
    await refresher.refresh()

    expect(loads).toBe(2)
    expect(seen.values).toEqual(["usage 1", "usage 2"])
  })

  test("reports an unexpected error when the load rejects", async () => {
    const seen = recorder()
    const refresher = refresherWith(() => Promise.reject(new Error("boom")), 1_000, seen)

    await refresher.refresh()

    expect(seen.errors).toEqual(["unexpected error"])
    expect(seen.values).toEqual([])
  })

  test("does not start a load after disposal", async () => {
    const seen = recorder()
    let loads = 0
    const refresher = refresherWith(() => {
      loads += 1
      return Promise.resolve("usage")
    }, 1_000, seen)

    refresher.dispose()
    await refresher.refresh()

    expect(loads).toBe(0)
    expect(seen.values).toEqual([])
    expect(seen.errors).toEqual([])
  })

  test("drops a value that arrives after disposal", async () => {
    const load = deferred<string>()
    const seen = recorder()
    const refresher = refresherWith(() => load.promise, 1_000, seen)

    const cycle = refresher.refresh()
    refresher.dispose()
    load.resolve("usage")
    await cycle

    expect(seen.values).toEqual([])
    expect(seen.errors).toEqual([])
  })

  test("drops an error that arrives after disposal", async () => {
    const load = deferred<string>()
    const seen = recorder()
    const refresher = refresherWith(() => load.promise, 1_000, seen)

    const cycle = refresher.refresh()
    refresher.dispose()
    load.reject(new Error("boom"))
    await cycle

    expect(seen.values).toEqual([])
    expect(seen.errors).toEqual([])
  })
})
