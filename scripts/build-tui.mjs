/**
 * Compiles the TUI entry to plain JavaScript.
 *
 * OpenCode installs plugins under `node_modules`, and its Solid JSX loader
 * skips those paths. A `.tsx` entry therefore reaches the host untransformed,
 * where the generic JSX runtime turns every expression into eager props and
 * the panel never repaints. Shipping the Solid output removes that dependency
 * on the host loader.
 *
 * The output stays next to `tui.tsx` so the relative `./src/*.ts` imports keep
 * resolving, and the sources remain the only thing to edit.
 */
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { transformFileAsync } from "@babel/core"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(root, "tui.tsx")
const target = join(root, "tui.js")

const header = `// Generated from tui.tsx by scripts/build-tui.mjs. Do not edit by hand.\n\n`

const result = await transformFileAsync(source, {
  configFile: false,
  babelrc: false,
  sourceType: "module",
  presets: [
    ["babel-preset-solid", { moduleName: "@opentui/solid", generate: "universal" }],
    ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
  ],
})

if (result?.code === undefined || result.code === null) {
  throw new Error(`Babel produced no output for ${source}`)
}

const output = header + result.code + "\n"
const current = await readFile(target, "utf8").catch(() => undefined)

if (current === output) {
  console.log("tui.js is up to date")
} else {
  await writeFile(target, output)
  console.log("tui.js rebuilt from tui.tsx")
}
