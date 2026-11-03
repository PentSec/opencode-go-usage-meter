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
 *
 * A provider entry can be an API key or an OAuth entry. An OAuth entry
 * contributes its `access` token unless it carries a numeric expiry that is
 * already past; an entry with no usable expiry is tried, because a stale token
 * only costs one rejected request. The caller tries the candidates in order and
 * moves on when one is rejected.
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
export function extractCredential(value: unknown, now: number = Date.now()): string | undefined {
  if (!value || typeof value !== "object") return undefined

  // Older layouts can store several accounts for one provider.
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractCredential(item, now)
      if (found) return found
    }
    return undefined
  }

  const entry = value as Record<string, unknown>
  if (entry.type === "oauth") {
    // Short-lived tokens are usable until they expire, and a stale one only
    // costs a rejected request.
    const expires = entry.expires
    if (typeof expires === "number" && Number.isFinite(expires) && expires <= now) return undefined

    const access = entry.access
    return typeof access === "string" && access.length > 0 ? access : undefined
  }

  for (const field of ["key", "apiKey", "access", "token"]) {
    const candidate = entry[field]
    if (typeof candidate === "string" && candidate.length > 0) return candidate
  }
  return undefined
}

/** Environment override, when it is set and non-empty. */
export async function resolveEnvironmentKey(): Promise<string | undefined> {
  const value = process.env.OPENCODE_GO_API_KEY
  return value && value.length > 0 ? value : undefined
}

async function fromDatabase(directory: string): Promise<string[]> {
  let Database: typeof import("bun:sqlite").Database
  try {
    ;({ Database } = await import("bun:sqlite"))
  } catch {
    return []
  }

  let db: import("bun:sqlite").Database | undefined
  try {
    db = new Database(join(directory, "opencode.db"), { readonly: true })
    // `active` is nullable with no default. Legacy rows store NULL, which means
    // the credential is active; an explicit 1 wins when both shapes coexist.
    const statement = db.query(
      "select value from credential where integration_id = ? and coalesce(active, 1) = 1 " +
        "order by (active is 1) desc limit 1",
    )

    const found: string[] = []
    for (const providerID of PROVIDER_IDS) {
      const row = statement.get(providerID) as { value?: string } | null
      if (!row?.value) continue

      // One unreadable row must not discard the rows already collected.
      let value: unknown
      try {
        value = JSON.parse(row.value)
      } catch {
        continue
      }

      const credential = extractCredential(value)
      if (credential) found.push(credential)
    }

    return found
  } catch {
    return []
  } finally {
    try {
      db?.close()
    } catch {
      // best effort
    }
  }
}

async function fromAuthFile(directory: string): Promise<string[]> {
  try {
    const raw = await readFile(join(directory, "auth.json"), "utf8")
    const store = JSON.parse(raw) as Record<string, unknown>

    const found: string[] = []
    for (const providerID of PROVIDER_IDS) {
      const credential = extractCredential(store[providerID])
      if (credential) found.push(credential)
    }

    return found
  } catch {
    return []
  }
}

/**
 * Resolve the stored credentials, database before `auth.json` for each data
 * directory. Deduplicated, in priority order.
 *
 * Keeping this separate from the environment key lets the caller avoid touching
 * the stores at all while the environment key still works.
 */
export async function resolveStoredApiKeys(directories: string[] = dataDirectories()): Promise<string[]> {
  const candidates: string[] = []

  for (const directory of directories) candidates.push(...(await fromDatabase(directory)))
  for (const directory of directories) candidates.push(...(await fromAuthFile(directory)))

  return [...new Set(candidates)]
}

/**
 * Resolve every usable credential, most authoritative first.
 *
 * Order: environment, then the database for each data directory, then
 * `auth.json` for each data directory. Duplicates are removed, so a key stored
 * in both places is tried once.
 */
export async function resolveApiKeys(directories: string[] = dataDirectories()): Promise<string[]> {
  const candidates: string[] = []

  const fromEnv = await resolveEnvironmentKey()
  if (fromEnv) candidates.push(fromEnv)
  candidates.push(...(await resolveStoredApiKeys(directories)))

  return [...new Set(candidates)]
}

/** Resolve the first OpenCode Go credential, or `undefined` when none is available. */
export async function resolveApiKey(directories: string[] = dataDirectories()): Promise<string | undefined> {
  return (await resolveApiKeys(directories))[0]
}
