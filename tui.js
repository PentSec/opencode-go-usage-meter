// Generated from tui.tsx by scripts/build-tui.mjs. Do not edit by hand.

import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */
/**
 * TUI entry: renders the OpenCode Go usage windows in the sidebar footer.
 *
 * See ../README.md for installation and behaviour details.
 *
 * OpenCode loads `tui.js`, the Solid output compiled from this file: the host
 * JSX loader skips `node_modules`, so the shipped entry has to carry the
 * reactive code already. Edit this file and run `npm run build` (or
 * `npm test`, which builds first); CI rejects a stale `tui.js`.
 *
 * State lives in `setup`, not in the component: unmounting and remounting a
 * slot panel must keep the current usage state and the refresh cycle alive.
 * The panel reads the signals through accessors.
 */
import { Plugin } from "@opencode/plugin/tui";
import { createSignal, Show } from "solid-js";
import { bar, remaining, severity } from "./src/format.ts";
import { formatPace, paceOf } from "./src/pace.ts";
import { createRefresher } from "./src/refresh.ts";
import { clampPercent, fetchUsage } from "./src/usage.ts";
const POLL_MS = 60_000;
const CLOCK_MS = 30_000;

/** Upper bound for a whole refresh cycle, credential lookup included. */
const REFRESH_TIMEOUT_MS = 15_000;

/** Fixed widths of the row columns, in cells. */
const LABEL_WIDTH = 3;
const PERCENT_WIDTH = 4;
const PACE_WIDTH = 7;
const ROWS = [{
  key: "rolling",
  label: "5h"
}, {
  key: "weekly",
  label: "7d"
}, {
  key: "monthly",
  label: "1mo"
}];
const FALLBACK_COLORS = {
  ok: "#3FB950",
  warn: "#D29922",
  danger: "#F85149",
  info: "#39C5CF"
};
/**
 * The v2 theme is a nested structure. Fall back to fixed colours so the meter
 * stays readable with themes that do not define feedback colours.
 */
function paletteOf(theme) {
  const root = theme;
  const base = root?.text?.base;
  const feedback = root?.text?.feedback;
  return {
    muted: root?.text?.muted ?? base,
    track: root?.border?.base ?? root?.text?.muted ?? base,
    ok: feedback?.success?.base ?? FALLBACK_COLORS.ok,
    warn: feedback?.warning?.base ?? FALLBACK_COLORS.warn,
    danger: feedback?.error?.base ?? FALLBACK_COLORS.danger,
    info: feedback?.info?.base ?? FALLBACK_COLORS.info
  };
}
function colorFor(palette, percent) {
  return palette[severity(percent)];
}
const Row = props => {
  const percent = () => clampPercent(props.window.percent);
  const segments = () => bar(percent());
  const pace = () => paceOf({
    usedPercent: props.window.percent,
    resetsAt: props.window.resetsAt,
    windowKind: props.windowKind,
    now: props.now()
  });
  const paceColor = () => {
    const current = pace();
    if (current === undefined) return props.palette.muted;
    if (current.kind === "reserve") return props.palette.ok;
    if (current.kind === "deficit") return props.palette.warn;
    return props.palette.info;
  };
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text"),
      _el$3 = _$createElement("text"),
      _el$4 = _$createElement("span"),
      _el$5 = _$createElement("text"),
      _el$6 = _$createElement("text"),
      _el$7 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$3);
    _$insertNode(_el$, _el$5);
    _$insertNode(_el$, _el$6);
    _$insertNode(_el$, _el$7);
    _$setProp(_el$, "flexDirection", "row");
    _$setProp(_el$, "width", "100%");
    _$insert(_el$2, () => `${props.label.padEnd(LABEL_WIDTH)} `);
    _$insertNode(_el$3, _el$4);
    _$insert(_el$3, () => segments().filled, _el$4);
    _$insert(_el$4, () => segments().empty);
    _$insert(_el$5, () => ` ${String(percent()).padStart(PERCENT_WIDTH - 1)}%`);
    _$insert(_el$6, () => ` ${formatPace(pace()).padEnd(PACE_WIDTH)}`);
    _$insert(_el$7, () => `  \u21bb ${remaining(props.window.resetsAt, props.now())}`);
    _$effect(_p$ => {
      var _v$ = props.palette.muted,
        _v$2 = colorFor(props.palette, percent()),
        _v$3 = {
          fg: props.palette.track
        },
        _v$4 = colorFor(props.palette, percent()),
        _v$5 = paceColor(),
        _v$6 = props.palette.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$4, "style", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$5, "fg", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$6, "fg", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp(_el$7, "fg", _v$6, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$;
  })();
};
const Panel = props => {
  const palette = () => paletteOf(props.theme);
  return (() => {
    var _el$8 = _$createElement("box"),
      _el$9 = _$createElement("text");
    _$insertNode(_el$8, _el$9);
    _$setProp(_el$8, "flexDirection", "column");
    _$setProp(_el$8, "width", "100%");
    _$insertNode(_el$9, _$createTextNode(`Go usage`));
    _$insert(_el$8, _$createComponent(Show, {
      get when() {
        return props.status().kind === "loading";
      },
      get children() {
        var _el$1 = _$createElement("text");
        _$insertNode(_el$1, _$createTextNode(`…`));
        _$effect(_$p => _$setProp(_el$1, "fg", palette().muted, _$p));
        return _el$1;
      }
    }), null);
    _$insert(_el$8, _$createComponent(Show, {
      get when() {
        const current = props.status();
        return current.kind === "error" ? current : undefined;
      },
      keyed: true,
      children: failed => (() => {
        var _el$11 = _$createElement("text");
        _$insert(_el$11, () => `\u2717 ${failed.message}`);
        _$effect(_$p => _$setProp(_el$11, "fg", palette().danger, _$p));
        return _el$11;
      })()
    }), null);
    _$insert(_el$8, _$createComponent(Show, {
      get when() {
        const current = props.status();
        return current.kind === "ready" ? current.usage : undefined;
      },
      keyed: true,
      children: usage => (() => {
        var _el$12 = _$createElement("box");
        _$setProp(_el$12, "flexDirection", "column");
        _$setProp(_el$12, "width", "100%");
        _$insert(_el$12, () => ROWS.map(row => _$createComponent(Row, {
          get label() {
            return row.label;
          },
          get window() {
            return usage[row.key];
          },
          get windowKind() {
            return row.key;
          },
          get now() {
            return props.now;
          },
          get palette() {
            return palette();
          }
        })));
        return _el$12;
      })()
    }), null);
    _$effect(_$p => _$setProp(_el$9, "fg", palette().muted, _$p));
    return _el$8;
  })();
};
export default Plugin.define({
  id: "go-usage-meter",
  setup(context) {
    const [status, setStatus] = createSignal({
      kind: "loading"
    });
    const [now, setNow] = createSignal(Date.now());
    const refresher = createRefresher({
      load: fetchUsage,
      timeoutMs: REFRESH_TIMEOUT_MS,
      onValue: result => setStatus(result.ok ? {
        kind: "ready",
        usage: result.usage
      } : {
        kind: "error",
        message: result.error
      }),
      onError: message => setStatus({
        kind: "error",
        message
      })
    });
    refresher.refresh();
    const poll = setInterval(refresher.refresh, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS);
    const release = context.ui.slot({
      append: "sidebar.footer",
      render: () => _$createComponent(Panel, {
        get theme() {
          return context.theme;
        },
        status: status,
        now: now
      })
    });
    return () => {
      refresher.dispose();
      clearInterval(poll);
      clearInterval(clock);
      release();
    };
  }
});
