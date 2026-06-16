# CONVENTIONS

**Every file in this repository follows these conventions. The Memory Controller enforces them programmatically. Human contributors must respect them.**

---

## 1. Identifiers (ULIDs)

Every record gets a ULID — a 26-character, lexicographically sortable, time-encoded unique identifier.

- **Format:** `01HXYZ123ABCDEFGHIJKLMNOPQ` (Crockford base32, 26 chars)
- **Library:** `python-ulid` (Python) or `ulid` (JS/TS)
- **Minting:** at record creation time, in any environment, no central coordinator
- **Use:** as the canonical ID across files, database, object storage, and APIs

**Why not UUIDv4:** not sortable, ugly for filenames.
**Why not Postgres serial:** requires DB connection to mint, breaks file-first principle.
**Why not Snowflake IDs:** vendor lock-in.

---

## 2. File Naming

- **Lowercase only.** No spaces. No special characters except `_` and `-`.
- **Schema-defined records:** `{entity}_{ulid}.{ext}` or `{entity_short_id}.{ext}`
  - Example: `tf23_01_phone_pov_unboxing.json` (chain with stable short ID)
  - Example: `01HXYZ123ABCDEFGHIJKLMNOPQ.json` (campaign or generation, ULID only)
- **Documentation:** `UPPERCASE.md` for top-level (README, CONVENTIONS, CHANGELOG); `lowercase.md` for everything else.
- **Schemas:** `{entity}_v{version}.schema.json`. Always.

---

## 3. Provenance Mixin

Every record carries provenance. No exceptions.

```yaml
provenance:
  source: "..."           # where this came from (free-text, but specific)
  date_added: "..."       # ISO 8601 UTC, e.g., "2026-05-13T14:30:00Z"
  confirmer: "..."        # who confirmed it (Mohamed / Alhareth / CD lead / Cultural Advisor / client / inference)
  confidence: "..."       # enum: confirmed | inferred | experimental
  scope: "..."            # what this applies to (see Scope Conventions below)
```

### Confidence enum

| Value | Meaning |
|---|---|
| `confirmed` | Validated by a human authority OR proven through repeated production use |
| `inferred` | Extracted from data with some signal (e.g., 3+ approval patterns) but not human-validated |
| `experimental` | Initial seed value; not yet validated in production |

### Scope conventions

| Value | Meaning |
|---|---|
| `universal` | Applies to all brands, all sectors, all occasions |
| `sector:<slug>` | Applies to one sector (e.g., `sector:f_and_b`) |
| `brand:<ulid>` | Applies to one specific brand |
| `region:<slug>` | Applies to one regional context (e.g., `region:najdi`) |
| `occasion:<slug>` | Applies to one occasion (e.g., `occasion:ramadan`) |

Multiple scopes combine with `+`: `scope: "sector:f_and_b+occasion:ramadan"`

---

## 4. Schema Versioning

- Every record references its schema: `"$schema": "../12_data_shapes/chain_v1.schema.json"` (relative path) OR carries a `schema_version: 1` field.
- New schema version = new file: `chain_v2.schema.json`.
- Migration documented at `12_data_shapes/migrations/{entity}_v{N}_to_v{N+1}.md`.
- Old records keep their version until lazily upgraded by next touch.

---

## 5. File Format Conventions

### YAML

- 2-space indentation
- Explicit nulls: `null`, not blank
- Quoted strings when they contain colons, hashes, or YAML-significant chars
- Comments allowed, encouraged for context
- Top of file: `# {filename}` then blank line, then `---` then content

### JSON

- Pretty-printed, 2-space indentation
- UTF-8 encoded
- Keys always quoted
- No trailing commas
- One blank line at end of file

### Markdown (for CD brains, agent prompts, ADRs)

- Front-matter YAML block (`---` … `---`) for metadata
- H1 (`#`) for document title only — once per file
- H2 (`##`) for major sections
- H3 (`###`) for subsections
- Code blocks always fenced with language tag

---

## 6. Brand-Scoped Records

Records that belong to a specific brand:

- Live in `brands/{brand_ulid}/...` (NOT in this repo — in the brand-specific runtime store)
- Reference universal records by ULID
- Carry `brand_ulid` field as the first field after `schema_version`
- Are RLS-isolated at the database layer
- Are filesystem-isolated at the object storage layer

**Nothing in `ogz-knowledge` is brand-scoped.** Per-brand data lives in the runtime database and object storage, not in this repo.

---

## 7. The One Write Path

**No human edits files in this repository directly without going through the propose-review-merge flow.**

The flow:
1. Contributor opens a PR with proposed changes
2. CI runs schema validation against all changed files
3. CI runs the eval suite (when established)
4. Reviewer (Mohamed, Alhareth, or designated maintainer) approves
5. Merge to main triggers sync to runtime database

Direct pushes to main are blocked by branch protection.

The runtime Memory Controller (separate codebase) is the only program that writes to the database. It reads from this repo.

---

## 8. Quarantine, Not Delete

- Records to be removed go to `quarantine/{original_path}` with a `quarantine_reason.md` sibling file
- 90-day soft retention
- Hard delete only via documented process with approval
- Quarantine survives in Git history regardless

This protects against accidental deletion and supports PDPL right-to-deletion compliance with audit trail.

---

## 9. Append-Only Event Records

Records that represent events (generations, outcomes, decisions, compliance results) are **append-only**. Once written:

- Never updated
- Never deleted
- Corrections happen by appending new events (e.g., `client_revoked_approval` after `client_approved`)

Current state is derived by replaying events in order.

---

## 10. Language Conventions

- **Internal documentation, schemas, code:** English
- **Content-facing fields, names, dialect specs:** Arabic + English bilingual where applicable
- **Field names:** English snake_case always (e.g., `dialect_default`, not `لهجة_افتراضية`)
- **Field values:** native script when value is a name or word (e.g., `dialect_default: "najdi-light"`, but `arabic_sample: "أهلاً وسهلاً"`)
- **Markdown body:** primarily English with Arabic samples where appropriate

---

## 11. Saudi Cultural Sensitivity

This is operational, not advisory:

- Forbidden gestures, props, behaviors are HARD-BLOCKED at the runtime layer (see `15_cultural_specs/forbidden_lists/`)
- Religious content always handled with reverence; no trivializing
- Mixed-gender rules vary by brand; never assumed
- Regional variation (Najdi/Hejazi/Eastern/Southern) is real and matters; never collapse to "Saudi"
- Bilingual considerations: Arabic is co-equal, never afterthought

When in doubt, escalate to the Cultural Advisor.

---

## 12. Confidentiality

This repo is **OGZ Internal**. Not for external distribution. Contents include:
- Strategic methodology (CD brains)
- Operational playbooks
- Competitive intelligence (anonymized but specific)
- Cultural compliance rules

Access controlled via GitHub permissions. Cloning to personal devices follows the access policy in `09_how_to_run/data_consent_policy.md`.

---

## Quick Reference: New Contributor Checklist

Before your first commit:

- [ ] Read this CONVENTIONS.md
- [ ] Read README.md
- [ ] Read `00_start_here/AGENT_MANIFEST.md`
- [ ] Skim `12_data_shapes/` to understand the schemas
- [ ] Set up `python-ulid` or `ulid-js` in your environment
- [ ] Install schema validator (`ajv-cli` for JSON, `yamllint` for YAML)
- [ ] Read at least one record of each major type (chain, sector baseline, CD brain, cultural spec)
- [ ] Understand the One Write Path: PRs only, no direct pushes
