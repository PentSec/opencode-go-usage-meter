/**
 * Server entry.
 *
 * This plugin is TUI-only. OpenCode loads the `"."` export for the server side
 * and the `"./tui"` export for the terminal UI, so this entry stays a no-op.
 *
 * Keep this file free of TUI imports: loading `@opentui/solid` outside the
 * renderer fails with "Environment variable OPENTUI_FORCE_WCWIDTH is already
 * registered with different configuration".
 */
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "go-usage-meter",
  setup() {
    // Intentionally empty: all behaviour lives in ./tui.tsx.
  },
})
