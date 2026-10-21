import { resolveApiKey } from "./credentials.ts"

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

/** Fetch the three usage windows for the current account. */
export async function fetchUsage(): Promise<UsageResult> {
  const key = await resolveApiKey()
  if (!key) return { ok: false, error: "no credential found" }

  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as { name?: string } | undefined)?.name
    return { ok: false, error: name === "TimeoutError" ? "request timed out" : "network error" }
  }

  if (response.status === 401) return { ok: false, error: "credential rejected" }
  if (response.status === 429) return { ok: false, error: "rate limited" }
  if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { ok: false, error: "invalid response" }
  }

  const usage = parseUsage(payload)
  if (!usage) return { ok: false, error: "unexpected response" }

  return { ok: true, usage }
}
