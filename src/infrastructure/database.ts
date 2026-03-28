import { Pool } from "pg";

let pool: Pool | null = null;

export function getDatabaseMode() {
  return process.env.POSTGRES_URL ? "postgres" : "memory";
}

export function getPool() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString
    });
  }

  return pool;
}

export async function checkDatabaseHealth() {
  if (!process.env.POSTGRES_URL) {
    return {
      ok: true,
      mode: "memory" as const,
      details: "POSTGRES_URL 未配置，当前使用 MemorySaver。"
    };
  }

  const db = getPool();
  if (!db) {
    return {
      ok: false,
      mode: "postgres" as const,
      details: "Postgres 连接池初始化失败。"
    };
  }

  const result = await db.query("select 1 as ok");
  return {
    ok: result.rows[0]?.ok === 1,
    mode: "postgres" as const,
    details: "Postgres 可连接。"
  };
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
