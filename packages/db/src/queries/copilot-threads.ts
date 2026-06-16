/**
 * Copilot conversation persistence.
 *
 * Threads live in `copilot_threads` and messages in `copilot_messages`
 * (see migration 0018). Both tables are admin-private with deny-by-default
 * RLS — only service_role reads/writes them.
 *
 * Implementation note:
 *   We use direct pg (via SUPABASE_DB_URL) instead of the Supabase JS client
 *   because the typed `Database` schema is generated and doesn't know about
 *   these tables yet. Direct pg also gives cleaner SQL for the trigger-based
 *   `updated_at` bump (handled in the migration via copilot_touch_thread).
 *
 * Trimming policy:
 *   `loadThreadHistory()` returns at most MAX_HISTORY_TURNS (20) most-recent
 *   messages, ordered oldest → newest. The full transcript stays in the DB.
 *
 * Title heuristic:
 *   When a thread has no title and we just persisted the first user message,
 *   we set `title` to the first 80 chars of that message.
 */
import { Client } from 'pg'
import type { CopilotRole } from '../copilot-pg'

/** Mirror of @repo/ai ClaudeMessage — duplicated to avoid a db→ai dep cycle. */
export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

const MAX_HISTORY_TURNS = 20
const TITLE_MAX_CHARS = 80

export interface CopilotThread {
  thread_id: string
  admin_user_id: string
  role: CopilotRole
  title: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface CopilotMessageRow {
  message_id: string
  thread_id: string
  role: 'user' | 'assistant'
  content: string
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  context_snapshot: Record<string, unknown> | null
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────
// Connection helper
// ─────────────────────────────────────────────────────────────────────

async function withPg<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const connStr = process.env.SUPABASE_DB_URL
  if (!connStr) throw new Error('SUPABASE_DB_URL is not set — required for copilot threads.')
  const c = new Client({
    connectionString: connStr,
    ssl: connStr.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    try { await c.end() } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Threads
// ─────────────────────────────────────────────────────────────────────

export async function listThreads(
  admin_user_id: string,
  role: CopilotRole,
  opts: { include_archived?: boolean; limit?: number } = {},
): Promise<CopilotThread[]> {
  const limit = opts.limit ?? 50
  const where = opts.include_archived
    ? `where admin_user_id = $1 and role = $2`
    : `where admin_user_id = $1 and role = $2 and archived_at is null`
  const sql = `
    select thread_id::text, admin_user_id::text, role, title,
           created_at, updated_at, archived_at
      from copilot_threads
     ${where}
     order by updated_at desc
     limit ${limit}
  `
  return withPg(async (c) => {
    const r = await c.query<CopilotThread>(sql, [admin_user_id, role])
    return r.rows
  })
}

export async function createThread(admin_user_id: string, role: CopilotRole): Promise<CopilotThread> {
  return withPg(async (c) => {
    const r = await c.query<CopilotThread>(
      `insert into copilot_threads (admin_user_id, role)
       values ($1, $2)
       returning thread_id::text, admin_user_id::text, role, title,
                 created_at, updated_at, archived_at`,
      [admin_user_id, role],
    )
    if (!r.rows[0]) throw new Error('createThread: no row returned')
    return r.rows[0]
  })
}

export async function archiveThread(thread_id: string, admin_user_id: string): Promise<void> {
  await withPg(async (c) => {
    await c.query(
      `update copilot_threads
          set archived_at = now()
        where thread_id = $1 and admin_user_id = $2`,
      [thread_id, admin_user_id],
    )
  })
}

export async function getThread(
  thread_id: string,
  admin_user_id: string,
): Promise<CopilotThread | null> {
  return withPg(async (c) => {
    const r = await c.query<CopilotThread>(
      `select thread_id::text, admin_user_id::text, role, title,
              created_at, updated_at, archived_at
         from copilot_threads
        where thread_id = $1 and admin_user_id = $2
        limit 1`,
      [thread_id, admin_user_id],
    )
    return r.rows[0] ?? null
  })
}

// ─────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────

export async function loadThreadHistory(thread_id: string): Promise<ClaudeMessage[]> {
  return withPg(async (c) => {
    const r = await c.query<{ role: 'user' | 'assistant'; content: string }>(
      `select role, content
         from copilot_messages
        where thread_id = $1
        order by created_at desc
        limit ${MAX_HISTORY_TURNS}`,
      [thread_id],
    )
    return r.rows.reverse().map((m) => ({ role: m.role, content: m.content }))
  })
}

export async function loadFullThread(thread_id: string): Promise<CopilotMessageRow[]> {
  return withPg(async (c) => {
    const r = await c.query<CopilotMessageRow>(
      `select message_id::text, thread_id::text, role, content,
              tokens_in, tokens_out, cost_usd::float as cost_usd,
              context_snapshot, created_at
         from copilot_messages
        where thread_id = $1
        order by created_at asc`,
      [thread_id],
    )
    return r.rows
  })
}

export interface AppendUserOpts {
  thread_id: string
  content: string
  /** When true, also bump the thread title to the first 80 chars (idempotent). */
  set_title_if_empty?: boolean
}

export async function appendUserMessage(opts: AppendUserOpts): Promise<void> {
  await withPg(async (c) => {
    await c.query(
      `insert into copilot_messages (thread_id, role, content)
       values ($1, 'user', $2)`,
      [opts.thread_id, opts.content],
    )
    if (opts.set_title_if_empty) {
      const title = opts.content.slice(0, TITLE_MAX_CHARS).trim()
      await c.query(
        `update copilot_threads
            set title = $2
          where thread_id = $1 and title is null`,
        [opts.thread_id, title],
      )
    }
  })
}

export interface AppendAssistantOpts {
  thread_id: string
  content: string
  tokens_in: number
  tokens_out: number
  cost_usd: number
  context_snapshot: Record<string, unknown>
}

export async function appendAssistantMessage(opts: AppendAssistantOpts): Promise<void> {
  await withPg(async (c) => {
    await c.query(
      `insert into copilot_messages
         (thread_id, role, content, tokens_in, tokens_out, cost_usd, context_snapshot)
       values ($1, 'assistant', $2, $3, $4, $5, $6::jsonb)`,
      [
        opts.thread_id,
        opts.content,
        opts.tokens_in,
        opts.tokens_out,
        opts.cost_usd,
        JSON.stringify(opts.context_snapshot),
      ],
    )
  })
}
