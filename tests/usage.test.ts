import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { fetchUsage } from "../src/usage.ts"

const PAYLOAD = {
  usage: {
    rolling: { percent: 10, resetsAt: "2030-01-01T05:00:00.000Z" },
    weekly: { percent: 20 },
    monthly: { percent: 30 },
  },
}

const initialApiKey = process.env.OPENCODE_GO_API_KEY
const temporaryDirectories: string[] = []

let fetchSpy: ReturnType<typeof spyOn> | undefined
let keys: string[] = []

beforeEach(() => {
  delete process.env.OPENCODE_GO_API_KEY
  keys = []
})

afterEach(async () => {
  fetchSpy?.mockRestore()
  fetchSpy = undefined
  if (initialApiKey === undefined) delete process.env.OPENCODE_GO_API_KEY
  else process.env.OPENCODE_GO_API_KEY = initialApiKey

  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function store(content: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opencode-go-usage-"))
  temporaryDirectories.push(directory)
  await writeFile(join(directory, "auth.json"), JSON.stringify(content))
  return directory
}

/** Records the credential of each request and answers with `reply`. */
function mockFetch(reply: (key: string, call: number) => Response | Promise<Response>) {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input: unknown, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get("Authorization") ?? ""
    const key = authorization.replace(/^Bearer /, "")
    keys.push(key)
    return reply(key, keys.length)
  }) as typeof fetch)
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

describe("fetchUsage credential fallback", () => {
  test("returns the usage of the first candidate", async () => {
    const directory = await store({ "opencode-go": { key: "single-key" } })
    mockFetch(() => json(200, PAYLOAD))

    const result = await fetchUsage([directory])

    expect(result).toEqual({ ok: true, usage: PAYLOAD.usage })
    expect(keys).toEqual(["single-key"])
  })

  test("moves to the next candidate when one is rejected", async () => {
    const directory = await store({ "opencode-go": { key: "first-key" }, opencode: { key: "second-key" } })
    mockFetch((key) => (key === "first-key" ? json(401, {}) : json(200, PAYLOAD)))

    const result = await fetchUsage([directory])

    expect(result.ok).toBe(true)
    expect(keys).toEqual(["first-key", "second-key"])
  })

  test("reports credential rejected when every candidate is rejected", async () => {
    const directory = await store({ "opencode-go": { key: "reject-a" }, opencode: { key: "reject-b" } })
    mockFetch(() => json(401, {}))

    expect(await fetchUsage([directory])).toEqual({ ok: false, error: "credential rejected" })
    expect(keys).toEqual(["reject-a", "reject-b"])
  })

  test("stops on a non-401 failure", async () => {
    const directory = await store({ "opencode-go": { key: "limited-a" }, opencode: { key: "limited-b" } })
    mockFetch(() => json(429, {}))

    expect(await fetchUsage([directory])).toEqual({ ok: false, error: "rate limited" })
    expect(keys).toEqual(["limited-a"])
  })

  test("stops on a network error", async () => {
    const directory = await store({ "opencode-go": { key: "offline-a" }, opencode: { key: "offline-b" } })
    mockFetch(() => {
      throw new TypeError("fetch failed")
    })

    expect(await fetchUsage([directory])).toEqual({ ok: false, error: "network error" })
    expect(keys).toEqual(["offline-a"])
  })

  test("reports no credential found without a request", async () => {
    const directory = await store({})
    mockFetch(() => json(200, PAYLOAD))

    expect(await fetchUsage([directory])).toEqual({ ok: false, error: "no credential found" })
    expect(keys).toEqual([])
  })

  test("tries the last working candidate first", async () => {
    const directory = await store({ "opencode-go": { key: "cache-a" }, opencode: { key: "cache-b" } })
    mockFetch((key) => (key === "cache-a" ? json(401, {}) : json(200, PAYLOAD)))

    expect((await fetchUsage([directory])).ok).toBe(true)
    expect(keys).toEqual(["cache-a", "cache-b"])

    keys = []
    expect((await fetchUsage([directory])).ok).toBe(true)
    expect(keys).toEqual(["cache-b"])
  })
})
