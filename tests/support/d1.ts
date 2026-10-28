import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * 用 Node 自带的 SQLite 模拟 D1 里我们用到的那部分 API（prepare/bind/first/all/run/batch）。
 * D1 就是 SQLite，所以 SQL 语义一致；batch 用事务包起来，和 D1 一样要么全成要么全不成。
 */
type Value = string | number | null | boolean | undefined | bigint | Uint8Array;

const toSql = (value: Value): SQLInputValue => {
  if (value === undefined) return null;
  if (typeof value === "boolean") return Number(value);
  return value as SQLInputValue;
};

const returnsRows = (sql: string) => /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: Value[] = [],
  ) {}

  bind(...params: Value[]) {
    return new Statement(this.db, this.sql, params);
  }

  private exec() {
    const statement = this.db.prepare(this.sql);
    const params = this.params.map(toSql);
    if (returnsRows(this.sql)) {
      const rows = statement.all(...params) as Record<string, unknown>[];
      return { results: rows, changes: Number(this.db.prepare("SELECT changes() AS n").get()!.n) };
    }
    const result = statement.run(...params);
    return { results: [], changes: Number(result.changes) };
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.exec().results[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T>() {
    const { results, changes } = this.exec();
    return { results: results as T[], success: true, meta: { changes } };
  }

  async run() {
    const { results, changes } = this.exec();
    return { results, success: true, meta: { changes } };
  }

  runSync() {
    const { results, changes } = this.exec();
    return { results, success: true, meta: { changes } };
  }
}

export function createTestD1(migrations = path.join(import.meta.dirname, "..", "..", "migrations")): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(path.join(migrations, file), "utf8"));
  }
  const d1 = {
    raw: db,
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return d1 as unknown as D1Database & { raw: DatabaseSync };
}
