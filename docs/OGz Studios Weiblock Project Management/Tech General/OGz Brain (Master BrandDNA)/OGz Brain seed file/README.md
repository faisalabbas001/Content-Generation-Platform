# ogz-knowledge

**The system-agnostic, file-first knowledge base for `{PLATFORM_NAME}` — the Saudi creative intelligence platform.**

This repository is the **source of truth** for all knowledge that powers `{PLATFORM_NAME}` content production: chain definitions, sector baselines, occasion calendars, CD-brain methodologies, cultural specifications, brand fingerprints, agent prompts, campaign archive, and Saudi Instagram benchmarks.

**Files first, database second.** Everything in this repo is human-readable, schema-validated, vendor-portable, and Git-versioned. The runtime database (Postgres + pgvector) is built from these files — never the other way around.

---

## What this repo is NOT

- It is **not** the runtime. The Memory Controller, sync_to_supabase.py, agents, and fal.ai integration live in a separate runtime repo.
- It is **not** brand-specific data. Per-brand fingerprints, generations, and outcomes live in the runtime database, isolated by RLS.
- It is **not** the Brand Studio UI. The client-facing app is a separate frontend repo.

This repo is **the knowledge that all of the above consume.**

---

## Repository Map

| Folder | Contains |
|---|---|
| `00_start_here/` | Onboarding for new contributors. Decision records (ADRs). |
| `01_how_to_decide/` | Routing rules: intent → chain family, sector → chains, occasion triggers, compliance gates, quality tier map, conflict resolution. |
| `02_what_to_build/` | 88 `{PLATFORM_NAME}` chains organized in 23 families (TF01–TF23). Plus INDEX.json. |
| `04_saudi_rules/` | Compliance levels, visual rules, Arabic text rules, gender rules, occasion calendar references. |
| `05_sector_defaults/` | 5 Sector Baseline YAML files (F&B, Retail, Beauty, Real Estate, Healthcare). |
| `06_saudi_calendar/` | 5 Saudi Occasions YAML files (Ramadan, Eid al-Fitr, Eid al-Adha, National Day, Founding Day). |
| `07_how_to_plan/` | Content mix templates, weekly rhythm, launch sequences, recovery playbook. |
| `08_what_went_wrong/` | Failure library — patterns that didn't work, why, when. |
| `09_how_to_run/` | Operator runbook: pipeline flows, decision authority, data policies, breach response. |
| `10_agent_brains/` | CEO/COO/CCO production agent system prompts + CD-Brain Router rules. |
| `11_who_to_learn_from/` | ~100 Saudi Instagram benchmark accounts + ~300 extracted patterns. |
| `12_data_shapes/` | JSON schemas (v1) defining every record type. |
| `13_database/` | Supabase migration SQL: tables, RLS policies, materialized views, indexes. |
| `14_brand_fingerprint/` | 6-layer brand fingerprint specs + onboarding forms + distinctiveness scoring. |
| `15_cultural_specs/` | 80-field Saudi cultural specification + sector defaults + forbidden lists + advisor playbook. |
| `16_character_library/` | Reference library structure for visual content (faces, wardrobe, architecture, props, gestures, rituals). |
| `20_cd_brains/` | 5 Creative Director strategic-thinking methodologies — the differentiation engine. |
| `21_campaign_archive/` | 38 anonymized campaign records — examples that illustrate methodology application. |
| `22_org_context/` | OGZ Studios organizational context (anonymized): org structure, KPIs, BD pipeline stages. |

---

## How to Navigate (5-Minute Tour)

1. Read `CONVENTIONS.md` — the universal rules every file in this repo follows.
2. Skim `00_start_here/AGENT_MANIFEST.md` — what each agent reads and writes.
3. Open `12_data_shapes/chain_v1.schema.json` — see how the system describes a chain.
4. Open `02_what_to_build/TF23/tf23_01_phone_pov_unboxing.json` (or any chain) — see a real record.
5. Open `20_cd_brains/cd_03_authenticity_detective.md` — see how creative methodology gets captured.
6. Open `15_cultural_specs/forbidden_lists/universal_gestures_forbidden.yaml` — see how cultural compliance works.

That's the system.

---

## The 12 Principles (Non-Negotiable)

1. **Files are the source of truth.** Database is an index over files.
2. **ULIDs as universal IDs.** Sortable, mintable anywhere, no central coordinator.
3. **Five provenance fields on every record.** source / date / confirmer / confidence / scope.
4. **Explicit schema versioning.** `{entity}_v{N}.schema.json` always.
5. **One write path: the Memory Controller.** No agent writes directly.
6. **Append-only event log.** No updates; only new events.
7. **Quarantine, not delete.** 90-day soft delete; hard delete on documented process.
8. **Brand isolation via Row Level Security + file-level scoping.** Defense in depth.
9. **Three zones: Spine (deterministic), Joints (agents), Tools (LLMs).** Different reliability requirements.
10. **Cultural authenticity is the moat, not the AI models.** fal.ai is commodity; the 80-field Cultural Spec is not.
11. **Honest staged maturity.** Stage 0 deterministic → Stage 1 shadow → Stage 2 selective → Stage 3 managed.
12. **CD brains are starting points; brand's accumulated history is destination.**

Full discussion in `00_start_here/decisions/ADR-0001-files-first.md` and the deep research spec.

---

## Status

**Version:** seed v1 (Week 1 shipped)
**Last updated:** 2026-05-13
**Confidence:** schemas locked; content is `experimental` until validated through production use.

---

## License & Confidentiality

OGZ Internal. Not for distribution.
