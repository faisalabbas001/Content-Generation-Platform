/**
 * Custom Supabase type generator — no Docker, no Management API token.
 *
 * Reads the live schema via Postgres (information_schema + pg_catalog) and
 * emits a TypeScript file shaped like Supabase CLI's `gen types typescript`
 * output: a `Database` type with `public.Tables.<name>.{Row|Insert|Update}`
 * and `public.Enums.<name>`.
 *
 * Usage:
 *   pnpm db:types                       (writes to packages/db/src/schema/database.types.ts)
 *   pnpm db:types -- --print            (writes to stdout)
 */

import pg from 'pg'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, getPgConnectionString, getDbLabel } from './lib/env.js'

const { Client } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const OUTPUT_PATH = path.join(REPO_ROOT, 'packages/db/src/schema/database.types.ts')

interface ColumnInfo {
  table_name: string
  column_name: string
  is_nullable: 'YES' | 'NO'
  has_default: boolean
  is_identity: boolean
  data_type: string
  udt_name: string
  array_dimensions: number
  enum_values: string[] | null
}

interface EnumInfo {
  enum_name: string
  values: string[]
}

interface FunctionInfo {
  function_name: string
  arg_types: string[]
  return_type: string
}

/** Parse a value that's either a JS array or a Postgres array literal "{a,b,c}". */
function parsePgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[]
  if (typeof value !== 'string') return []
  const trimmed = value.replace(/^\{|\}$/g, '')
  if (trimmed === '') return []
  // Cheap CSV split — Supabase enum labels never contain commas
  return trimmed.split(',').map((s) => s.replace(/^"|"$/g, ''))
}

// ─────────────────────────────────────────────────────────────────────
// Postgres-type → TypeScript-type mapping
// ─────────────────────────────────────────────────────────────────────

const SCALAR_PG_TO_TS: Record<string, string> = {
  bool: 'boolean',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  float4: 'number',
  float8: 'number',
  numeric: 'number',
  text: 'string',
  varchar: 'string',
  bpchar: 'string',
  uuid: 'string',
  timestamp: 'string',
  timestamptz: 'string',
  date: 'string',
  time: 'string',
  timetz: 'string',
  json: 'Json',
  jsonb: 'Json',
  bytea: 'string',
  inet: 'string',
  cidr: 'string',
}

function tsTypeForColumn(col: ColumnInfo, enums: Map<string, string[]>): string {
  let base: string
  if (enums.has(col.udt_name)) {
    base = `Database['public']['Enums']['${col.udt_name}']`
  } else if (col.udt_name in SCALAR_PG_TO_TS) {
    base = SCALAR_PG_TO_TS[col.udt_name] ?? 'unknown'
  } else if (col.udt_name.startsWith('_')) {
    // Postgres prefixes array element types with `_`. The `_` prefix already
    // implies one array dimension, so we do NOT additionally wrap based on
    // `array_dimensions` (which is set when data_type is 'ARRAY').
    const elem = col.udt_name.slice(1)
    if (enums.has(elem)) {
      base = `Array<Database['public']['Enums']['${elem}']>`
    } else {
      base = `${SCALAR_PG_TO_TS[elem] ?? 'unknown'}[]`
    }
  } else {
    base = 'unknown'
    // Multi-dim arrays of non-`_` types (rare) — fall back to wrapping once.
    for (let i = 0; i < col.array_dimensions; i++) base = `${base}[]`
  }
  if (col.is_nullable === 'YES') base = `${base} | null`
  return base
}

// ─────────────────────────────────────────────────────────────────────
// Introspection queries
// ─────────────────────────────────────────────────────────────────────

const SQL_ENUMS = `
  select t.typname  as enum_name,
         array_agg(e.enumlabel order by e.enumsortorder) as values
    from pg_type t
    join pg_enum e   on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
group by t.typname
order by t.typname
`

const SQL_COLUMNS = `
  with cols as (
    select c.table_name,
           c.column_name,
           c.ordinal_position,
           c.is_nullable,
           (c.column_default is not null or c.identity_generation is not null) as has_default,
           (c.is_identity = 'YES') as is_identity,
           c.data_type,
           c.udt_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type   = 'BASE TABLE'
  )
  select * from cols
   order by table_name, ordinal_position
`

const SQL_FUNCTIONS = `
  select p.proname  as function_name,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as result
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
order by p.proname
`

// ─────────────────────────────────────────────────────────────────────
// Output emitter
// ─────────────────────────────────────────────────────────────────────

function pascal(name: string): string {
  return name.replace(/(^|_)([a-z])/g, (_, _u, c) => c.toUpperCase())
}

