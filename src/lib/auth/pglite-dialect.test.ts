import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CompiledQuery, type DatabaseConnection } from "kysely";
import { pgliteDialect, pgliteQueryResult } from "./pglite-dialect.ts";

describe("pgliteQueryResult", () => {
  it("reports a zero-row UPDATE as zero affected rows", () => {
    const result = pgliteQueryResult({
      command: "UPDATE",
      affectedRows: 0,
      rows: [],
    });
    assert.equal(result.numAffectedRows, 0n);
  });

  it("does not mark a SELECT as a mutation just because affectedRows is 0", () => {
    const result = pgliteQueryResult({
      command: "SELECT",
      affectedRows: 0,
      rows: [{ n: 1 }],
    });
    assert.equal(result.numAffectedRows, undefined);
    assert.deepEqual(result.rows, [{ n: 1 }]);
  });

  it("keeps a positive count when a fake result has no command tag", () => {
    const result = pgliteQueryResult({ affectedRows: 3, rows: [] });
    assert.equal(result.numAffectedRows, 3n);
  });
});

describe("LazyPGliteDriver checkout", () => {
  function driverFor(
    getClient: () => Promise<{ query: () => Promise<{ rows: [] }> }> | { query: () => Promise<{ rows: [] }> },
  ) {
    return pgliteDialect(getClient as never).createDriver();
  }

  const client = { async query() { return { rows: [] as [] }; } };

  it("does not hand out two connections when getClient is still in flight", async () => {
    let release!: (value: typeof client) => void;
    const pending = new Promise<typeof client>((resolve) => {
      release = resolve;
    });
    const driver = driverFor(() => pending);
    const first = driver.acquireConnection();
    const second = driver.acquireConnection();
    release(client);
    const a = await first;
    let secondSettled = false;
    const secondDone = second.then((conn) => {
      secondSettled = true;
      return conn;
    });
    await Promise.resolve();
    assert.equal(secondSettled, false);
    await driver.releaseConnection(a);
    const b = await secondDone;
    assert.equal(a, b);
    await driver.releaseConnection(b);
  });

  it("rejects waiters when the driver is destroyed", async () => {
    const driver = driverFor(async () => client);
    const held = await driver.acquireConnection();
    const waiting = driver.acquireConnection();
    await driver.destroy();
    await assert.rejects(waiting, /destroyed/);
    await assert.rejects(driver.releaseConnection(held), /Invalid connection/);
  });

  it("maps a zero-row update through executeQuery", async () => {
    const updating = {
      async query() {
        return { command: "UPDATE", affectedRows: 0, rows: [] as [] };
      },
    };
    const driver = driverFor(async () => updating);
    const conn = (await driver.acquireConnection()) as DatabaseConnection;
    const result = await conn.executeQuery(CompiledQuery.raw("update t set n = 1 where false"));
    assert.equal(result.numAffectedRows, 0n);
    await driver.releaseConnection(conn);
    await driver.destroy();
  });
});
