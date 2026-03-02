import "server-only";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://app_user:app_password@localhost:5432/daily_report";

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  max: 5,
});

// ---------------------------------------------------------------------------
// Supabase-compatible query builder backed by a local PostgreSQL pool.
// Only the subset of the PostgREST API used by this project is implemented.
// ---------------------------------------------------------------------------

type FilterOp = "eq" | "gt" | "gte" | "lt" | "lte";

interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}

interface OrderClause {
  column: string;
  ascending: boolean;
}

interface JoinDef {
  table: string;
  columns: string[];
}

type Operation = "select" | "insert" | "update" | "delete" | "upsert";

class QueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private _table: string;
  private _op: Operation = "select";
  private _columns: string = "*";
  private _filters: Filter[] = [];
  private _orders: OrderClause[] = [];
  private _single = false;
  private _payload: Record<string, unknown> | null = null;
  private _onConflict: string | null = null;
  private _returning: string | null = null; // columns to RETURNING after insert/update/upsert
  private _join: JoinDef | null = null;

  constructor(table: string) {
    this._table = table;
  }

  /* ---- column selection ---- */

  select(columns?: string): this {
    if (this._op === "insert" || this._op === "update" || this._op === "upsert") {
      // .insert(...).select("cols") → RETURNING
      this._returning = columns || "*";
      return this;
    }
    this._op = "select";
    if (columns) {
      // Parse join syntax: "user_id, expires_at, users(id, employee_id, name, role)"
      const joinMatch = columns.match(/(\w+)\(([^)]+)\)/);
      if (joinMatch) {
        this._join = {
          table: joinMatch[1],
          columns: joinMatch[2].split(",").map((c) => c.trim()),
        };
        // Remove join part from columns
        this._columns = columns
          .replace(/,?\s*\w+\([^)]+\)/, "")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
          .join(", ");
      } else {
        this._columns = columns;
      }
    }
    return this;
  }

  /* ---- mutations ---- */

  insert(data: Record<string, unknown>): this {
    this._op = "insert";
    this._payload = data;
    return this;
  }

  update(data: Record<string, unknown>): this {
    this._op = "update";
    this._payload = data;
    return this;
  }

  upsert(
    data: Record<string, unknown>,
    opts?: { onConflict?: string },
  ): this {
    this._op = "upsert";
    this._payload = data;
    this._onConflict = opts?.onConflict ?? null;
    return this;
  }

  delete(): this {
    this._op = "delete";
    return this;
  }

  /* ---- filters ---- */

  eq(column: string, value: unknown): this {
    this._filters.push({ column, op: "eq", value });
    return this;
  }
  gt(column: string, value: unknown): this {
    this._filters.push({ column, op: "gt", value });
    return this;
  }
  gte(column: string, value: unknown): this {
    this._filters.push({ column, op: "gte", value });
    return this;
  }
  lt(column: string, value: unknown): this {
    this._filters.push({ column, op: "lt", value });
    return this;
  }
  lte(column: string, value: unknown): this {
    this._filters.push({ column, op: "lte", value });
    return this;
  }

  /* ---- ordering ---- */

  order(column: string, opts?: { ascending?: boolean }): this {
    this._orders.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }

  /* ---- single row ---- */

  single(): this {
    this._single = true;
    return this;
  }

  /* ---- execution ---- */

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this._execute().then(onfulfilled, onrejected);
  }

  private async _execute(): Promise<{ data: any; error: any }> {
    try {
      switch (this._op) {
        case "select":
          return await this._execSelect();
        case "insert":
          return await this._execInsert();
        case "update":
          return await this._execUpdate();
        case "delete":
          return await this._execDelete();
        case "upsert":
          return await this._execUpsert();
        default:
          return { data: null, error: { message: "Unknown operation", code: "" } };
      }
    } catch (err: any) {
      return {
        data: null,
        error: {
          message: err.message ?? String(err),
          code: err.code ?? "",
          details: err.detail ?? "",
          hint: err.hint ?? "",
        },
      };
    }
  }

  /* ---- helpers ---- */

  private _opMap: Record<FilterOp, string> = {
    eq: "=",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  };

  private _buildWhere(paramOffset = 0): { text: string; values: unknown[] } {
    if (this._filters.length === 0) return { text: "", values: [] };
    const parts: string[] = [];
    const values: unknown[] = [];
    for (const f of this._filters) {
      const idx = paramOffset + values.length + 1;
      const col = this._join ? `${this._table}.${f.column}` : f.column;
      parts.push(`${col} ${this._opMap[f.op]} $${idx}`);
      values.push(f.value);
    }
    return { text: `WHERE ${parts.join(" AND ")}`, values };
  }

  private _buildOrder(): string {
    if (this._orders.length === 0) return "";
    return (
      "ORDER BY " +
      this._orders.map((o) => `${o.column} ${o.ascending ? "ASC" : "DESC"}`).join(", ")
    );
  }

  /* ---- per-operation executors ---- */

  private async _execSelect(): Promise<{ data: any; error: any }> {
    let selectCols: string;
    let fromClause: string;

    if (this._join) {
      // Build JOIN query
      // e.g. sessions JOIN users ON sessions.user_id = users.id
      const mainCols = this._columns
        .split(",")
        .map((c) => `${this._table}.${c.trim()}`)
        .join(", ");
      const joinCols = this._join.columns
        .map((c) => `${this._join!.table}.${c.trim()}`)
        .join(", ");
      selectCols = `${mainCols}, ${joinCols}`;
      // Determine the FK column: assume <join_table_singular>_id or user_id
      const fk = `${this._join.table.replace(/s$/, "")}_id`;
      fromClause = `${this._table} JOIN ${this._join.table} ON ${this._table}.${fk} = ${this._join.table}.id`;
    } else {
      selectCols = this._columns;
      fromClause = this._table;
    }

    const where = this._buildWhere();
    const order = this._buildOrder();
    const limit = this._single ? "LIMIT 1" : "";

    const sql = `SELECT ${selectCols} FROM ${fromClause} ${where.text} ${order} ${limit}`.trim();
    const result = await pool.query(sql, where.values);

    if (this._single) {
      if (result.rows.length === 0) {
        return {
          data: null,
          error: { message: "Row not found", code: "PGRST116", details: "", hint: "" },
        };
      }
      let row = result.rows[0];
      // Nest join columns under join table name
      if (this._join) {
        const nested: Record<string, unknown> = {};
        for (const col of this._join.columns) {
          nested[col] = row[col];
        }
        const mainRow: Record<string, unknown> = {};
        for (const col of this._columns.split(",").map((c) => c.trim())) {
          mainRow[col] = row[col];
        }
        mainRow[this._join.table] = nested;
        row = mainRow;
      }
      return { data: row, error: null };
    }

    return { data: result.rows, error: null };
  }

  private async _execInsert(): Promise<{ data: any; error: any }> {
    const data = this._payload!;
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const returning = this._returning ? `RETURNING ${this._returning}` : "";

    const sql = `INSERT INTO ${this._table} (${keys.join(", ")}) VALUES (${placeholders}) ${returning}`;
    const result = await pool.query(sql, values);

    if (this._returning) {
      const row = this._single ? result.rows[0] ?? null : result.rows;
      return { data: row, error: null };
    }
    return { data: null, error: null };
  }

  private async _execUpdate(): Promise<{ data: any; error: any }> {
    if (this._filters.length === 0) {
      throw new Error("UPDATE requires at least one filter condition to prevent accidental full-table update");
    }
    const data = this._payload!;
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");

    const where = this._buildWhere(keys.length);
    const returning = this._returning ? `RETURNING ${this._returning}` : "";

    const sql = `UPDATE ${this._table} SET ${setClauses} ${where.text} ${returning}`;
    const result = await pool.query(sql, [...values, ...where.values]);

    if (this._returning) {
      const row = this._single ? result.rows[0] ?? null : result.rows;
      return { data: row, error: null };
    }
    return { data: null, error: null };
  }

  private async _execDelete(): Promise<{ data: any; error: any }> {
    if (this._filters.length === 0) {
      throw new Error("DELETE requires at least one filter condition to prevent accidental full-table deletion");
    }
    const where = this._buildWhere();
    const sql = `DELETE FROM ${this._table} ${where.text}`;
    await pool.query(sql, where.values);
    return { data: null, error: null };
  }

  private async _execUpsert(): Promise<{ data: any; error: any }> {
    const data = this._payload!;
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const conflictCols = this._onConflict ?? keys[0];
    const conflictKeys = conflictCols.split(",").map((c) => c.trim());
    const updateKeys = keys.filter((k) => !conflictKeys.includes(k));
    const updateClauses = updateKeys.map((k) => `${k} = EXCLUDED.${k}`).join(", ");
    const returning = this._returning ? `RETURNING ${this._returning}` : "";

    const sql = `INSERT INTO ${this._table} (${keys.join(", ")}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateClauses} ${returning}`;
    const result = await pool.query(sql, values);

    if (this._returning) {
      const row = this._single ? result.rows[0] ?? null : result.rows;
      return { data: row, error: null };
    }
    return { data: null, error: null };
  }
}

/**
 * Supabase 互換クエリクライアント (ローカル PostgreSQL 接続)。
 * service_role key を使った Supabase クライアントと同じ API を提供する。
 */
export const supabase = {
  from(table: string): QueryBuilder {
    return new QueryBuilder(table);
  },
};
