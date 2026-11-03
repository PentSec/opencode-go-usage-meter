/**
 * Refresh cycle for one usage poll.
 *
 * A cycle is bounded by `timeoutMs`, which covers the whole load, credential
 * lookup included. A cycle that is still in flight makes the next poll a no-op,
 * and a result that arrives after disposal is dropped. The deadline does not
 * cancel the load: it only stops the cycle from waiting for it.
 */

export type RefreshOptions<Value> = {
  /** Runs one load. Resolves with the value, or rejects. */
  load: () => Promise<Value>
  /** Upper bound for one cycle, in milliseconds. */
  timeoutMs: number
  /** Receives the value of a cycle that finished in time, while live. */
  onValue: (value: Value) => void
  /** Receives a user-facing message, while live. */
  onError: (message: string) => void
}

export type Refresher = {
  /** Runs one cycle, unless a cycle is already in flight or the refresher is disposed. */
  refresh: () => Promise<void>
  /** Drops later results. Does not cancel an in-flight load. */
  dispose: () => void
}

/**
 * Race a promise against a deadline. Resolves `undefined` when the deadline
 * wins, so the caller can tell a timeout apart from a real result.
 */
async function withDeadline<Value>(promise: Promise<Value>, ms: number): Promise<Value | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms)
  })

  try {
    return await Promise.race([promise, deadline])
  } finally {
    clearTimeout(timer)
  }
}

export function createRefresher<Value>(options: RefreshOptions<Value>): Refresher {
  let disposed = false
  let refreshing = false

  const refresh = async () => {
    if (disposed || refreshing) return
    refreshing = true

    try {
      const value = await withDeadline(options.load(), options.timeoutMs)
      if (disposed) return

      if (value === undefined) {
        options.onError("request timed out")
        return
      }

      options.onValue(value)
    } catch {
      if (disposed) return
      options.onError("unexpected error")
    } finally {
      refreshing = false
    }
  }

  return {
    refresh,
    dispose: () => {
      disposed = true
    },
  }
}
