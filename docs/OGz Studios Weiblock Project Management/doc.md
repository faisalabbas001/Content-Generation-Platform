OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
OGz Studios
AI Content Platform
Complete Technical Architecture & Developer Documentation
Versionv1.0 — Phase 1 Baseline
ProjectOGz Studios — OGz Studios, Riyadh
Built ByweiBlocks
DateApril 2026
Phases CoveredPhase 1 (complete) + Phase 2–6 (architecture
notes)
AudienceLead Architect, Frontend Dev, Backend Dev, OGz
Studios Tech Team
CONFIDENTIAL — NDA Protected — OGz Studios + weiBlocks Only
OGz Studios Technical Docs v1.0 · weiBlocks · Page 1 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
1. Project Overview
1.1 What OGz Studios Is
OGz Studios is a governed AI content operating system for Saudi SME brands. It is not a simple
form-to-GPT-to-display pipeline. It is a multi-agent intelligence platform where four AI models
collaborate in a defined sequence with quality gates, audit trails, and a self-improving memory system.
A Saudi SME business owner fills a 15-question Arabic onboarding form. Within 24 hours the platform
generates a 20-post monthly Arabic social media content calendar with visual assets. The client
downloads the calendar and posts manually. Phase 1 is download-only — no auto-publishing.
1.2 The Three Systems Inside One Product
SystemNameWhat It Does
System 1Intelligence Pipelinen8n orchestrates 4 AI models in sequence.
CEO routes, COO briefs, DeepSeek
generates, CCO quality-gates. Every
decision logged.
System 2Memory SystemBrandDNA — governed intelligence schema.
Nothing writes directly. Memory Controller is
the only write gateway. Full evidence
tracking.
System 3Learning LayerThree-layer BrandDNA: private brand data +
sector intelligence + global anonymous
patterns. Gets smarter with every brand
interaction.
1.3 Phase Roadmap
Phas
eStatusKey FeaturesNew Agents
Phas
e1BUILD
NOWOnboarding, calendar generation, download
delivery, admin panel, 3 Copilots, Arabic QCCEO, COO, CCO,
DeepSeek
Phas
e2ARCHITEC
TURE
READYPostiz auto-publishing, Meta Insights API, CIO
pattern analysis, client OAuthCIO (Gemini 2.5 Pro)
Phas
e3PLANNEDCARO Arabic QC (Jais/DeepSeek), video/motion
chains, advanced competitor analysisCARO
Phas
e4PLANNEDCPO (Claude Code) autonomous content
strategy, multi-platform expansionCPO
Phas
e5PLANNEDWhite-label API for agencies, multi-tenant
enterprise, custom brand modelsAgency layer
OGz Studios Technical Docs v1.0 · weiBlocks · Page 2 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
Phas
e6
PLANNED
Predictive content scoring, real-time performance
optimization, Arabic market data product
Full CIO suite
1.4 Hard Architectural Rules — Never Violate These
★ HARD RULE: n8n NEVER calls COO or CCO directly. Every request goes through CEO first.
CEO instructs n8n which agent to call next.
★ HARD RULE: No AI agent writes to BrandDNA tables directly. All writes are nominated by CEO,
queued in memory_controller_queue, validated by Memory Controller, then written.
★ HARD RULE: Arabic text NEVER enters any image generation model. Arabic text is applied
POST-GENERATION as a Sharp/Canvas overlay in N8N-V01.
★ HARD RULE: Weavy CDN URLs are NEVER stored in the database. All Weavy outputs are
downloaded and re-uploaded to Supabase Storage. Only Supabase Storage URLs are stored.
★ HARD RULE: n8n NEVER makes creative or strategic decisions. It routes payloads between
agents only. Business logic lives inside the AI agents.
OGz Studios Technical Docs v1.0 · weiBlocks · Page 3 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
2. Technology Stack
2.1 Complete Stack — Phase 1
LayerTechnologyPlan/TierPurpose
FrontendNext.js 14 App RouterVercel ProClient platform + Admin panel
HostingVercelProDeployment, preview envs, edge
network
DatabaseSupabase
PostgreSQLProAll data, RLS, Auth, Storage,
Realtime
Auth — ClientSupabase Auth
(instance 1)Included/[slug] routes — client users only
Auth —
AdminSupabase Auth
(instance 2)Included/admin routes — OGz team only
Vector DBQdrant CloudFree tier → ScaleCaptionContext + onboarding vectors
per brand
Orchestrationn8n CloudPRO ($50/mo)All 11 workflows — routing only, never
logic
Visual GenWeavy.ai REST APIOGz API keyImage generation chain with model
routing
Image
ProcessingSharp (Node.js)npm packageArabic text overlay, watermark, safe
zone mask
AI — CEOClaude Sonnet 4.6Anthropic APIAll routing, gating, governance
decisions
AI — COOClaude Haiku 4.5Anthropic APIBrandDNA build, CaptionContext,
scoring
AI — CCOGPT-5OpenAI API (Tier 4)Arabic QC, dialect validation,
NegativePattern check
AI —
CalendarDeepSeek V3DeepSeek API20 Arabic caption generation per
client
AI — CIOGemini 2.5 ProGoogle AI APIStored for Phase 2 — not active in
Phase 1
Image Model
1Nano BananaWeavy nodeBulk post generation (default model)
Image Model
2Flux 1.1 UltraWeavy nodeFirst-ever post per client + high-score
brand_awareness
EmailResendOGz accountAll transactional emails — Arabic
templates
PaymentsStripe CheckoutOGz accountSubscription management, SAR
pricing
OGz Studios Technical Docs v1.0 · weiBlocks · Page 4 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
AnalyticsPostHogFree tierFunnel tracking, upgrade triggers
Source
ControlGitHubOGz orgWeekly commits from Day 1
ScrapingApify (third-party)OGz paysInstagram scraper — $30-80/month
⚠ WARNING: n8n Starter plan ($20/mo) is INSUFFICIENT for production. It allows ~2,500
executions/month. A single Sunday batch for 300 clients exceeds this. n8n Pro ($50/mo) is required
from Day 1.
2.2 Environment Variables — Complete List
All stored as Vercel environment variables. Never in source code. Never in n8n workflow node text.
Never in GitHub.
VariableServiceUsed In
ANTHROPIC_API_KEYClaude Sonnet + HaikuCEO routing (n8n flows + Admin Copilots) +
COO operations
OPENAI_API_KEYGPT-5 (CCO)Arabic QC in N8N-A01, A02 + CCO
reasoning
GOOGLE_AI_API_KEYGemini 2.5 Pro (CIO)Stored for Phase 2. DO NOT call in Phase 1.
DEEPSEEK_API_KEYDeepSeek V3Calendar generation in N8N-A01, A02
WEAVY_API_KEYWeavy.aiN8N-V01 REST API calls
NANO_BANANA_API_
KEYNano BananaN8N-V01 bulk generation node
FLUX_ULTRA_API_KE
YFlux 1.1 UltraN8N-V01 first-ever post node
SUPABASE_URLSupabaseAll database operations
SUPABASE_ANON_K
EYSupabaseClient-facing queries (RLS enforced)
SUPABASE_SERVICE
_ROLE_KEYSupabaseServer-side writes, Memory Controller, admin
operations
SUPABASE_ADMIN_U
RLSupabase (admin instance)Admin panel auth — separate instance
SUPABASE_ADMIN_S
ERVICE_KEYSupabase (admin instance)Admin server operations
QDRANT_URLQdrant CloudVector read/write operations
QDRANT_API_KEYQdrant CloudAuthenticated Qdrant access
RESEND_API_KEYResendAll transactional email delivery
OGz Studios Technical Docs v1.0 · weiBlocks · Page 5 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
STRIPE_SECRET_KEYStripeCheckout session creation, webhook
validation
STRIPE_WEBHOOK_S
ECRETStripeWebhook signature verification
POSTHOG_KEYPostHogAnalytics event tracking
APIFY_API_KEYApifyInstagram scraper calls in N8N-A03
N8N_WEBHOOK_SEC
RETn8nValidates incoming n8n webhook calls to
Next.js
OGz Studios Technical Docs v1.0 · weiBlocks · Page 6 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
3. System Architecture
3.1 Seven-Layer Architecture
LayerTechnologyRoleScalability Pattern
L1 —
StorageSupabase
PostgreSQLAll persistent data, RLS
enforcement, event logsRead replicas in Phase 3,
connection pooling via
pgBouncer
L2 —
FilesSupabase StorageGenerated images, client logos, ZIP
downloadsCDN-backed, move to
dedicated S3 in Phase 4
L3 —
VectorsQdrant CloudCaptionContext cache, onboarding
gap vectorsPer-client namespaces, add
nodes as brand count grows
L4 —
Orchestr
ationn8n CloudRoutes payloads between agents.
Never decides.Parallel batch processing,
shard model by brand_id
L5 —
Intelligen
ceAI C-Suite (4
models)CEO routes, COO briefs, CCO
validates, DS generatesStateless HTTP calls, token
budget enforcement per
model
L6 —
FrontendNext.js 14 on
VercelClient platform + Admin panel,
Arabic RTLEdge functions, ISR for
public pages, SSR for
dashboards
L7 —
LearningBrandDNA 3-layer
schemaPrivate + Sector + Global
intelligenceCIO adds Phase 2, patterns
compound with brand count
3.2 Request Flow — Every Generation Event
This flow applies to both N8N-A01 (batch) and N8N-A02 (on-demand). The steps are identical — only
the trigger and priority differ.
TRIGGER (Cron Sunday 23:00 AST or Webhook from client click)
│
▼
n8n receives event
│
├─ Fetches active clients from Supabase
├─ Writes to usage_logs: flow_id, timestamp
│
▼
HTTP POST → CEO (Claude Sonnet 4.6)
Input:
client_list + EvidenceBundle states + current_date + monthly_spend
Output: confidence_mode per client + occasion_flags + cost_constraints + ordered
manifest
Writes: RoutingDecision record (append-only)
│
▼ [For each client — parallel batches of 5-6]
HTTP POST → COO (Claude Haiku 4.5)
OGz Studios Technical Docs v1.0 · weiBlocks · Page 7 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
Input:
brand_id + confidence_mode
Output: CaptionContext (800-1200 tokens) + dialect_confirmed bool
Reads: brand_profiles + all BrandDNA tables + Sector Intelligence + Global
Intelligence
Writes: CaptionContext to Qdrant cache
│
├─ [IF dialect_confirmed = false] → Skip client → Log to admin QA → Continue
│
▼
HTTP POST → DeepSeek V3
Input:
CaptionContext + month + posts_per_week + occasion_context
Output: 20 Arabic captions with metadata (posting_time, content_type, hashtags)
Note:
Prompt caching applied — brief cached, only generation tokens variable
│
▼
HTTP POST → CCO (GPT-5)
Input:
captions[] + CaptionContext (for QC reference)
Output: per post: { score: 0-100, dialect_flag, negpat_flag, cultural_flag,
brave_route_flag }
│
▼
HTTP POST → CEO (Claude Sonnet 4.6) — Confidence Gate
Input:
CCO results per post
Output: per post routing: clean | watermark_required | hold
Checks: All 11 human override trigger conditions
Writes: RoutingDecision update
│
├─ [score >= 75 AND no override] → CLEAN → Proceed to N8N-V01
├─ [score 50-74 AND no override] → WATERMARK → Proceed to N8N-V01 with flag
└─ [score < 50 OR any override]
→ HOLD → Write to qa_review_queue → Skip N8N-V01
│
▼ [For non-held posts]
CALL N8N-V01 (Weavy Visual Chain sub-workflow)
Input:
WeavyVisualContext per post
Output: supabase_storage_url per post
│
▼
Assemble final calendar in Supabase
{ post_id, caption_ar, storage_url, posting_time, confidence_score, watermark:
bool }
│
▼
Resend email → "Your [Month] calendar is ready"
│
▼
HTTP POST → CEO — Batch completion
CEO logs RoutingDecision batch summary
CEO nominates BrandDNA updates to memory_controller_queue
│
▼
OGz Studios Technical Docs v1.0 · weiBlocks · Page 8 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
Memory Controller processes nominations
Validates → Writes to brand tables → Logs to branddna_event_log
Updates Sector Intelligence (Box 2) with anonymized outcome signals
Updates Global Intelligence (Box 3) with anonymized outcome signals
3.3 N8N-V01 — Weavy Visual Chain Detail
NodeTypeFunctionCritical Rule
1—
InputTriggerReceive WeavyVisualContext from
calling flowValidate all required variables
present before proceeding
2—
RouterSwitchRoute by objective:
awareness/engagement/conversion/
cultural/trustEach chain has different prompt
structure and model preference
3—
Model
SelectIFfirst_ever_post=true → Flux Ultra.
cost_constraint=high → Nano
Banana. default → Nano BananaOverride: brand_awareness +
score>80 → Flux Ultra
4—
Genera
teHTTP Request
→ WeavyCall selected image model with
English-only descriptorsNEVER pass Arabic text,
brand_name_ar, or caption text to
image model
5—
Palette
LockHTTP Request
→ WeavyApply brand hex colors via Flux
Canny Pro nodeOnly if COLOR_PALETTE has 2+
confirmed hex values
6—
Arabic
Overla
yCode Node
(Sharp)Render brand_name_ar in
dialect-appropriate Arabic fontFont: Najdi/Hejazi→Noto Naskh
Arabic, Gulf→Cairo. Applied at safe
zone.
7—
Safe
ZoneCode Node
(Sharp)Apply platform-specific maskInstagram: bottom-third safe zone.
Snapchat: top+bottom bars.
8—
Water
markIF + Code
NodeApply "Beta AI draft" overlay if
CONFIDENCE_FLAG=watermark_r
equiredPosition: top-right, opacity: 30%
9—
Downl
oadHTTP Request
+ SupabaseDownload from Weavy URL, upload
to Supabase StoragePath:
/clients/{brand_id}/calendars/{YYYY
-MM}/{post_id}.jpg. NEVER store
Weavy CDN URL.
10 —
OutputReturnReturn supabase_storage_url to
calling flowCalling flow writes URL to post
record in Supabase
OGz Studios Technical Docs v1.0 · weiBlocks · Page 9 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
4. BrandDNA — Three-Layer Intelligence Schema
4.1 Architecture Overview
BrandDNA is not a database table with brand fields. It is a governed intelligence schema with evidence
tracking, conflict detection, confidence states, an append-only event log, and a three-layer learning
architecture. Every field has a confidence state. Every write is logged. Nothing can be written without
going through the Memory Controller.
LayerTablesAccess
Layer 1 — Private
Brandbrand_profiles,
audience_profiles,
visual_style_profiles,
channel_profiles,
evidence_bundles,
source_records,
negative_patterns,
override_rules,
onboarding_responses,
brand_performance_logRLS: brand_id = auth.uid(). Zero cross-brand
access. Deleted on account deletion.
Layer 2 — Sector
Intelligencesector_baselines,
sector_question_weights,
sector_trendsReadable by all agents. Writable by Memory
Controller only. Updated monthly by CIO
(Phase 2).
Layer 3 — Global
Intelligencecontent_performance_patter
ns, negative_pattern_library,
onboarding_intelligence,
visual_performance_global,
occasion_intelligenceReadable by all authenticated users. Writable
by service_role only. Zero foreign keys to
brand_profiles.
4.2 Complete Table Specifications — Layer 1
brand_profiles
brand_idUUID PRIMARY KEY DEFAULT gen_random_uuid()
brand_name_arTEXT NOT NULL
brand_name_enTEXT
sectorENUM (F&B, Retail, Beauty_Wellness)
city_primaryTEXT
arabic_dialect
Mixed)ENUM (Najdi, Hejazi, Gulf, MSA_formal, MSA_accessible,
price_positionENUM (budget, mid_market, premium, luxury)
brand_differentiatorTEXT
formality_levelENUM (casual, semi_formal, formal)
humor_toleranceENUM (none, light, moderate)
religious_sensitivityENUM (Low, Medium, High)
bilingual_ratio
english_primary)ENUM (arabic_only, arabic_primary, balanced,
ramadan_relevanceENUM (Critical, High, Medium, Low, Not_relevant)
eid_fitr_relevanceENUM (Critical, High, Medium, Low, Not_relevant)
eid_adha_relevanceENUM (Critical, High, Medium, Low, Not_relevant)
OGz Studios Technical Docs v1.0 · weiBlocks · Page 10 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
national_day_relevanceENUM (Critical, High, Medium, Low, Not_relevant)
founding_day_relevanceENUM (Critical, High, Medium, Low, Not_relevant)
primary_channelENUM (Instagram, Snapchat, TikTok, Twitter)
tierENUM (free, paid_starter, paid_pro)
completeness_scoreFLOAT DEFAULT 0
pipeline_tierENUM (Starter, Pro)
batch_shardINT (0-6, assigned on signup, determines generation night)
sector_baseline_idUUID FK → sector_baselines
client_slugTEXT UNIQUE NOT NULL
logo_urlTEXT (Supabase Storage URL)
primary_color_hexCHAR(7)
total_calendars_generated INT DEFAULT 0
created_atTIMESTAMPTZ DEFAULT now()
updated_atTIMESTAMPTZ DEFAULT now()
WRITE AUTHORITY: Memory Controller queue ONLY
RLS: brand_id = auth.uid() for SELECT/UPDATE/DELETE
evidence_bundles — 10 Generation-Critical Fields
bundle_idUUID PRIMARY KEY
brand_idUUID FK → brand_profiles ON DELETE CASCADE
field_nameTEXT NOT NULL
supporting_source_idsUUID[] (array of source_record IDs that support this value)
contradicting_source_ids UUID[] (array of source_record IDs that contradict)
agreement_ratioFLOAT (0-1: 1 = all sources agree)
recency_scoreFLOAT (0-1: 1 = very recent sources)
conflict_scoreFLOAT (0-1: 0 = no conflict)
field_confidenceENUM (explicitly_confirmed, inferred_high, inferred_medium,
inferred_low, rejected, deprecated)
last_evaluated
TIMESTAMPTZ
-- field_confidence is AUTO-DERIVED from bundle states — NEVER set manually
-- explicitly_confirmed: client confirmed this value directly
-- inferred_high: 3+ corroborating sources, agreement_ratio > 0.8
-- inferred_medium: 2+ sources, agreement_ratio > 0.6
-- inferred_low: 1 source or agreement_ratio < 0.6
-- rejected: client explicitly said this value is wrong
-- deprecated: source is too old or no longer valid
10 GENERATION-CRITICAL FIELDS (EvidenceBundle required from Day 1):
arabic_dialect— Wrong dialect = wrong brand voice on every output
brand_differentiator— Cannot be inferred reliably from scrapes
price_position— Drives tone calibration across all captions
primary_channel— Determines format, frequency, content type
ramadan_relevance— Most important seasonal signal for Saudi brands
primary_audience_gender — Affects visual rules, tone, product emphasis
primary_kpi_type
models
— Engagement vs conversion = fundamentally different
OGz Studios Technical Docs v1.0 · weiBlocks · Page 11 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
religious_sensitivity
content
— High-sensitivity brands need human gate on religious
tone_anti_attribute_ids — Empty = system generates content client consistently
rejects
bilingual_ratio
— Every caption output affected
routing_decisions — APPEND-ONLY
decision_idUUID PRIMARY KEY
brand_idUUID FK (nullable for system-level decisions)
flow_idTEXT (N8N-A01, N8N-A02, etc.)
request_typeTEXT
pipeline_assignedTEXT
agents_dispatchedJSONB
constraints_appliedJSONB
confidence_modeENUM (Standard, Cautious, Minimal, Blocked)
outcomeTEXT
timestampTIMESTAMPTZ DEFAULT now()
WRITE AUTHORITY: CEO via n8n ONLY
APPEND-ONLY: No UPDATE or DELETE ever. RLS enforces INSERT only.
This table is the permanent audit trail of every CEO decision.
branddna_event_log — APPEND-ONLY, NEVER DELETE
event_idUUID PRIMARY KEY
brand_idUUID FK → brand_profiles
event_typeENUM (source_ingested, contradiction_detected,
client_confirmed, override_added,
confidence_upgraded, brand_graduated)
event_dataJSONB (full context of what changed and why)
created_atTIMESTAMPTZ DEFAULT now()
WRITE AUTHORITY: Memory Controller ONLY
APPEND-ONLY: No UPDATE or DELETE. Ever. Not even for PDPL deletion.
On account deletion: anonymize brand_id field, retain event data for audit.
Rollback: re-process event stream to reconstruct any past BrandDNA state.
memory_controller_queue
nomination_idUUID PRIMARY KEY
brand_idUUID FK
nomination_type
negative_pattern_add,ENUM (field_update, confidence_upgrade,
override_rule_add, sector_signal, global_signal)
nomination_dataJSONB (what to write and where)
nominated_byTEXT DEFAULT CEO
nominated_atTIMESTAMPTZ DEFAULT now()
statusENUM (pending, validated, written, rejected)
processed_atTIMESTAMPTZ
OGz Studios Technical Docs v1.0 · weiBlocks · Page 12 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
rejection_reason
TEXT
WRITE AUTHORITY: CEO creates nominations. Memory Controller processes.
No agent ever writes to brand_profiles, evidence_bundles, or any Layer 1 table
directly.
This queue is the ONLY path to BrandDNA writes.
4.3 Layer 2 — Sector Intelligence Tables
sector_baselines
baseline_idUUID PRIMARY KEY
sectorENUM
dialectENUM
last_updatedTIMESTAMPTZ
sample_sizeINT (how many brands inform this baseline)
recommended_content_mixJSONB
-- { emotional: 0.40, lifestyle: 0.35, offer: 0.25 }
top_performing_tones
JSONB
-- [{ tone_id: "warm_casual", approval_rate: 0.91, sample: 234 }]
worst_performing_tonesJSONB
occasion_insightsJSONB
-- { ramadan: { best_type: "emotional", optimal_lead_weeks: 2, avg_score: 88 }}
common_negative_patternsJSONB
confidence_benchmarksJSONB
-- { emotional: { avg: 84, p25: 71, p75: 92 }}
PRE-LOADED: F&B, Retail, Beauty_Wellness baselines loaded before launch.
READ-ONLY for all agents in Phase 1.
UPDATED monthly by CIO (Gemini 2.5 Pro) in Phase 2.
4.4 Layer 3 — Global Intelligence Tables
content_performance_patterns
pattern_idUUID PRIMARY KEY
sectorENUM
dialectENUM
occasionTEXT
content_typeTEXT
objectiveTEXT
avg_confidenceFLOAT
approval_rateFLOAT
revision_rateFLOAT
hard_block_rateFLOAT
sample_sizeINT
last_updatedTIMESTAMPTZ
PRIVACY: Zero foreign keys to brand_profiles.
OGz Studios Technical Docs v1.0 · weiBlocks · Page 13 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
Cannot be linked to any specific brand even by direct DB query.
CEO extracts anonymized signals — no brand_id, no caption text, no PII.
4.5 How BrandDNA Learns — The Full Signal Flow
CLIENT approves post
│
✅
▼
CEO extracts ANONYMIZED signal:
{ sector: "F&B", dialect: "Najdi", content_type: "lifestyle",
tone: "warm_casual", confidence_score: 89, outcome: "approved" }
NO brand_id. NO caption text. NO client email.
│
▼
CEO nominates to memory_controller_queue:
nomination_type: "global_signal"
nomination_data: { anonymized signal above }
│
▼
Memory Controller validates and writes to:
content_performance_patterns (Layer 3)
sector_baselines approval_rate update (Layer 2)
│
▼
NEXT NEW BRAND onboards (F&B, Najdi, Riyadh):
COO compiles CaptionContext
COO reads Layer 2: "F&B Najdi brands: warm_casual lifestyle = 91% approval"
COO reads Layer 3: "warm_casual tone scores avg 89 across all sectors"
CaptionContext includes these insights
DeepSeek generates better content from Day 1
New brand benefits from every previous brand — with zero privacy exposure
4.6 Onboarding Question Evolution
Onboarding questions are stored in the onboarding_questions table and linked to
onboarding_responses per brand. CIO (Phase 2) analyses correlations between answer patterns and
content quality outcomes monthly. New questions are proposed when patterns are statistically
significant (minimum 50-brand sample).
onboarding_questions:
question_idUUID PK
question_text_arTEXT
question_text_enTEXT
maps_to_fieldTEXT (which BrandDNA field this answer populates)
sector_relevanceJSONB ({ F&B: true, Retail: true, Beauty: false })
importance_scoreFLOAT (updated by CIO based on quality correlation)
introduced_atTIMESTAMPTZ
introduced_becauseTEXT (audit trail for why question was added)
OGz Studios Technical Docs v1.0 · weiBlocks · Page 14 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
onboarding_responses:
response_idUUID PK
brand_idUUID FK
question_idUUID FK
answer_rawTEXT (exact text entered by client)
answer_processedJSONB (structured by COO during BrandDNA build)
confidence_weightFLOAT
answered_atTIMESTAMPTZ
sourceENUM (form, correction, scrape)
OGz Studios Technical Docs v1.0 · weiBlocks · Page 15 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
5. n8n Workflow Specifications
5.1 All 11 Flows — Reference
Flow IDTriggerSchedule/EventPrimary Purpose
N8N-A01CronSunday 23:00 AST (or
shard night)Batch calendar generation — full AI chain
N8N-A02WebhookClient clicks Generate
PostOn-demand single post — same chain as A01,
high priority
N8N-A03Webhook15-question form
submittedOnboarding auto-extraction + BrandDNA v0.1
build
N8N-A04WebhookClient submits brand
correctionCEO classifies → Memory Controller nomination
N8N-A05Cron1st of month 06:00 ASTCOO upgrade readiness scoring → CEO →
Growth alert
N8N-B03WebhookClient submits revision
requestCEO → COO scopes → DeepSeek → CCO →
CEO
N8N-V01Sub-flowCalled from A01/A02
post-generationWeavy visual chain + Sharp Arabic overlay
N8N-D02Cron1st of month 04:00 ASTBrandDNA maintenance + stale flag detection +
CIO trigger (Phase 2)
N8N-S01CronEvery 15 minutesCOO pipeline health check → Tech Copilot alert
on failure
N8N-S02EventCOO cost threshold
triggered70%/90%/100% ceiling alerts → Management
Copilot
N8N-S03EventCEO AnomalyRecord
creationRoutes anomaly to correct Copilot by
anomaly_type
ℹ NOTE: Every n8n flow MUST have: (1) trigger node, (2) credential references (never hardcoded),
(3) error handling branch with 2x retry + exponential backoff, (4) logging node writing to usage_logs in
Supabase, (5) error notification routing to N8N-S03 on final failure.
5.2 N8N-A01 — Complete Step-by-Step
S
t
e
p
n8n NodeAPI CallInput → Output
1Supabase
QuerySupabase DB— → All active Starter clients sorted by occasion_priority
DESC
2HTTP RequestCEO (Sonnet 4.6)Client list + EvidenceBundle states → confidence_mode
+ occasion_flags per client
OGz Studios Technical Docs v1.0 · weiBlocks · Page 16 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
3Loop Over
Items—Ordered manifest → Per-client iteration (parallel batches
of 5-6)
4HTTP RequestCOO (Haiku 4.5)brand_id + confidence_mode → CaptionContext +
dialect_confirmed
5IF Node—dialect_confirmed → Branch: skip (false) or continue
(true)
6Supabase
WriteSupabase DB (skip)skipped client → Log to admin QA queue, continue loop
7HTTP RequestDeepSeek V3CaptionContext + month → 20 Arabic caption drafts
8HTTP RequestCCO (GPT-5)captions[] + CaptionContext → score + flags per post
9HTTP RequestCEO (Sonnet 4.6)CCO results → clean/watermark/hold per post + 11
override checks
1
0IF Node—human_gate_required → Branch: QA queue or proceed
to Weavy
1
1Execute
Sub-flowN8N-V01WeavyVisualContext per non-held post →
supabase_storage_url
1
2Supabase
WriteSupabase DBAssembled calendar → calendar_id written to calendars
table
1
3HTTP RequestResend APIEmail template + client email → Delivery confirmation
1
4HTTP RequestCEO (Sonnet 4.6)Batch result → RoutingDecision log + Memory Controller
nominations
1
5Supabase
Writememory_controller_q
ueueCEO nominations → BrandDNA + Layer 2/3 signal
updates queued
5.3 N8N-A03 — Onboarding Flow
S
t
e
pActionTechnical DetailSLA
1Receive webhookValidate all required fields present in payload<1s
2Launch 3 parallel
extractors(a) Apify Instagram scraper — last 30 posts. (b)
Multi-strategy website scraper — HTML fetch →
Puppeteer fallback. (c) Google Places API —
category, rating, reviews.30-90s
3POST to COOCOO maps all inputs to 39 BrandDNA fields with
confidence states. Creates EvidenceBundle for 10
critical fields.20-40s
4Write BrandDNA
v0.1Creates brand_profiles, evidence_bundles,
source_records, Qdrant namespace.<5s
OGz Studios Technical Docs v1.0 · weiBlocks · Page 17 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
5POST to CEOCEO checks dialect confidence. Compiles
OnboardingGapContext. Identifies top 3 gap
fields.10-20s
6Progressive Brand
SnapshotPartial snapshot (form data only) available within
60s. Full snapshot after scrape completion.60s partial, 3-5min full
7Write Brand
SnapshotCEO writes to brand_snapshots. Client platform
receives via Supabase realtime subscription.<5s
8Check
completenesscompleteness_score >= 40% AND
dialect_confirmed → trigger N8N-A01 for this
client (high priority).Immediate
9Gap notificationcompleteness_score < 40% OR
dialect_unconfirmed → send top 3 gap questions
to client. Hold generation.Immediate
5.4 Error Handling Pattern — Applied to All Flows
Every external API call in n8n follows this pattern:
TRY: Make API call
│
├─ SUCCESS → Continue to next node
│
└─ FAIL
│
├─ Wait 2 seconds
├─ RETRY 1
│││├─ SUCCESS → Continue
│└─ FAIL│││├─ Wait 4 seconds
│├─ RETRY 2
│││││├─ SUCCESS → Continue
││└─ FINAL FAIL
│││
││├─ Write to anomaly_records (CEO)
││├─ Write error to usage_logs
││├─ Trigger N8N-S03 (anomaly router)
││└─ Skip this client/post (do not fail entire batch)
5.5 Scalability — Batch Processing Design
PHASE 1 — Sequential with small parallel batches:
brand_id shard = brand_id % 5
Shard 0 → Sunday night
OGz Studios Technical Docs v1.0 · weiBlocks · Page 18 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
Shard 1 → Monday night
Shard 2 → Tuesday night
Shard 3 → Wednesday night
Shard 4 → Thursday night
300 brands → 60 per night → manageable
Each night runs 5-6 clients in parallel → ~2 hours per night
PHASE 2 — Queue-based (when brand count > 500):
Add Redis queue layer
n8n pulls from queue instead of Supabase direct
Multiple n8n workers process in parallel
No ceiling on scale — add workers = add throughput
PHASE 3 — Dedicated generation service (when > 2000 brands):
Extract AI chain into dedicated Node.js service
n8n remains as trigger only
Horizontal scaling via container orchestration
OGz Studios Technical Docs v1.0 · weiBlocks · Page 19 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
6. AI C-Suite — Integration Specifications
6.1 CEO — Claude Sonnet 4.6
API Call Pattern
// Every CEO call from n8n HTTP node:
POST https://api.anthropic.com/v1/messages
{
model: "claude-sonnet-4-6",
max_tokens: 1024,
system: process.env.CEO_SYSTEM_PROMPT, // from n8n credential object
messages: [{
role: "user",
content: JSON.stringify({
flow_id: "N8N-A01",
request_type: "batch_generation",
brand_id: "uuid",
evidence_bundle_states: { arabic_dialect: "inferred_medium", ... },
occasion_flags: ["ramadan_approaching"],
current_month_spend_usd: 12.40,
monthly_ceiling_usd: 50.00
})
}]
}
// CEO ALWAYS responds in structured JSON — prompt must enforce this
// Parse: JSON.parse(response.content[0].text)
CEO Functions Reference
FunctionInputOutputWrites To
Request
classificationflow_id + request
payloadrequest_type +
pipeline_assignedrouting_decisions
(append-only)
Confidence
classificationbrand_id + critical field
statesconfidence_mode:
Standard/Cautious/Minima
l/Blockedconfidence_classificatio
ns
Occasion priority
checkcurrent_dateoccasion_flags[] per clientoccasion_priority_flags
if update needed
Cost ceiling
checkbrand_id +
current_month_spendcost_constraint:
normal/approaching/critica
l/breachedRead only — no write
Agent dispatch
compilationconfidence_mode + all
contextCompiled dispatch
payload per target agentNo write — output only
Confidence gateCCO scores per postclean/watermark/hold per
postrouting_decisions
update
OGz Studios Technical Docs v1.0 · weiBlocks · Page 20 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
Human gate (11
triggers)CCO output + client
metadatahuman_gate_required:
boolqa_review_queue if
triggered
Memory
governanceApproval/rejection
eventsNomination payloadmemory_controller_que
ue
Anomaly
detectionCost/quality/namespace
thresholdsAnomalyRecord createdanomaly_records
6.2 COO — Claude Haiku 4.5
CaptionContext Structure (800-1200 tokens)
{
brand_identity: {
name_ar: "‫الريان‬ ‫مطعم‬",
sector: "F&B",
city: "Riyadh",
dialect: "Najdi",
price_position: "mid_market"
},
voice_and_tone: {
attributes: ["warm", "family-focused", "proud Saudi"],
anti_attributes: ["aggressive", "western-casual", "flashy"],
formality: "casual",
humor_tolerance: "light"
},
audience: {
description_ar: "45-25 ‫النساء‬ ،‫السعودية‬ ‫العائالت‬",
gender_mix: "60% female",
language_preference: "arabic_primary"
},
content_rules: {
negative_patterns: [{ text: "‫الوقت‬ ‫محدودة‬ ‫عروض‬", severity: "SOFT_WARN" }],
occasion_context: { name: "Ramadan", lead_weeks: 2, priority: "CRITICAL" }
},
visual_brief: {
style_descriptor: "warm food photography, natural light, family settings",
color_palette: ["#C8860A", "#FFFFFF"],
platform_specs: { canvas: "1080x1080", safe_zone: "bottom-third" }
},
sector_intelligence: {
recommended_mix: { emotional: 0.40, lifestyle: 0.35, offer: 0.25 },
this_month: "Ramadan: prioritize emotional week 1-2, shift to offer week 3-4"
},
global_signals: {
avoid: ["aggressive CTAs performing poorly this month"],
opportunity: ["National Day in 3 weeks — start building anticipation"]
}
}
OGz Studios Technical Docs v1.0 · weiBlocks · Page 21 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
6.3 CCO — GPT-5
Arabic QC Response Structure
// CCO returns per post:
[
{
post_id: "post_001",
score: 91,
dialect_flag: false,
negpat_flag: "NONE",
// NONE | SOFT_WARN | STRONG_WARN | HARD_BLOCK
cultural_flag: false,
brave_route_flag: false,
issues: []
// Empty array = all clear
},
{
post_id: "post_007",
score: 63,
dialect_flag: true,
negpat_flag: "SOFT_WARN",
cultural_flag: false,
brave_route_flag: false,
issues: [
"Sentence 2 has translation smell — sounds like translated English",
"Formality too high for confirmed casual brand voice",
]
}
]
// HARD_BLOCK negpat_flag = immediate hold, no delivery, human review required
// brave_route_flag: true = creative risk taken, human gate triggered (override #2)
6.4 All 11 Human Override Triggers
#ConditionCEO CheckAction
1First-ever output for
new clientclient_total_calendars_generated ===
0Hold ALL posts regardless of
score
2CCO
brave_route_present
on any postCCO response brave_route_flag ===
true on any post_idHold flagged posts
3Healthcare + health
claimssector === Healthcare AND
content_type === educational OR
testimonialHold flagged posts
4Finance + investment
claimssector === Finance AND
prohibited_content_flag detected by
CCOHold flagged posts
OGz Studios Technical Docs v1.0 · weiBlocks · Page 22 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
5Government sectorsector === Government (always)Hold ALL posts
6High religious
sensitivity + religious
contextEvidenceBundle religious_sensitivity
=== High AND CCO flags
religious_reference_detectedHold flagged posts
7Dialect inferred_low
on hero contentEvidenceBundle
arabic_dialect.confidence ===
inferred_lowHold hero content posts
8Unresolved
ConflictRecord on
critical fieldconflict_records has unresolved record
for brand_id on critical fieldHold ALL posts
9Third revision of same
outputrevision_history count for post_id >= 3Hold this post
1
0Any CCO score below
50CCO score < 50 on any post_idHold that post
1
1HARD_BLOCK
NegativePattern firedCCO negpat_flag === HARD_BLOCK
on any post_idHold that post, alert admin
OGz Studios Technical Docs v1.0 · weiBlocks · Page 23 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
7. Database Architecture & RLS
7.1 Supabase Configuration
Config ItemSettingReason
PostgreSQL version15+Required for gen_random_uuid() and modern
RLS features
Connection poolingpgBouncer in Transaction
modePrevents connection exhaustion under batch
load
Auth instancesTwo separate projectsClient auth and Admin auth must be
completely isolated
Storage bucketclients (private)All generated images, logos. Signed URLs
for access.
RealtimeEnabled on brand_snapshotsProcessing screen subscribes to status
changes
Row Level SecurityEnabled on ALL tablesNo exceptions. Never disable for
convenience.
7.2 RLS Policies — Complete Reference
-- LAYER 1: Client isolation (every Layer 1 table)
CREATE POLICY "client_isolation" ON brand_profiles
FOR ALL USING (brand_id = auth.uid());
-- APPEND-ONLY tables (routing_decisions, branddna_event_log)
CREATE POLICY "insert_only" ON routing_decisions
FOR INSERT WITH CHECK (true);
CREATE POLICY "no_update" ON routing_decisions
FOR UPDATE USING (false);
-- Blocks all updates
CREATE POLICY "no_delete" ON routing_decisions
FOR DELETE USING (false);
-- Blocks all deletes
-- LAYER 2 & 3: Global tables readable by all authenticated users
CREATE POLICY "global_read" ON content_performance_patterns
FOR SELECT USING (auth.role() = "authenticated");
-- LAYER 2 & 3: Only service_role can write global tables
CREATE POLICY "service_write" ON content_performance_patterns
FOR INSERT WITH CHECK (auth.role() = "service_role");
-- ADMIN: Full access to all tables
CREATE POLICY "admin_full" ON brand_profiles
FOR ALL USING (auth.jwt() ->> "role" = "admin");
-- COPILOT: Management Copilot — read all
OGz Studios Technical Docs v1.0 · weiBlocks · Page 24 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
CREATE POLICY "mgmt_copilot_read" ON brand_profiles
FOR SELECT USING (auth.jwt() ->> "copilot_role" = "management");
-- COPILOT: Tech Copilot — system tables only, NO client content
CREATE POLICY "tech_copilot_read" ON anomaly_records
FOR SELECT USING (auth.jwt() ->> "copilot_role" = "tech");
-- Tech Copilot has NO policy on brand_profiles — zero access
-- COPILOT: Production Copilot — QA queue only
CREATE POLICY "prod_copilot_read" ON qa_review_queue
FOR SELECT USING (auth.jwt() ->> "copilot_role" = "production");
-- Production Copilot has NO policy on usage_logs — zero access
7.3 Critical Indexes
-- brand_id is the most queried column in the system
CREATE INDEX idx_evidence_bundles_brand_id ON evidence_bundles(brand_id);
CREATE INDEX idx_source_records_brand_id ON source_records(brand_id);
CREATE INDEX idx_routing_decisions_brand_id ON routing_decisions(brand_id);
CREATE INDEX idx_usage_logs_brand_id_month ON usage_logs(brand_id, created_at);
-- Batch ordering — used every Sunday batch
CREATE INDEX idx_brand_profiles_shard ON brand_profiles(batch_shard, tier);
-- QA queue performance
CREATE INDEX idx_qa_queue_status ON qa_review_queue(status, created_at);
-- Event log queries
CREATE INDEX idx_event_log_brand_type ON branddna_event_log(brand_id, event_type);
-- Confidence classification lookups
CREATE INDEX idx_confidence_brand_active ON confidence_classifications(brand_id)
WHERE superseded_at IS NULL;
7.4 PDPL Cascade Delete Implementation
// Two-phase deletion for PDPL compliance
// Phase 1: Single atomic PostgreSQL transaction
async function deleteBrandPhase1(brand_id) {
await supabase.rpc("cascade_delete_brand", { p_brand_id: brand_id });
// SQL function deletes in dependency order:
// 1. qa_review_queue, 2. usage_logs, 3. confidence_classifications
// 4. routing_decisions (anonymize, do not delete)
// 5. branddna_event_log (anonymize brand_id, keep event data)
// 6. memory_controller_queue, 7. negative_patterns, 8. override_rules
// 9. source_records, 10. evidence_bundles, 11. brand_snapshots
// 12. onboarding_responses, 13. visual_style_profiles
OGz Studios Technical Docs v1.0 · weiBlocks · Page 25 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
// 14. audience_profiles, 15. channel_profiles, 16. brand_profiles
}
// Phase 2: Async external cleanup (runs immediately after Phase 1)
async function deleteBrandPhase2(brand_id) {
// Delete Qdrant namespace
await qdrant.deleteCollection(`clients_${brand_id}`);
// Delete Supabase Storage folder
await supabase.storage
.from("clients")
.remove([`${brand_id}/`]);
// Recursive delete
// Log deletion confirmation
await supabase.from("deletion_audit_log").insert({
brand_id, phase1_complete: true, phase2_complete: true,
deleted_at: new Date().toISOString()
});
}
// If Phase 2 fails: retry every 5 minutes for 24 hours
// Admin alert sent if not resolved within 1 hour
OGz Studios Technical Docs v1.0 · weiBlocks · Page 26 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
8. Frontend Architecture
8.1 Next.js App Router Structure
app/
layout.tsx// Root layout — Arabic RTL by default
[slug]/// CLIENT PLATFORM — Supabase Auth Instance 1
layout.tsx// Client layout — slug validation, auth guard
onboarding/page.tsx// Screen 2: 15-question form
processing/page.tsx
subscription
// Screen 3: Loading + Supabase realtime
snapshot/page.tsx// Screen 4: Brand Snapshot Card
calendar/page.tsx// Screen 5: Calendar Dashboard
calendar/[month]/page.tsx// Historical month view
profile/page.tsx// Screen 6: Brand Profile
upgrade/page.tsx// Screen 7: Stripe Checkout flow
admin/
// ADMIN PANEL — Supabase Auth Instance 2
layout.tsx// Admin layout — separate auth guard
page.tsx// Client list overview
qa/page.tsx// QA Review Queue (Production Copilot)
cost/page.tsx// Cost Monitor (Management Copilot)
anomalies/page.tsx// Anomaly Log
routing/page.tsx// RoutingDecision Log
branddna/[brand_id]/page.tsx // BrandDNA Inspector
flows/page.tsx// n8n Flow Status
baselines/page.tsx// Sector Baselines
occasions/page.tsx// Saudi Occasion Calendar
api/
webhooks/stripe/route.ts// Stripe webhook handler
webhooks/n8n/route.ts// n8n status callbacks
copilot/[role]/route.ts// Copilot chat API (server action)
8.2 Arabic RTL Implementation
// Root layout.tsx — Arabic first
export default function RootLayout({ children }) {
return (
<html lang="ar" dir="rtl">
<head>
{/* Arabic fonts — loaded first, no flash */}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic
&family=Cairo:wght@400;600;700&display=swap" rel="stylesheet" />
</head>
<body className="font-arabic">
<LanguageProvider>{children}</LanguageProvider>
</body>
</html>
)
OGz Studios Technical Docs v1.0 · weiBlocks · Page 27 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
}
// Language toggle — persisted to localStorage
function LanguageProvider({ children }) {
const [lang, setLang] = useState(localStorage.getItem("lang") || "ar")
return (
<html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
{children}
</html>
)
}
// Tailwind RTL — all inputs
<input
dir="rtl"
className="text-right font-arabic placeholder:text-right"
placeholder={arabicPlaceholder}
/>
8.3 Realtime Processing Screen
// processing/page.tsx — subscribes to brand_snapshots
useEffect(() => {
// Show partial snapshot immediately (from form data)
setPartialSnapshot(formDataSnapshot)
// Subscribe to Supabase realtime
const channel = supabase
.channel(`brand_snapshot_${slug}`)
.on("postgres_changes", {
event: "INSERT",
schema: "public",
table: "brand_snapshots",
filter: `brand_id=eq.${brandId}`
}, (payload) => {
// Full snapshot ready — redirect immediately
router.push(`/${slug}/snapshot`)
})
.subscribe()
// Timeout fallback — 10 minutes
const timeout = setTimeout(() => {
showTimeoutMessage()
notifyAdminViaAPI()
// Triggers N8N-S03
}, 10 * 60 * 1000)
return () => {
supabase.removeChannel(channel)
clearTimeout(timeout)
OGz Studios Technical Docs v1.0 · weiBlocks · Page 28 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
}
}, [])
8.4 Client Platform — All 7 Screens
ScreenRouteKey ComponentsCritical Requirements
Sign Up/[slug]/authEmail/password + Google OAuth,
Arabic RTL form, slug auto-generation
from brand_name_arSupabase Auth instance 1
only. Confirmation email via
Resend.
Onboardi
ng Form/[slug]/onboardin
g15 questions ALL displayed at once
(no wizard). Auto-extraction pre-fills
detected values. Logo upload, color
picker, dialect selector.Dialect selector must be
labelled "most important
question". All inputs Arabic
RTL. Logo → Supabase
Storage.
Processi
ng/[slug]/processin
gBranded loading animation. Supabase
realtime subscription. Partial snapshot
in 60s, full redirect on completion.10-minute timeout → admin
alert. Never block on failed
scrape.
Brand
Snapshot/[slug]/snapshotDetected voice (top 3 tones), visual
style, audience, completeness score
(progress bar), dialect status.NOT a generic welcome
screen. Dialect confirmation
prompt if inferred_low. This
is the hook moment.
Calendar
Dashboa
rd/[slug]/calendar8 posts displayed (free). Posts 9-20
blurred. Per-post: caption, image,
posting time, content type.
Approve/request changes/download
per post.Watermark badge visible if
watermark_required=true.
Confidence score:
admin-only (not visible to
client). Stripe upgrade
overlay on blurred posts.
Brand
Profile/[slug]/profileRead-only BrandDNA summary.
Field-by-field completeness
(green/amber/red). Flag correction →
N8N-A04.Dialect confirmation if
unconfirmed. Correction
form → CEO classifies →
Memory Controller.
Upgrade
Flow/[slug]/upgradeStripe Checkout redirect.
Post-payment webhook → tier update
in Supabase → unlock 20 posts.
Subscription management link.Tier update MUST be
server-side (webhook),
never client-side. Prevents
upgrade bypass attacks.
8.5 Admin Copilots — Server Action Pattern
// api/copilot/[role]/route.ts
export async function POST(request, { params }) {
const { role } = params
// management | tech | production
const { message, history } = await request.json()
// 1. Authenticate admin user
const admin = await validateAdminAuth(request)
if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 })
OGz Studios Technical Docs v1.0 · weiBlocks · Page 29 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
// 2. Fetch RLS-scoped data using role-specific service key
const contextData = await fetchCopilotContext(role, admin.id)
// Management: all tables | Tech: system only | Production: QA only
// 3. Call Claude Sonnet 4.6
const response = await anthropic.messages.create({
model: "claude-sonnet-4-6",
max_tokens: 1000,
system: COPILOT_PROMPTS[role],
// from env var, never hardcoded
messages: [
...history,
{
role: "user",
content: `Context data: ${JSON.stringify(contextData)}Question: ${message}`
}
]
})
return Response.json({ reply: response.content[0].text })
}
// CRITICAL: RLS is enforced at Supabase level for fetchCopilotContext
// Not just a UI filter. Direct DB query with role-scoped service key.
OGz Studios Technical Docs v1.0 · weiBlocks · Page 30 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
9. Security Architecture
9.1 Security Requirements — Complete Checklist
Req IDRequirementImplementationTested At
SEC-01Supabase RLS on ALL
tablesPer-table policies documented above.
No table exists without RLS.M1 + M2
SEC-02Zero API keys in source
codeAll keys in Vercel env vars. GitHub
scan before every milestone.M1
SEC-03Separate admin auth
instanceAdmin credentials return 401 on
/[slug] routes. Client credentials return
401 on /admin routes.M1
SEC-04HTTPS enforcedVercel enforces HTTPS. HTTP →
HTTPS redirect active before M1.M1
SEC-05PDPL cascade deleteTwo-phase deletion with audit log. All
tables + Qdrant + Storage.M2
SEC-06AI prompts in env vars
onlyNever in workflow node text. Never in
GitHub. Deleted at M3 with written
confirmation.M3
SEC-07Copilot RLS at DB levelEach Copilot role has Supabase RLS
policy. Not just UI filter. Tested via
direct Supabase API query.M2
SEC-08No Weavy CDN URLs in
DBAll post records queried at M2. Any
weavy.ai domain URL = defect.M2
SEC-09Cross-client isolationClient A authenticated at
/[client-b-slug] must return zero Client
B data.M2
SEC-10Stripe webhook
verificationAll Stripe webhooks verified with
STRIPE_WEBHOOK_SECRET.
Reject all unverified events.M2
9.2 Arabic Text Security — The Absolute Rule
⚠ WARNING: Arabic text MUST NEVER be passed as a prompt to any image generation model.
This includes: brand_name_ar, caption text, hashtags, any Arabic string. Arabic text produces
garbled, incorrect output in all current image models. This is an architectural constraint, not a style
preference.
// N8N-V01 Node 4 — CORRECT image generation call:
{
visual_style: "warm food photography, natural light, family gathering",
hero_concept: "Ramadan family dinner, warm candlelight, authentic Saudi setting",
negative_prompt: "alcohol, non-halal food, western fast food imagery",
OGz Studios Technical Docs v1.0 · weiBlocks · Page 31 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
cultural_guidance: "traditional Saudi hospitality, modest clothing, dates and
qahwa",
canvas: "1080x1080 Instagram square",
// NO Arabic text above
}
// N8N-V01 Node 6 — Arabic applied AFTER generation (Sharp overlay):
const image = await sharp(generatedImageBuffer)
.composite([{
input: await renderArabicText({
text: brand_name_ar,
font: dialectFontMap[dialect],
// Najdi → NotoNaskhArabic
size: 48,
color: primary_color_hex
}),
gravity: "south",
// Safe zone: bottom area
}])
.toBuffer()
OGz Studios Technical Docs v1.0 · weiBlocks · Page 32 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
10. Performance & Uptime
10.1 Performance Requirements
MetricRequirementHow AchievedTest Method
Client platform LCP< 3 seconds on
10MbpsNext.js ISR for static parts,
Vercel edge network, image
optimizationLighthouse 3x
average on
production URL
Calendar dashboard
(8 posts)< 4 seconds full
visual loadSupabase Storage CDN URLs,
Next.js Image component, lazy
loading posts 5-8Manual test on
10Mbps Saudi
connection
N8N-A01 batch (300
clients)< 6 hours from
23:00 triggerParallel batches 5-6 clients,
shard model reduces nightly
volume to 60n8n execution log
reviewed Monday
06:00
N8N-A02 on-demand< 5 minutes caption
+ visualPriority queue, dedicated
execution thread, not queued
with batchTimed from Generate
Post click to visual in
dashboard
N8N-A03
onboardingPartial in 60s, full in
5minProgressive loading pattern,
parallel scrapers, Supabase
realtime pushTimed from form
submit to Brand
Snapshot display
Admin QA queue (50
items)< 3 seconds loadSupabase indexed queries,
pagination, server componentsLoad QA queue with
50 held items
Concurrent
sessions100 without
degradationVercel edge, Supabase
connection pooling, stateless
API designLoad test at M2
10.2 Uptime Strategy
ComponentUptime TargetStrategy
Vercel (Frontend)99.9%Managed by Vercel infrastructure. Edge
network. Automatic failover.
Supabase (Database)99.9%Managed by Supabase. Daily backups.
Point-in-time recovery.
n8n Cloud
(Orchestration)99%N8N-S01 health check every 15 min. Manual
trigger available as fallback.
AI APIs
(Anthropic/OpenAI/De
epSeek)~99%Retry logic (2x with backoff). Fallback model
config for Phase 2.
Weavy.ai (Visual
generation)~95%Timeout fallback: failed visual → hold post in
QA queue, do not fail batch.
Qdrant Cloud99%Managed service. CaptionContext can be
recompiled on cache miss.
OGz Studios Technical Docs v1.0 · weiBlocks · Page 33 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
10.3 Monitoring & Alerting
Alert TypeTriggerRouted To
N8N-A01 batch failureAny client batch fails after 3
retriesTech Copilot via N8N-S03
Cost ceiling 70%Monthly API spend reaches
70% of ceilingManagement Copilot via N8N-S02
Cost ceiling 90%Monthly API spend reaches
90% of ceilingManagement Copilot (urgent) + CEO
AnomalyRecord
Cost ceiling 100%Monthly ceiling breachedManagement Copilot + halt generation for
that client
Pipeline health
WARNINGN8N-S01 detects
degradationTech Copilot notification
Pipeline health
CRITICALN8N-S01 detects failureTech Copilot urgent + CEO AnomalyRecord
Weavy timeout3 consecutive Weavy failuresTech Copilot + posts held in QA queue
Arabic QA regressionBatch approval rate < 70%Production Copilot + CEO AnomalyRecord
Brand Snapshot
timeoutN8N-A03 > 10 minutesAdmin notification via N8N-S03
OGz Studios Technical Docs v1.0 · weiBlocks · Page 34 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
11. Phase Evolution — Architecture for Future Phases
11.1 What Phase 1 Architecture Enables Without Refactoring
Every architectural decision in Phase 1 is made with Phase 6 in mind. The following Phase 2–6
features can be added without touching existing Phase 1 code — only additions, no rewrites.
PhaseAdditionPhase 1 Foundation That Enables It
Phase 2Postiz auto-publishingcalendar table already has platform +
posting_time fields. Add Postiz API call after
download step.
Phase 2CIO (Gemini) weekly
analysisLayer 2 + Layer 3 tables already exist. CIO
reads and updates them. N8N-D02 extended
with CIO call.
Phase 2Meta Insights API integrationbrand_performance_log table already exists.
Add performance data ingestion flow.
Phase 2Client Google Business
OAuthonboarding_responses table stores raw
answers. Full GBP data replaces Places API
data on same fields.
Phase 3CARO Arabic QC
(Jais/DeepSeek)CCO is model-agnostic. Swap GPT-5 for
CARO via env var. Same response schema.
Phase 3Video/motion chainsN8N-V01 has objective routing built in. Add
video chain as new objective type.
Phase 4CPO (Claude Code)CEO routing already has agent dispatch
slots. Add CPO as new agent type.
Phase 4White-label API for agenciesMulti-tenant architecture already built. Add
API key auth layer on top.
Phase 5Custom brand modelsBrandDNA schema supports arbitrary field
addition. Model fine-tuning connects to
existing EvidenceBundle.
Phase 6Arabic market data productGlobal Intelligence (Layer 3) is already being
built. Phase 6 adds API access to this
dataset.
11.2 What Will Need Refactoring at Scale
ComponentCurrent (Phase 1)When to RefactorRefactor To
n8n batch
processingParallel batches of 5-6,
shard modelBrand count > 500Redis queue + multiple n8n
workers
AI chain
executionn8n HTTP nodesBrand count > 2000Dedicated Node.js
generation service
SupabaseSingle project,
pgBouncer poolingRead load > 10k
req/minRead replicas for dashboard
queries
OGz Studios Technical Docs v1.0 · weiBlocks · Page 35 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
QdrantFree tier CloudVector count > 1MPaid tier with dedicated
nodes
Image storageSupabase StorageStorage > 500GB or
> 50k req/dayDedicated S3 with
CloudFront CDN
CaptionContext
compilationCOO called per
generationSame brand
generates > 3x/weekRedis cache for unchanged
BrandDNA
Admin CopilotsDirect Claude API call
per messageAdmin team > 5
peopleAdd rate limiting +
conversation persistence
11.3 Version Control & Documentation Standards
StandardRequirementEnforcement
GitHub commitsWeekly minimum.
Descriptive commit
messages. Feature
branches.OGz Studios admin access throughout.
Verified at each milestone.
Schema migrationsEvery migration documented
with up/down scripts.
Migration log in Supabase.Any schema change after Week 2 requires
OGz written approval.
n8n flow exportsAll flows exported as JSON
monthly. README per flow.M3 requirement. Flows not documented =
M3 held.
Environment variablesDocumented list (key name +
purpose only, never values).
Rotation procedure
documented.M3 requirement. Vendor confirms deletion in
writing.
API prompt versionsPrompt changes tracked with
version numbers. Old
prompts archived.OGz Studios owns all prompts. Vendor
stores in env vars only.
Architecture decisionsADR (Architecture Decision
Record) for any non-obvious
decision.This document is the baseline ADR. Updates
go in CHANGELOG.md.
OGz Studios Technical Docs v1.0 · weiBlocks · Page 36 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
12. Developer Week-by-Week Build Plan
12.1 Team Responsibilities
DeveloperOwnsWorks With
Lead (Usama)n8n all 11 flows, AI C-Suite
integration, BrandDNA
schema, Memory Controller,
Qdrant, system architectureDeveloper 2 on API contracts. Developer 3
on N8N-V01 integration.
Developer 2Next.js client platform (7
screens), Admin panel (9
views + 3 Copilots), Stripe,
Resend, PostHogLead on API response shapes. Developer 3
on image display.
Developer 3Weavy visual chain, Sharp
Arabic overlay, Supabase
Storage pattern, website
scraper, Apify integration,
load testingLead on N8N-V01 handoff contract.
Developer 2 on Storage URL consumption.
12.2 Week-by-Week Critical Path
W
ee
k
Lead (Usama)Dev 2 (Frontend)Dev 3 (Backend/Visual)
1Full Supabase schema — all
15 tables all 3 layers. n8n
workspace setup, all 11 flow
scaffolds. CEO/COO API
connection test.Next.js project deployed to
OGz Vercel. Both auth
instances. /[slug] routing.
Admin skeleton.Qdrant namespace pattern.
Apify Instagram scraper
integration test. Google Places
API test.
2N8N-A03 COO BrandDNA
build logic.
ConfidenceClassification
implementation.
CaptionContext compiler.
Qdrant cache write/read.Onboarding form (15
questions, Arabic RTL). Logo
upload to Supabase Storage.
Processing screen with
realtime.Multi-strategy website scraper
(HTTP → Puppeteer). Parallel
scraper orchestration for
N8N-A03.
3CEO routing logic — full
8-step protocol. All 11 override
triggers. DeepSeek calendar
generation partial. CCO
GPT-5 Arabic QC integration.Brand Snapshot card. Brand
Profile page. Admin client list
view.Weavy REST API connection
test. First image generation
test (English only). Sharp
library setup.
4
(M
1)N8N-A01 end-to-end TEXT
ONLY (no Weavy). Confidence
gate logic. All M1 criteria
verified. CEO
ConfidenceClassification
modes tested.Production Copilot queue UI.
Admin panel basic views. Start
50-post Arabic eval set
preparation.M1 checkpoint support. Begin
N8N-V01 node architecture.
5N8N-V01 full integration —
call from A01. Error handling
and fallback. Weavy timeoutCalendar dashboard with
visual images. Human gateN8N-V01 complete: Nano
Banana bulk, Flux Ultra
first-post, Sharp Arabic
OGz Studios Technical Docs v1.0 · weiBlocks · Page 37 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
fallback. Storage URL
validation.approve/reject in admin.
Download single post.overlay, watermark, safe
zones, Supabase Storage
upload.
6N8N-A02 on-demand.
N8N-S01 health heartbeat.
N8N-S02 cost monitor.
N8N-A04 brand correction. All
3 Copilots API integration.Stripe Checkout integration.
Upgrade overlay (posts 9-20
blur). Download all (ZIP).
PostHog instrumentation.Resend email templates
(Arabic). N8N-S03 anomaly
router. Performance baseline
testing.
7
(M
2)Arabic QA 50-post evaluation
run. White-label isolation
security test. N8N-A05
upgrade readiness. N8N-B03
revision request.Admin panel all 9 views
complete. 3 sector baselines
pre-loaded. Saudi Occasion
Calenar pre-loaded.Load test — 100 concurrent
sessions. Supabase query
EXPLAIN ANALYZE. All
performance requirements
verified.
8Bug fixes from M2 only.
N8N-D02 maintenance flow.
N8N-S03 final testing.
Documentation — n8n flow
READMEs.Bug fixes. Walkthrough
session preparation. Frontend
documentation.Bug fixes. Performance fixes.
Database documentation.
Schema diagram final.
W
k9
(M
3)Walkthrough session (2+
hours). All credentials
documented. Written prompt
deletion confirmation.
Handover complete.Code review final. GitHub
clean commit history verified.
No dead code.Load test final report. All
documentation complete.
Credential deletion confirmed.
12.3 Pre-Contract Checklist — Required Before Day 1
ItemRequired ByStatusAction If Missing
n8n Cloud Pro plan ($50/mo)OGz StudiosMust
confirmCannot start without — Starter plan
fails in production
Vercel admin accessOGz StudiosMust
confirm
Day 1Cannot deploy — blocks all frontend
development
Supabase admin accessOGz StudiosMust
confirm
Day 1Cannot build schema — blocks entire
system
n8n Cloud admin accessOGz StudiosMust
confirm
Day 1Cannot build workflows — blocks AI
chain
Qdrant Cloud admin accessOGz StudiosMust
confirm
Day 1Cannot set up namespaces — blocks
CaptionContext caching
Weavy API keyOGz StudiosMust
confirm
Day 1Cannot build N8N-V01 — delays
visuals to Week 6
GitHub org admin accessOGz StudiosMust
confirm
Day 1Cannot commit code — breaks
contract terms
OGz Studios Technical Docs v1.0 · weiBlocks · Page 38 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
OpenAI Tier 4 confirmationOGz StudiosMust
confirmGPT-4o fallback used until Tier 4
reached
Apify subscriptionOGz StudiosMust
confirmInstagram scraper blocked — affects
onboarding quality
AI system prompts
(CEO/COO/CCO)OGz StudiosMust
have by
Week 2AI chain works but outputs untested
until prompts arrive
CCO calibration test set (20
posts)OGz StudiosMust
have 2
weeks
before M2M2 Arabic QA at risk if prompts arrive
without calibration
Stripe account accessOGz StudiosMust
have by
Week 5Stripe integration delayed — upgrade
flow blocked
Single point of contact
namedOGz StudiosMust
confirmMilestone acceptance delays payment
Official contract start date
confirmedBoth partiesMust
confirmTimeline calculations undefined
OGz Studios Technical Docs v1.0 · weiBlocks · Page 39 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
13. Technical Feasibility Notes
13.1 Items Requiring Adjusted Implementation
The following RFP requirements are achievable but require implementation adjustments from how they
are described in the spec. All adjustments are documented here so there are no surprises at milestone
acceptance.
Client Action
Needed
RequirementIssueOur ImplementationInstagram scraperCustom scraper
violates ToS, gets
IP-bannedIntegrate Apify third-party service.
Handles rotation, CAPTCHA, ToS
compliance.OGz Studios pays
Apify ($30-80/mo)
Instagram
competitor
engagement ratesTrue engagement
(reach-based) only
available to account
ownerEstimated engagement =
(likes+comments)/followers.
Labelled as "estimated" in
EvidenceBundle with inferred_low
confidence.None —
expectation
adjustment
Google Business
full data pullGBP API requires
client OAuth. Cannot
pull privately.Google Places API for public data
(rating, category, reviews). COO
runs sentiment analysis on review
text.Full GBP → Phase
2 with client OAuth
300 clients in 6
hoursSequential processing
takes 18-22 hoursParallel batch 5-6 clients + weekly
shard model. 60 clients per night
→ completes in 2 hours.OGz Studios
confirms n8n Pro
plan
Brand Snapshot
in 5 minutesScraper rate limits
can push to 7-10 minProgressive loading: partial
snapshot (form data) in 60s. Full
snapshot pushed via Supabase
realtime on completion.None — UX
improvement
Arabic QA 80%
pass ratePass rate depends on
CCO prompt qualityRequest CCO prompt 2 weeks
before M2. 20-post calibration run
before formal evaluation.OGz provides
CCO prompt by
Week 5
Weavy at 6,000
images/batchWeavy reliability at
this scale unprovenTimeout fallback: Weavy fail →
hold post in QA queue. Fallback
image model configurable.OGz confirms
fallback model
preference
PDPL cascade
delete — all
systemsQdrant + Storage
cannot join
PostgreSQL
transactionTwo-phase deletion: Phase 1 =
DB transaction, Phase 2 = async
external cleanup with retry + audit
log.OGz confirms this
approach for PDPL
records
GPT-5 API accessRequires OpenAI Tier
4 ($250+ spend
history)Start with GPT-4o (comparable
Arabic quality). Upgrade to GPT-5
when Tier 4 confirmed.
Model-agnostic integration.OGz confirms
OpenAI account
tier
13.2 Items Not Possible As Specified
The following items as described in the RFP are technically not achievable. Below is the correct
approach for each.
OGz Studios Technical Docs v1.0 · weiBlocks · Page 40 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
RequirementWhy Not PossibleCorrect Approach
Arabic dialect
auto-detection (high
confidence) from
Instagram scrapesSaudi SME Instagram
captions frequently mix
dialects, use MSA, or use
English regardless of spoken
dialect. Detection accuracy
~60-70%. A wrong dialect
classification corrupts every
output for that brand.Detection from scrapes is always output as
inferred_low regardless of algorithm
confidence. Dialect confirmation from client is
mandatory, prominent, and blocks hero
content generation until completed. This is
the correct design — the RFP already
specifies this blocking rule.
Reliable website
scraper for all Saudi
SMEsLarge portion of Saudi SMEs
are Instagram-only (no
website), use
JavaScript-rendered sites
that HTTP scrapers cannot
read, or are behind
Cloudflare protection.Multi-strategy: HTTP fetch → Puppeteer
headless fallback → graceful skip. Failed
scrape fields marked inferred_low and
surfaced as Brand Snapshot gaps.
Onboarding never blocked on failed website
scrape.
n8n Starter plan
($20/mo) for
productionStarter allows ~2,500
executions/month. Single
Sunday batch for 300 clients
= 3,000+ executions. Hard
limit hit before batch
completes.n8n Cloud Pro plan at $50/month is required
before Day 1. Non-negotiable for any
meaningful client volume. $30/month
difference prevents system-stopping failure
at launch.
OGz Studios Technical Docs v1.0 · weiBlocks · Page 41 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
14. Glossary & Quick Reference
14.1 Key Terms
TermDefinition
BrandDNAThe governed intelligence schema per client. 39+ fields across 5
families. Three intelligence layers (Private, Sector, Global). All writes go
through Memory Controller.
CaptionContextThe 800-1200 token structured brief compiled by COO before every
generation. Contains brand identity, voice, audience, content rules,
sector intelligence, and global signals. What DeepSeek reads to write
captions.
Memory ControllerThe only entity authorised to write to BrandDNA tables. Receives
nominations from CEO via memory_controller_queue, validates them,
then writes with full evidence tracking.
EvidenceBundlePer-field evidence tracking record. Contains supporting and
contradicting source IDs, agreement ratio, recency score, and the
auto-derived field_confidence state.
RoutingDecisionAn append-only record of every CEO decision. Never updated or
deleted. The permanent audit trail of the intelligence pipeline.
Confidence ModeCEO's per-client generation mode: Standard (all critical fields
confirmed), Cautious (some inferred_low), Minimal (multiple gaps),
Blocked (dialect missing/rejected).
Confidence GateCEO's post-QC routing: score ≥75 = clean delivery, 50-74 = watermark
required, <50 = hold for human review.
Human GateCEO's 11-condition check that forces Production Copilot queue
regardless of confidence score. Override trigger conditions defined in
Section 6.
WeavyVisualContextThe 300-500 token payload compiled by CEO before calling N8N-V01.
Contains brand visual variables. Never contains Arabic text.
NegativePatternProhibited content patterns per client. Three severity levels:
HARD_BLOCK (never deliver), STRONG_WARN (review required),
SOFT_WARN (flag only).
Batch ShardAn integer (0-6) assigned to each brand on signup. Determines which
night of the week their calendar generates. Prevents all 300+ brands
from running on Sunday simultaneously.
Sector BaselinePre-loaded default BrandDNA values per sector (F&B, Retail, Beauty).
Applied when brand has inferred_low critical fields. Updated monthly by
CIO in Phase 2.
Progressive Brand SnapshotThe UX pattern where a partial Brand Snapshot (from form data) shows
within 60 seconds, then automatically updates with scraped data via
Supabase realtime when extraction completes.
Layer 1/2/3The three BrandDNA intelligence layers. Layer 1 = private per-brand
data. Layer 2 = sector patterns (F&B, Retail, Beauty). Layer 3 = global
anonymous patterns across all brands.
OGz Studios Technical Docs v1.0 · weiBlocks · Page 42 of 43OGz Studios — Technical Architecture & Developer Documentation — weiBlocks — CONFIDENTIAL
14.2 Confidence State Reference
StateMeaning + Trigger
explicitly_confirmedClient directly confirmed this value. Highest confidence. No ceiling
applied.
inferred_high3+ corroborating sources with agreement_ratio > 0.8. High confidence.
inferred_medium2+ sources with agreement_ratio > 0.6. Moderate confidence.
inferred_low1 source OR agreement_ratio < 0.6. CEO caps generation confidence
at 74. Sector baseline default applied.
rejectedClient explicitly said this value is wrong via brand correction flow.
Flagged in BrandDNA.
deprecatedSource is too old or no longer valid. Field falls back to inferred_low.
14.3 Document Version History
VersionDateAuthorChanges
v1.0April 2026weiBlocksInitial complete documentation — Phase 1
baseline + Phase 2-6 architecture notes
ℹ NOTE: This document is the single source of truth for OGz Studios Phase 1 architecture. Any
architectural decision not documented here must be logged as an ADR (Architecture Decision
Record) in CHANGELOG.md in the GitHub repository and reviewed with OGz Studios before
implementation.
OGz Studios Technical Docs v1.0 · weiBlocks · Page 43 of 43