
<p align="center">OpenCode Go subscription usage in the OpenCode v2 TUI sidebar</p>
<p align="center">
  <img alt="NPM Version" src="https://img.shields.io/npm/v/opencode-go-usage-meter">
  <img alt="NPM Downloads" src="https://img.shields.io/npm/dw/opencode-go-usage-meter">
  <img alt="GitHub Actions Workflow Status" src="https://img.shields.io/github/actions/workflow/status/PentSec/opencode-go-usage-meter/publish.yml">
  <img alt="NPM License" src="https://img.shields.io/npm/l/opencode-go-usage-meter">
</p>

<img width="1542" height="1080" alt="screenshot_1 5x_postspark_2026-10-21_17-00-49" src="https://github.com/user-attachments/assets/0df5943a-aff3-481e-8743-b6d56c7e38d2" />

# opencode-go-usage-meter

OpenCode Go subscription usage in the OpenCode **v2** TUI sidebar: the same
rolling (5h), weekly and monthly windows the [Console](https://opencode.ai/console)
shows, read from the official usage endpoint.

```
Go usage
5h  ──────────────── 0%  ↻ 4h 56m
7d  ──────────────── 3%  ↻ 6d 4h
30d ━━────────────── 10%  ↻ 25d 16h
```

One line per window: label, bar, percentage and time until the window resets.
Bars turn yellow from 75% and red from 90%.

## Requirements

- OpenCode **v2** (plugin API `@opencode/plugin` >= 2.0)
- An OpenCode Go or Go Plus subscription
- The right sidebar visible; the panel lives in the sidebar footer

## Install

From npm:

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-go-usage-meter"]
}
```

From a local checkout (useful while developing):

```bash
git clone https://github.com/PentSec/opencode-go-usage-meter.git
cd opencode-go-usage-meter
npm install   # installs the plugin dependency and peer dependencies
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-go-usage-meter"]
}
```

Point the path at the **directory**. OpenCode accepts single `.ts` plugin files,
but a `.tsx` entry that renders JSX has to be a package: a file path fails with
`configured plugin path must be a directory`.

Restart OpenCode after changing the plugin list. Reloading the config is not
enough: plugins are resolved at startup.

## How it works

- Reads `GET https://opencode.ai/zen/go/v1/usage`, the endpoint behind the
  Console usage page, and renders the `rolling`, `weekly` and `monthly` values
  (`percent` plus `resetsAt`).
- Polls every 60 seconds; the reset countdown refreshes every 30 seconds.
- Read-only: it never sends prompts and never writes credentials.

### Credential resolution

In order:

1. `OPENCODE_GO_API_KEY` environment variable.
2. The active `opencode-go` credential in OpenCode's local database
   (`credential` table).
3. The `opencode-go` entry in `auth.json` (legacy layout).

The database is checked first on purpose. Current OpenCode builds keep the live
credential there, and `auth.json` can still hold an expired copy, which returns
`401 api_key_expired`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `✗ credential rejected` | The usage API returned 401. Reconnect OpenCode Go, or set `OPENCODE_GO_API_KEY` to a key created in the Console. |
| Nothing rendered | The sidebar is hidden, or you are not inside a session. Sidebar slots only exist within a session. |
| Plugin does not load | Check `/plugins` in the TUI. The configured path must be a directory containing `package.json`. |

## Plugin package layout

The package follows the OpenCode v2 CLI plugin contract:

```json
{
  "type": "module",
  "exports": {
    ".": "./index.ts",
    "./tui": "./tui.tsx"
  },
  "dependencies": {
    "@opencode/plugin": "latest"
  },
  "peerDependencies": {
    "@opentui/core": ">=0.6.6",
    "@opentui/solid": ">=0.6.6",
    "solid-js": ">=1.9.0"
  }
}
```

- `"."` is the server entry. It must export `{ id, setup }`. Keep it free of TUI
  imports: loading `@opentui/solid` outside the renderer fails with
  `OPENTUI_FORCE_WCWIDTH is already registered`.
- `"./tui"` is the TUI entry, built with `Plugin.define` from
  `@opencode/plugin/tui`.

### Remote servers

`opencode.jsonc` plugins follow the server they connect to. To keep the meter
active when the TUI attaches to a remote server, also list the package in
`cli.json`:

```json
{
  "plugins": ["opencode-go-usage-meter"]
}
```

## Privacy

The plugin reads a credential from the local machine and sends it only to
`opencode.ai/zen/go/v1/usage`, as the `Authorization` header. It stores nothing,
logs nothing, and has no telemetry.

## License

MIT
