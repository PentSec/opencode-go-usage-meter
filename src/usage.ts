import { resolveEnvironmentKey, resolveStoredApiKeys } from "./credentials.ts"

/** Official OpenCode Go usage endpoint, as used by the web console. */
export const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"

/** Give up on a hung request well before the next poll. */
const REQUEST_TIMEOUT_MS = 10_000

export type UsageWindowKind = "rolling" | "weekly" | "monthly"

export type UsageWindow = {
  /** Percentage of the window allowance already consumed (0-100). */
  percent: number
  /** ISO timestamp for when the window resets, when the API reports one. */
  resetsAt?: string
}

export type Usage = Record<UsageWindowKind, UsageWindow>

export type UsageResult = { ok: true; usage: Usage } | { ok: false; error: string }

type RawWindow = { percent?: unknown; resetsAt?: unknown }

function toWindow(raw: RawWindow | undefined): UsageWindow | undefined {
  if (!raw || typeof raw !== "object") return undefined

  const percent = Number(raw.percent)
  return {
    percent: Number.isFinite(percent) ? percent : 0,
    resetsAt: typeof raw.resetsAt === "string" ? raw.resetsAt : undefined,
  }
}

/** Clamp a percentage into 0..100 and drop fractions. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** Parse the API payload. Exported so the shape can be checked in isolation. */
export function parseUsage(payload: unknown): Usage | undefined {
  if (!payload || typeof payload !== "object") return undefined

  const usage = (payload as { usage?: Record<string, RawWindow> }).usage
  if (!usage || typeof usage !== "object") return undefined

  const rolling = toWindow(usage.rolling)
  const weekly = toWindow(usage.weekly)
  const monthly = toWindow(usage.monthly)
  if (!rolling || !weekly || !monthly) return undefined

  return { rolling, weekly, monthly }
}

/** One credential attempt: either a settled result or a rejected credential. */
type Attempt = { kind: "ready"; result: UsageResult } | { kind: "rejected" }

/** Credential that produced the last non-rejected response, tried first later. */
let lastWorkingKey: string | undefined

/**
 * Move the last working credential to the front, so a stale candidate does not
 * cost a rejected request on every poll.
 */
function orderCandidates(candidates: string[]): string[] {
  if (lastWorkingKey === undefined) return candidates

  const index = candidates.indexOf(lastWorkingKey)
  if (index <= 0) return candidates

  return [lastWorkingKey, ...candidates.filter((candidate) => candidate !== lastWorkingKey)]
}

/** Try one credential. Only a 401 means the credential itself is wrong. */
async function attemptUsage(key: string): Promise<Attempt> {
  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as { name?: string } | undefined)?.name
    const message = name === "TimeoutError" ? "request timed out" : "network error"
    return { kind: "ready", result: { ok: false, error: message } }
  }

  if (response.status === 401) return { kind: "rejected" }
  if (response.status === 429) return { kind: "ready", result: { ok: false, error: "rate limited" } }
  if (!response.ok) return { kind: "ready", result: { ok: false, error: `HTTP ${response.status}` } }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { kind: "ready", result: { ok: false, error: "invalid response" } }
  }

  const usage = parseUsage(payload)
  if (!usage) return { kind: "ready", result: { ok: false, error: "unexpected response" } }

  return { kind: "ready", result: { ok: true, usage } }
}

/**
 * Yield candidates lazily: the environment key first, and the stored credentials
 * only when the consumer asks for another attempt. A working environment key
 * therefore never touches the credential database or `auth.json`.
 */
async function* candidateKeys(directories: string[] | undefined): AsyncGenerator<string> {
  const seen = new Set<string>()

  const environment = await resolveEnvironmentKey()
  if (environment) {
    seen.add(environment)
    yield environment
  }

  for (const key of orderCandidates(await resolveStoredApiKeys(directories))) {
    if (seen.has(key)) continue

    seen.add(key)
    yield key
  }
}

/**
 * Fetch the three usage windows for the current account.
 *
 * Candidates are tried in order and a rejected one falls through to the next,
 * so a stale OAuth token cannot hide a working API key. Any other outcome stops
 * the chain: retrying with another credential would not fix the network, the
 * rate limit or the response shape.
 */
export async function fetchUsage(directories?: string[]): Promise<UsageResult> {
  let attempted = 0

  for await (const key of candidateKeys(directories)) {
    attempted += 1
    const attempt = await attemptUsage(key)

    if (attempt.kind === "rejected") {
      // A rejected key must not stay preferred for the next poll.
      if (key === lastWorkingKey) lastWorkingKey = undefined
      continue
    }

    lastWorkingKey = key
    return attempt.result
  }

  return attempted === 0 ? { ok: false, error: "no credential found" } : { ok: false, error: "credential rejected" }
}
