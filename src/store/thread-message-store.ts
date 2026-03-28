import { getDatabaseMode, getPool } from "../infrastructure/database.js";
import { ThreadMessage } from "../types/travel.js";

export type StoredThreadMessage = ThreadMessage & {
  threadId: string;
};

let setupPromise: Promise<void> | null = null;

async function setupPostgresTables() {
  if (getDatabaseMode() !== "postgres") {
    return;
  }

  const pool = getPool();
  if (!pool) {
    return;
  }

  const schema = process.env.POSTGRES_SCHEMA || "public";
  await pool.query(`create schema if not exists ${schema}`);
  await pool.query(`
    create table if not exists ${schema}.thread_messages (
      id bigserial primary key,
      thread_id text not null,
      role text not null,
      content text not null,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create index if not exists thread_messages_thread_id_created_at_idx
    on ${schema}.thread_messages (thread_id, created_at)
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupPostgresTables();
  }

  return setupPromise;
}

export async function appendThreadMessages(threadId: string, messages: ThreadMessage[]) {
  if (!messages.length || getDatabaseMode() !== "postgres") {
    return;
  }

  await ensureSetup();
  const pool = getPool();
  if (!pool) {
    return;
  }

  const schema = process.env.POSTGRES_SCHEMA || "public";
  const values: Array<string> = [];
  const params: Array<string> = [];

  messages.forEach((message, index) => {
    const base = index * 4;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    params.push(threadId, message.role, message.content, message.createdAt);
  });

  await pool.query(
    `insert into ${schema}.thread_messages (thread_id, role, content, created_at) values ${values.join(", ")}`,
    params
  );
}

export async function getThreadMessages(threadId: string) {
  if (getDatabaseMode() !== "postgres") {
    return null;
  }

  await ensureSetup();
  const pool = getPool();
  if (!pool) {
    return null;
  }

  const schema = process.env.POSTGRES_SCHEMA || "public";
  const result = await pool.query<{
    thread_id: string;
    role: "user" | "agent";
    content: string;
    created_at: Date | string;
  }>(
    `select thread_id, role, content, created_at
     from ${schema}.thread_messages
     where thread_id = $1
     order by created_at asc, id asc`,
    [threadId]
  );

  return result.rows.map((row) => ({
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  }));
}
