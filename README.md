
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
5h  ━─────────   8% +10pp    ↻ 4h 6m
7d  ━━━━──────  42% on pace  ↻ 4d 4h
1mo ━─────────  13% on pace  ↻ 25d 16h
```

One line per window: label, bar, percentage, pace and time until the window
resets. Columns are fixed width so the rows stay aligned: 3 cells for the
label, 10 for the bar, 4 for the percentage (100% is the widest) and 7 for the
pace indicator. Bars turn yellow from 75% and red from 90%. Any non-zero usage
fills at least one cell, so low usage stays visible; 0% leaves the bar empty.

### Pace

The pace indicator compares the used percentage with the share of the window
that has already elapsed. Rolling is exactly 5 hours and weekly is exactly
7 days. The monthly window follows the subscription anniversary: it starts one
UTC calendar month before `resetsAt`, so it lasts 28 to 31 days. The start keeps
the UTC time fields of `resetsAt` and clamps the day to the last valid day of the
previous month: 31 March starts on 28 February (29 in leap years), and 31 May starts on 30 April.
Calendar time counts in full, including Saturdays and Sundays.

Deviations are rounded to whole points before the bucket is chosen: a rounded
magnitude of 5 or less is on pace, and anything above that is a reserve or a
deficit based on the sign of the original deviation.

| Label | Meaning | Color |
| --- | --- | --- |
| `+12pp` | Reserve: usage is 12 points below the elapsed share | green |
| `on pace` | Rounded difference is at most 5 points | cyan |
| `-12pp` | Deficit: usage is 12 points above the elapsed share | yellow |

A missing or invalid reset timestamp hides the pace label.

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
3. The active `opencode` (OpenCode Console) credential in the same database.
4. The `opencode-go` entry in `auth.json` (legacy layout).
5. The `opencode` (OpenCode Console) entry in `auth.json`.

Within each store, the resolver checks `opencode-go` before `opencode`. It checks
the database before `auth.json` because that is where OpenCode keeps the
credential it currently uses; `auth.json` can still hold an expired copy, which
returns `401 api_key_expired`.

The resolver accepts the first non-empty string in `key`, `apiKey`, `access` or
`token`, and also accepts an array of entries (older layouts). An entry marked
`type: "oauth"` contributes its `access` token. When the entry carries a numeric
`expires` timestamp that is already past, the token is skipped; an entry with no
usable expiry is tried, and a rejected one costs a single request before the
next candidate.

The environment variable is tried first and the stored credentials are only read
when it is absent or rejected, so a working environment key never opens the
database or `auth.json`.

The plugin does not test a credential in advance. It tries the candidates in the
order above and moves to the next one only when the endpoint returns HTTP 401.
Any other outcome stops the chain, because a network error, a rate limit or a
malformed response would not improve with another credential. Once a credential
works, later polls try it first, and a credential rejected by every poll stops
being preferred.

When every candidate is rejected the panel shows `credential rejected`; when
the list is empty it shows `no credential found`.

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