function emit({
  enums,
  columnsByTable,
  functions,
  dbLabel,
}: {
  enums: EnumInfo[]
  columnsByTable: Map<string, ColumnInfo[]>
  functions: FunctionInfo[]
  dbLabel: string
}): string {
  const enumNames = new Set(enums.map((e) => e.enum_name))
  const enumMap = new Map(enums.map((e) => [e.enum_name, e.values]))

  const lines: string[] = []
  lines.push(`/**`)
  lines.push(` * Auto-generated by scripts/db/gen-types.ts — do NOT edit by hand.`)
  lines.push(` * Source: ${dbLabel}`)
  lines.push(` * Generated: ${new Date().toISOString()}`)
  lines.push(` *`)
  lines.push(` * Re-run with:  pnpm db:types`)
  lines.push(` */`)
  lines.push('')
  lines.push(`export type Json =`)
  lines.push(`  | string`)
  lines.push(`  | number`)
  lines.push(`  | boolean`)
  lines.push(`  | null`)
  lines.push(`  | { [key: string]: Json | undefined }`)
  lines.push(`  | Json[]`)
  lines.push('')

  // Database root
  lines.push(`export interface Database {`)
  lines.push(`  public: {`)

  // Tables
  lines.push(`    Tables: {`)
  const tableNames = Array.from(columnsByTable.keys()).sort()
  for (const tableName of tableNames) {
    const cols = columnsByTable.get(tableName) ?? []
    lines.push(`      ${tableName}: {`)
    // Row
    lines.push(`        Row: {`)
    for (const col of cols) {
      lines.push(`          ${col.column_name}: ${tsTypeForColumn(col, enumMap)}`)
    }
    lines.push(`        }`)
    // Insert — defaults / identity / nullable become optional
    lines.push(`        Insert: {`)
    for (const col of cols) {
      const optional = col.has_default || col.is_identity || col.is_nullable === 'YES'
      lines.push(`          ${col.column_name}${optional ? '?' : ''}: ${tsTypeForColumn(col, enumMap)}`)
    }
    lines.push(`        }`)
    // Update — every column optional
    lines.push(`        Update: {`)
    for (const col of cols) {
      lines.push(`          ${col.column_name}?: ${tsTypeForColumn(col, enumMap)}`)
    }
    lines.push(`        }`)
    lines.push(`        Relationships: []`)
    lines.push(`      }`)
  }
  lines.push(`    }`)

  // Views (not introspected — empty for now)
  lines.push(`    Views: {}`)

  // Functions (signature-light — argument types are textual)
  lines.push(`    Functions: {`)
  for (const fn of functions) {
    lines.push(`      ${fn.function_name}: {`)
    lines.push(`        Args: Record<string, unknown>`)
    lines.push(`        Returns: unknown`)
    lines.push(`      }`)
  }
  lines.push(`    }`)

  // Enums
  lines.push(`    Enums: {`)
  for (const e of enums) {
    const union = e.values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(' | ') || 'never'
    lines.push(`      ${e.enum_name}: ${union}`)
  }
  lines.push(`    }`)

  lines.push(`    CompositeTypes: {}`)
  lines.push(`  }`)
  lines.push(`}`)
  lines.push('')

  // Convenience aliases — Tables<'brand_profiles'>['Row'] etc.
  lines.push(`export type Tables<T extends keyof Database['public']['Tables']> =`)
  lines.push(`  Database['public']['Tables'][T]['Row']`)
  lines.push('')
  lines.push(`export type TablesInsert<T extends keyof Database['public']['Tables']> =`)
  lines.push(`  Database['public']['Tables'][T]['Insert']`)
  lines.push('')
  lines.push(`export type TablesUpdate<T extends keyof Database['public']['Tables']> =`)
  lines.push(`  Database['public']['Tables'][T]['Update']`)
  lines.push('')
  lines.push(`export type Enums<T extends keyof Database['public']['Enums']> =`)
  lines.push(`  Database['public']['Enums'][T]`)
  lines.push('')

  // Touch unused symbols to keep the linter happy when parts are empty
  void pascal
  void enumNames

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv()
  const conn = getPgConnectionString()
  const print = process.argv.includes('--print')

  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()

  console.error(`→ Introspecting ${getDbLabel()}`)

  // Enums (defensive parse — pg sometimes returns the array as a Postgres
  // textual literal "{a,b,c}" instead of a JS array)
  const { rows: enumRowsRaw } = await client.query<{ enum_name: string; values: unknown }>(SQL_ENUMS)
  const enumRows = enumRowsRaw.map((r) => ({
    enum_name: r.enum_name,
    values: parsePgArray(r.values),
  }))

  // Columns
  const { rows: colRows } = await client.query<{
    table_name: string
    column_name: string
    is_nullable: 'YES' | 'NO'
    has_default: boolean
    is_identity: boolean
    data_type: string
    udt_name: string
  }>(SQL_COLUMNS)

  // Functions
  const { rows: fnRows } = await client.query<{ function_name: string; args: string; result: string }>(SQL_FUNCTIONS)

  await client.end()

  const enums: EnumInfo[] = enumRows.map((r) => ({ enum_name: r.enum_name, values: r.values }))
  const enumMap = new Map(enums.map((e) => [e.enum_name, e.values]))

  // Group columns
  const columnsByTable = new Map<string, ColumnInfo[]>()
  for (const r of colRows) {
    const dims = (r.data_type.match(/ARRAY/) ? 1 : 0)
    const list = columnsByTable.get(r.table_name) ?? []
    list.push({
      table_name: r.table_name,
      column_name: r.column_name,
      is_nullable: r.is_nullable,
      has_default: r.has_default,
      is_identity: r.is_identity,
      data_type: r.data_type,
      udt_name: r.udt_name,
      array_dimensions: dims,
      enum_values: enumMap.get(r.udt_name) ?? null,
    })
    columnsByTable.set(r.table_name, list)
  }

  const functions: FunctionInfo[] = fnRows.map((r) => ({
    function_name: r.function_name,
    arg_types: [r.args],
    return_type: r.result,
  }))

  const out = emit({
    enums,
    columnsByTable,
    functions,
    dbLabel: getDbLabel(),
  })

  if (print) {
    process.stdout.write(out + '\n')
  } else {
    writeFileSync(OUTPUT_PATH, out + '\n', 'utf8')
    console.error(`✓ Wrote ${OUTPUT_PATH}`)
    console.error(`  · ${columnsByTable.size} tables`)
    console.error(`  · ${enums.length} enums`)
    console.error(`  · ${functions.length} functions`)
  }
}

main().catch((err) => {
  console.error('✗ gen-types failed')
  console.error(err)
  process.exit(1)
})
