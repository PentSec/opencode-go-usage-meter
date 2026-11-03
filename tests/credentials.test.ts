import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { extractCredential, resolveApiKey, resolveApiKeys } from "../src/credentials.ts"

const initialApiKey = process.env.OPENCODE_GO_API_KEY
const temporaryDirectories: string[] = []

type CredentialRow = {
  integrationId: string
  value?: unknown
  /** Raw column text, used to store unparseable JSON. */
  raw?: string
  active?: boolean | null
}

beforeEach(() => {
  delete process.env.OPENCODE_GO_API_KEY
})

afterEach(async () => {
  if (initialApiKey === undefined) delete process.env.OPENCODE_GO_API_KEY
  else process.env.OPENCODE_GO_API_KEY = initialApiKey

  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opencode-go-credentials-"))
  temporaryDirectories.push(directory)
  return directory
}

async function writeAuthFile(directory: string, store: unknown): Promise<void> {
  await writeFile(join(directory, "auth.json"), JSON.stringify(store))
}

function writeDatabase(directory: string, rows: CredentialRow[]): void {
  const database = new Database(join(directory, "opencode.db"))
  try {
    database.run("create table credential (integration_id text not null, value text not null, active integer)")
    const insert = database.query("insert into credential (integration_id, value, active) values (?, ?, ?)")
    for (const row of rows) {
      insert.run(
        row.integrationId,
        row.raw ?? JSON.stringify(row.value),
        row.active === undefined ? 1 : row.active === null ? null : row.active ? 1 : 0,
      )
    }
  } finally {
    database.close()
  }
}

describe("extractCredential", () => {
  test("reads every supported credential field", () => {
    expect(extractCredential({ key: "from-key" })).toBe("from-key")
    expect(extractCredential({ apiKey: "from-api-key" })).toBe("from-api-key")
    expect(extractCredential({ access: "from-access" })).toBe("from-access")
    expect(extractCredential({ token: "from-token" })).toBe("from-token")
  })

  test("prefers key over the legacy fields", () => {
    expect(
      extractCredential({ token: "token", access: "access", apiKey: "api-key", key: "key" }),
    ).toBe("key")
  })

  test("returns the first usable entry from an array", () => {
    expect(
      extractCredential([null, {}, { key: "" }, { apiKey: "second" }, { key: "third" }]),
    ).toBe("second")
  })

  test("reads the access token of an unexpired OAuth entry", () => {
    expect(extractCredential({ type: "oauth", access: "oauth-token", expires: Date.now() + 60_000 })).toBe(
      "oauth-token",
    )
    expect(extractCredential({ type: "oauth", access: "oauth-token" })).toBe("oauth-token")
  })

  test("skips an expired OAuth entry", () => {
    expect(extractCredential({ type: "oauth", access: "oauth-token", expires: Date.now() - 1_000 })).toBeUndefined()
  })

  test("treats a non-numeric expires as no expiry", () => {
    expect(extractCredential({ type: "oauth", access: "oauth-token", expires: "tomorrow" })).toBe("oauth-token")
  })

  test("skips an OAuth entry without an access token", () => {
    expect(extractCredential({ type: "oauth", refresh: "refresh-token" })).toBeUndefined()
    expect(extractCredential({ type: "oauth", access: "" })).toBeUndefined()
  })

  test("continues past an expired OAuth entry inside arrays", () => {
    expect(
      extractCredential([
        { type: "oauth", access: "expired", expires: Date.now() - 1_000 },
        { key: "api-key" },
      ]),
    ).toBe("api-key")
  })

  test("ignores non-objects and empty values", () => {
    expect(extractCredential(undefined)).toBeUndefined()
    expect(extractCredential(null)).toBeUndefined()
    expect(extractCredential("key")).toBeUndefined()
    expect(extractCredential(42)).toBeUndefined()
    expect(extractCredential({})).toBeUndefined()
    expect(extractCredential({ key: "" })).toBeUndefined()
  })
})

describe("resolveApiKey", () => {
  test("returns OPENCODE_GO_API_KEY before any stored credential", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [{ integrationId: "opencode-go", value: { key: "database-key" } }])
    await writeAuthFile(directory, { "opencode-go": { key: "auth-key" } })

    process.env.OPENCODE_GO_API_KEY = "environment-key"

    expect(await resolveApiKey([directory])).toBe("environment-key")
  })

  test("falls through an empty environment variable", async () => {
    const directory = await makeDirectory()
    await writeAuthFile(directory, { "opencode-go": { key: "auth-key" } })

    process.env.OPENCODE_GO_API_KEY = ""

    expect(await resolveApiKey([directory])).toBe("auth-key")
  })

  test("prefers the active opencode-go database credential over opencode", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [
      { integrationId: "opencode-go", value: { key: "go-key" } },
      { integrationId: "opencode", value: { key: "console-key" } },
    ])

    expect(await resolveApiKey([directory])).toBe("go-key")
  })

  test("falls back to the active opencode Console database credential", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [{ integrationId: "opencode", value: { key: "console-key" } }])

    expect(await resolveApiKey([directory])).toBe("console-key")
  })

  test("ignores inactive database rows", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [
      { integrationId: "opencode-go", value: { key: "inactive-go-key" }, active: false },
      { integrationId: "opencode", value: { key: "active-console-key" } },
    ])

    expect(await resolveApiKey([directory])).toBe("active-console-key")
  })

  test("skips an expired OAuth database entry and continues to the next provider", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [
      { integrationId: "opencode-go", value: { type: "oauth", access: "oauth-token", expires: Date.now() - 1_000 } },
      { integrationId: "opencode", value: { key: "console-key" } },
    ])

    expect(await resolveApiKey([directory])).toBe("console-key")
  })

  test("reads a legacy row whose active column is NULL", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [{ integrationId: "opencode-go", value: { key: "legacy-key" }, active: null }])

    expect(await resolveApiKey([directory])).toBe("legacy-key")
  })

  test("prefers an explicit active row over a legacy NULL row", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [
      { integrationId: "opencode-go", value: { key: "legacy-key" }, active: null },
      { integrationId: "opencode-go", value: { key: "active-key" }, active: true },
    ])

    expect(await resolveApiKey([directory])).toBe("active-key")
  })

  test("prefers the database over auth.json", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [{ integrationId: "opencode", value: { key: "console-database-key" } }])
    await writeAuthFile(directory, { "opencode-go": { key: "auth-key" } })

    expect(await resolveApiKey([directory])).toBe("console-database-key")
  })

  test("reads the opencode-go credential from auth.json", async () => {
    const directory = await makeDirectory()
    await writeAuthFile(directory, { "opencode-go": { key: "auth-go-key" } })

    expect(await resolveApiKey([directory])).toBe("auth-go-key")
  })

  test("falls back to the opencode Console credential in auth.json", async () => {
    const directory = await makeDirectory()
    await writeAuthFile(directory, { opencode: { key: "auth-console-key" } })

    expect(await resolveApiKey([directory])).toBe("auth-console-key")
  })

  test("prefers opencode-go over opencode inside auth.json", async () => {
    const directory = await makeDirectory()
    await writeAuthFile(directory, {
      "opencode-go": { key: "auth-go-key" },
      opencode: { key: "auth-console-key" },
    })

    expect(await resolveApiKey([directory])).toBe("auth-go-key")
  })

  test("skips an expired OAuth auth.json entry and continues to the next provider", async () => {
    const directory = await makeDirectory()
    await writeAuthFile(directory, {
      "opencode-go": { type: "oauth", access: "oauth-token", expires: Date.now() - 1_000 },
      opencode: { key: "auth-console-key" },
    })

    expect(await resolveApiKey([directory])).toBe("auth-console-key")
  })

  test("orders candidates as environment, database, then auth.json", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [
      { integrationId: "opencode-go", value: { key: "go-database" } },
      { integrationId: "opencode", value: { type: "oauth", access: "console-oauth", expires: Date.now() + 60_000 } },
    ])
    await writeAuthFile(directory, { opencode: { key: "console-auth" } })
    process.env.OPENCODE_GO_API_KEY = "environment-key"

    expect(await resolveApiKeys([directory])).toEqual([
      "environment-key",
      "go-database",
      "console-oauth",
      "console-auth",
    ])
  })

  test("removes duplicate candidates", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [{ integrationId: "opencode-go", value: { key: "same-key" } }])
    await writeAuthFile(directory, { "opencode-go": { key: "same-key" } })

    expect(await resolveApiKeys([directory])).toEqual(["same-key"])
  })

  test("resolveApiKey returns the first candidate", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [
      { integrationId: "opencode-go", value: { key: "go-database" } },
      { integrationId: "opencode", value: { key: "console-database" } },
    ])

    expect(await resolveApiKey([directory])).toBe("go-database")
  })

  test("keeps an earlier row when a later row is unparseable", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [
      { integrationId: "opencode-go", value: { key: "good-key" } },
      { integrationId: "opencode", raw: "not-json" },
    ])

    expect(await resolveApiKey([directory])).toBe("good-key")
  })

  test("continues past an unparseable row to the next provider", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [
      { integrationId: "opencode-go", raw: "{broken" },
      { integrationId: "opencode", value: { key: "fallback-key" } },
    ])

    expect(await resolveApiKey([directory])).toBe("fallback-key")
  })

  test("returns undefined when the stores are missing", async () => {
    const directory = await makeDirectory()
    expect(await resolveApiKey([directory])).toBeUndefined()
    expect(await resolveApiKey([join(directory, "missing")])).toBeUndefined()
  })

  test("returns undefined when the stores hold no usable credential", async () => {
    const directory = await makeDirectory()
    writeDatabase(directory, [{ integrationId: "other-provider", value: { key: "other-key" } }])
    await writeAuthFile(directory, { "opencode-go": { key: "" }, opencode: { type: "oauth" } })

    expect(await resolveApiKey([directory])).toBeUndefined()
  })
})
