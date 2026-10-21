/** Minimal typings for the runtime-provided `bun:sqlite` module. */
declare module "bun:sqlite" {
  export interface Statement {
    get(...params: unknown[]): unknown
  }

  export class Database {
    constructor(filename: string, options?: { readonly?: boolean })
    query(sql: string): Statement
    close(): void
  }
}
