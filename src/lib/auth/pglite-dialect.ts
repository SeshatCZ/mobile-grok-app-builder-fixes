/**
 * Kysely dialect for Better Auth over the app's embedded PGLite instance.
 * Lazy: resolves `getClient` on first connection so migrations can finish first.
 */
import type { PGlite } from "@electric-sql/pglite";
import {
  CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type Driver,
  type Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryCompiler,
  type QueryResult,
  type TransactionSettings,
} from "kysely";

type Client = PGlite;

type Waiter = {
  resolve: (connection: DatabaseConnection) => void;
  reject: (err: Error) => void;
};

type AcquireBox =
  | { kind: "conn"; conn: DatabaseConnection }
  | { kind: "wait"; wait: Promise<DatabaseConnection> };

const MUTATING_COMMANDS = new Set(["INSERT", "UPDATE", "DELETE", "COPY", "MERGE"]);

/**
 * PGLite stamps `affectedRows` on every result, including SELECT (cumulative,
 * and 0 when nothing was written). Truthiness then hides a real UPDATE that
 * changed 0 rows — Kysely needs `numAffectedRows: 0n` to tell that apart from
 * a read. The command tag is the signal; the count is not.
 */
export function pgliteQueryResult<O>(result: {
  rows?: readonly unknown[];
  affectedRows?: number;
  command?: string;
}): QueryResult<O> {
  const rows = [...(result.rows ?? [])] as O[];
  if (result.command && MUTATING_COMMANDS.has(result.command)) {
    const n = typeof result.affectedRows === "number" ? result.affectedRows : 0;
    return { numAffectedRows: BigInt(n), rows };
  }
  // Older callers / fakes that only set a positive count.
  if (
    !result.command &&
    typeof result.affectedRows === "number" &&
    result.affectedRows > 0
  ) {
    return { numAffectedRows: BigInt(result.affectedRows), rows };
  }
  return { rows };
}

/** Factory used by `auth/server.ts`: `pgliteDialect(() => getPglite())`. */
export function pgliteDialect(
  getClient: () => Promise<Client> | Client,
): Dialect {
  return {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new LazyPGliteDriver(getClient),
    createQueryCompiler: (): QueryCompiler => new PostgresQueryCompiler(),
    createIntrospector: (db: Kysely<unknown>): DatabaseIntrospector =>
      new PostgresIntrospector(db),
  };
}

class LazyPGliteDriver implements Driver {
  private client: Client | undefined;
  private connection: PGliteConnection | undefined;
  private queue: Waiter[] = [];
  private destroyed = false;
  /** Serializes check-and-set. Must not await a queued checkout (that deadlocks release). */
  private tail: Promise<void> = Promise.resolve();

  private readonly getClient: () => Promise<Client> | Client;

  constructor(getClient: () => Promise<Client> | Client) {
    this.getClient = getClient;
  }

  private exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async init(): Promise<void> {
    await this.exclusive(async () => {
      if (this.destroyed || this.client !== undefined) return;
      this.client = await this.getClient();
    });
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    // The box is a plain object so `exclusive` settles when the slot is
    // reserved, not when the previous holder releases. Returning the waiter
    // promise itself would pin the mutex until release — and release needs
    // the same mutex.
    const boxed = await this.exclusive(async (): Promise<AcquireBox> => {
      if (this.destroyed) throw new Error("PGLite driver is destroyed");
      if (this.client === undefined) {
        this.client = await this.getClient();
      }
      if (this.destroyed) throw new Error("PGLite driver is destroyed");
      if (this.connection !== undefined) {
        let resolve!: Waiter["resolve"];
        let reject!: Waiter["reject"];
        const wait = new Promise<DatabaseConnection>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        this.queue.push({ resolve, reject });
        return { kind: "wait", wait };
      }
      this.connection = new PGliteConnection(this.client);
      return { kind: "conn", conn: this.connection };
    });
    return boxed.kind === "conn" ? boxed.conn : boxed.wait;
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    await this.exclusive(() => {
      if (connection !== this.connection) {
        throw new Error("Invalid connection");
      }
      const next = this.queue.shift();
      if (next === undefined) {
        this.connection = undefined;
        return;
      }
      next.resolve(this.connection);
    });
  }

  async beginTransaction(
    conn: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    const c = conn as PGliteConnection;
    if (settings.isolationLevel) {
      await c.executeQuery(
        CompiledQuery.raw(
          `start transaction isolation level ${settings.isolationLevel}`,
        ),
      );
    } else {
      await c.executeQuery(CompiledQuery.raw("begin"));
    }
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await (conn as PGliteConnection).executeQuery(CompiledQuery.raw("commit"));
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await (conn as PGliteConnection).executeQuery(
      CompiledQuery.raw("rollback"),
    );
  }

  async destroy(): Promise<void> {
    await this.exclusive(() => {
      // Do not close the client: it is the shared getPglite() singleton used by
      // app SQL (getSql). Only drop our local handle so auth teardown cannot
      // poison the rest of the process. Queued acquirers must reject — dropping
      // the array left those promises pending forever.
      this.destroyed = true;
      this.client = undefined;
      this.connection = undefined;
      const queued = this.queue.splice(0);
      for (const waiter of queued) {
        waiter.reject(new Error("PGLite driver is destroyed"));
      }
    });
  }
}

class PGliteConnection implements DatabaseConnection {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    const result = await this.client.query(compiledQuery.sql, [
      ...compiledQuery.parameters,
    ]);
    return pgliteQueryResult<O>(result);
  }

  async *streamQuery<O>(
    compiledQuery: CompiledQuery,
    chunkSize: number,
  ): AsyncIterableIterator<QueryResult<O>> {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
      throw new Error("chunkSize must be a positive integer");
    }
    const result = await this.client.query(compiledQuery.sql, [
      ...compiledQuery.parameters,
    ]);
    for (let i = 0; i < result.rows.length; i += chunkSize) {
      yield { rows: result.rows.slice(i, i + chunkSize) as O[] };
    }
  }
}
