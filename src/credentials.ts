import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Credential lookup for OpenCode Go.
 *
 * Order:
 *   1. `OPENCODE_GO_API_KEY` environment variable.
 *   2. The active `opencode-go` credential in OpenCode's local database.
 *   3. The active `opencode` (OpenCode Console) credential in the same database.
 *   4. The `opencode-go` entry in `auth.json` (legacy layout).
 *   5. The `opencode` (OpenCode Console) entry in `auth.json`.
 *
 * The database is checked before `auth.json` because it holds the credential
 * that OpenCode currently uses for the provider, while `auth.json` may still
 * hold an expired copy.
 *
 * `opencode` is the provider id of the OpenCode Console integration. It is
 * checked after `opencode-go` in both stores.
 */

/** Provider ids to check, in priority order. */
const PROVIDER_IDS = ["opencode-go", "opencode"] as const

/** Candidate OpenCode data directories, most specific first. */
export function dataDirectories(): string[] {
  const dirs: string[] = []
  const env = process.env

  if (env.XDG_DATA_HOME) dirs.push(join(env.XDG_DATA_HOME, "opencode"))
  dirs.push(join(homedir(), ".local", "share", "opencode"))
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, "opencode"))
  if (env.APPDATA) dirs.push(join(env.APPDATA, "opencode"))
  dirs.push(join(homedir(), "Library", "Application Support", "opencode"))

  return [...new Set(dirs)]
}

/** Pull the first usable credential string out of an auth store entry. */
export function extractCredential(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined

  // Older layouts can store several accounts for one provider.
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractCredential(item)
      if (found) return found
    }
    return undefined
  }

  const entry = value as Record<string, unknown>
  // OAuth entries carry short-lived access tokens, not API keys.
  if (entry.type === "oauth") return undefined

  for (const field of ["key", "apiKey", "access", "token"]) {
    const candidate = entry[field]
    if (typeof candidate === "string" && candidate.length > 0) return candidate
  }
  return undefined
}

async function fromEnvironment(): Promise<string | undefined> {
  const value = process.env.OPENCODE_GO_API_KEY
  return value && value.length > 0 ? value : undefined
}

async function fromDatabase(directory: string): Promise<string | undefined> {
  let Database: typeof import("bun:sqlite").Database
  try {
    ;({ Database } = await import("bun:sqlite"))
  } catch {
    return undefined
  }

  let db: import("bun:sqlite").Database | undefined
  try {
    db = new Database(join(directory, "opencode.db"), { readonly: true })
    const statement = db.query("select value from credential where integration_id = ? and active = 1 limit 1")

    for (const providerID of PROVIDER_IDS) {
      const row = statement.get(providerID) as { value?: string } | null
      if (!row?.value) continue

      const credential = extractCredential(JSON.parse(row.value))
      if (credential) return credential
    }

    return undefined
  } catch {
    return undefined
  } finally {
    try {
      db?.close()
    } catch {
      // best effort
    }
  }
}

async function fromAuthFile(directory: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(directory, "auth.json"), "utf8")
    const store = JSON.parse(raw) as Record<string, unknown>

    for (const providerID of PROVIDER_IDS) {
      const credential = extractCredential(store[providerID])
      if (credential) return credential
    }

    return undefined
  } catch {
    return undefined
  }
}

/** Resolve an OpenCode Go API key, or `undefined` when none is available. */
export async function resolveApiKey(directories: string[] = dataDirectories()): Promise<string | undefined> {
  const fromEnv = await fromEnvironment()
  if (fromEnv) return fromEnv

  for (const directory of directories) {
    const fromDb = await fromDatabase(directory)
    if (fromDb) return fromDb
  }

  for (const directory of directories) {
    const fromFile = await fromAuthFile(directory)
    if (fromFile) return fromFile
  }

  return undefined
}
