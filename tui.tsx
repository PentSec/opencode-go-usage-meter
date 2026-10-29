/** @jsxImportSource @opentui/solid */
/**
 * TUI entry: renders the OpenCode Go usage windows in the sidebar footer.
 *
 * See ../README.md for installation and behaviour details.
 */
import { Plugin } from "@opencode/plugin/tui"
import type { RGBA } from "@opentui/core"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { bar, remaining, severity, type Severity } from "./src/format.ts"
import { clampPercent, fetchUsage, type Usage, type UsageWindow, type UsageWindowKind } from "./src/usage.ts"

const POLL_MS = 60_000
const CLOCK_MS = 30_000

/** Upper bound for a whole refresh cycle, credential lookup included. */
const REFRESH_TIMEOUT_MS = 15_000

/**
 * Race a promise against a deadline. Resolves `undefined` when the deadline
 * wins, so the caller can tell a timeout apart from a real result.
 */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
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

const ROWS: { key: UsageWindowKind; label: string }[] = [
  { key: "rolling", label: "5h" },
  { key: "weekly", label: "7d" },
  { key: "monthly", label: "30d" },
]

const FALLBACK_COLORS: Record<Severity, string> = {
  ok: "#3FB950",
  warn: "#D29922",
  danger: "#F85149",
}

type Color = string | RGBA

type Palette = {
  muted?: Color
  track?: Color
  ok?: Color
  warn?: Color
  danger?: Color
}

/**
 * The v2 theme is a nested structure. Fall back to fixed colours so the meter
 * stays readable with themes that do not define feedback colours.
 */
function paletteOf(theme: unknown): Palette {
  const root = theme as Record<string, any> | undefined
  const base = root?.text?.base as Color | undefined
  const feedback = root?.text?.feedback

  return {
    muted: (root?.text?.muted ?? base) as Color | undefined,
    track: (root?.border?.base ?? root?.text?.muted ?? base) as Color | undefined,
    ok: (feedback?.success?.base ?? FALLBACK_COLORS.ok) as Color | undefined,
    warn: (feedback?.warning?.base ?? FALLBACK_COLORS.warn) as Color | undefined,
    danger: (feedback?.error?.base ?? FALLBACK_COLORS.danger) as Color | undefined,
  }
}

function colorFor(palette: Palette, percent: number): Color | undefined {
  return palette[severity(percent)]
}

const Row = (props: { label: string; window: UsageWindow; now: number; palette: Palette }) => {
  const percent = () => clampPercent(props.window.percent)
  const segments = () => bar(percent())

  return (
    <box flexDirection="row" width="100%">
      <text fg={props.palette.muted}>{props.label.padEnd(4)}</text>
      <text fg={colorFor(props.palette, percent())}>{segments().filled}</text>
      <text fg={props.palette.track}>{segments().empty}</text>
      <text fg={colorFor(props.palette, percent())}>{` ${percent()}%`}</text>
      <text fg={props.palette.muted}>{`  \u21bb ${remaining(props.window.resetsAt, props.now)}`}</text>
    </box>
  )
}

type Status = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; usage: Usage }

const Panel = (props: { theme: unknown }) => {
  const [status, setStatus] = createSignal<Status>({ kind: "loading" })
  const [now, setNow] = createSignal(Date.now())
  const palette = () => paletteOf(props.theme)

  let disposed = false
  let refreshing = false

  const refresh = async () => {
    if (refreshing) return
    refreshing = true

    try {
      const result = await withDeadline(fetchUsage(), REFRESH_TIMEOUT_MS)
      if (disposed) return

      if (!result) {
        setStatus({ kind: "error", message: "request timed out" })
        return
      }

      setStatus(result.ok ? { kind: "ready", usage: result.usage } : { kind: "error", message: result.error })
    } catch {
      if (disposed) return
      setStatus({ kind: "error", message: "unexpected error" })
    } finally {
      refreshing = false
    }
  }

  onMount(() => {
    refresh()
    const poll = setInterval(refresh, POLL_MS)
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS)
    onCleanup(() => {
      disposed = true
      clearInterval(poll)
      clearInterval(clock)
    })
  })

  return (
    <box flexDirection="column" width="100%">
      <text fg={palette().muted}>Go usage</text>
      <Show when={status().kind === "loading"}>
        <text fg={palette().muted}>{"\u2026"}</text>
      </Show>
      <Show
        when={(() => {
          const current = status()
          return current.kind === "error" ? current : undefined
        })()}
        keyed
      >
        {(failed) => <text fg={palette().danger}>{`\u2717 ${failed.message}`}</text>}
      </Show>
      <Show
        when={(() => {
          const current = status()
          return current.kind === "ready" ? current.usage : undefined
        })()}
        keyed
      >
        {(usage) => (
          <box flexDirection="column" width="100%">
            {ROWS.map((row) => (
              <Row label={row.label} window={usage[row.key]} now={now()} palette={palette()} />
            ))}
          </box>
        )}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "go-usage-meter",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.footer",
      render: () => <Panel theme={context.theme} />,
    })
  },
})
