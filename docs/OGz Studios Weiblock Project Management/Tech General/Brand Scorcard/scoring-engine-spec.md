# Brand DNA Score Card — Scoring Engine Specification

**For:** Weiblock (OGZ-CONTRACT-2026-P1)
**Owner:** OGz AI · Alhareth Habbar
**Last updated:** 12 May 2026
**Status:** Build-ready · MVP scope locked

---

## 1. What you're building

A backend service that scores any Saudi SME's brand presence from their public Instagram handle, produces five dimension scores (0–100 each), and outputs a JSON payload that powers the shareable Score Card webpage.

The webpage is already designed and templated (`/score-cards/hungry-house`). Your job is the engine that fills in every number on that page with real, defensible data — for any handle the user enters, in under 60 seconds.

This document assumes you have:

- Read the Score Card design (`ogzai-score-card-hungry-house.html`)
- Access to OGz's fal.ai account, DeepSeek API, and Supabase project
- Familiarity with the existing 88-chain architecture and BrandDNA V2 schema

If any of those are unclear, raise it before starting Wave 1.

---

## 2. End-to-end flow

```
User enters @handle on score.ogzai.com
        ↓
[ingestion] Fetch last 30 public posts via Instagram Graph API or scraper
        ↓
[parallel] Run 5 dimension scorers
   ├── Visual Quality (vision API)
   ├── Cultural Fit (DeepSeek + Saudi calendar)
   ├── Posting Consistency (pure math)
   ├── Brand Coherence (vision + color extraction + tone classifier)
   └── Engagement Health (Graph API metrics)
        ↓
[aggregate] Weighted sum → 0–100 overall score
        ↓
[competitor] Find top 5 in 3km radius, score each (cached 7-day TTL)
        ↓
[store] Write to Supabase (5 tables)
        ↓
[render] Webpage reads JSON via Next.js
        ↓
[share] WhatsApp deeplink with OG image
```

**Target latency:** P50 under 45 seconds, P95 under 90 seconds. Most time is spent in vision API calls — parallelize aggressively.

**Cost per scan:** ~$0.40 in API calls (mostly vision). Detailed breakdown in §10.

---

## 3. Data ingestion

### 3.1 Source

**Primary:** Instagram Graph API (via Meta Business account)
**Fallback:** Public profile scraper (RapidAPI Instagram Scraper or Apify)

We must use Graph API for any handle that has authorized OGz AI. For unauthorized handles (the free score-card use case), we scrape public profiles. The scraper is rate-limited; cache aggressively.

### 3.2 What we pull

For each scan of a handle, fetch:

| Field                                              | Source     | Required for            |
| -------------------------------------------------- | ---------- | ----------------------- |
| `handle`                                         | input      | all                     |
| `name`                                           | profile    | display                 |
| `bio`                                            | profile    | location parse          |
| `followers_count`                                | profile    | engagement health       |
| `posts` (last 30)                                | media feed | all dimensions          |
| `posts[].media_url`                              | media      | vision analysis         |
| `posts[].caption`                                | media      | cultural fit, coherence |
| `posts[].timestamp`                              | media      | consistency             |
| `posts[].likes`, `comments`                    | media      | engagement              |
| `insights.saves` (if authorized)                 | Graph API  | engagement (else null)  |
| `insights.audience_active_hours` (if authorized) | Graph API  | consistency prime-time  |

Posts that are videos: keep timestamp and caption, skip image analysis. For MVP, count videos in cadence math but score them as "not analyzed" for visual quality (cap that dimension's max score impact accordingly — see §5.1).

### 3.3 Handle resolution

Users type `@hungryhouse_riyadh` or `hungryhouse_riyadh` or paste a full Instagram URL. Strip everything but the handle. Case-insensitive. Validate against Instagram before kicking off the scan (one extra request — worth it to fail fast on typos).

### 3.4 Failure modes

| Failure                               | Handling                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Private account                       | Halt scan. Return error: "Make profile public for 24h to scan."                                        |
| Account < 10 posts                    | Proceed but mark `score_status="preliminary"`. Display warning on card.                              |
| Account inactive 90+ days             | Proceed but mark `score_status="stale"`. Display warning.                                            |
| Graph/scraper rate limit              | Queue with exponential backoff, max 3 retries. After failure, return error with retry-after timestamp. |
| Image download fails (1–5 out of 30) | Continue with available images. Mark in metadata.                                                      |
| Image download fails (>5 out of 30)   | Halt scan. Return error.                                                                               |

---

## 4. Storage schema (Supabase)

Five tables. All under the `scoring` schema for namespace cleanliness.

### 4.1 `scoring.score_cards`

One row per scan.

```sql
CREATE TABLE scoring.score_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL,
  brand_name_en text,
  brand_name_ar text,
  sector text NOT NULL,  -- 'fnb' | 'beauty' | 'retail' | 'other'
  location_city text,
  location_neighborhood text,
  location_lat numeric,
  location_lng numeric,
  followers_count int,
  posts_analyzed int NOT NULL,
  overall_score int NOT NULL,  -- 0-100
  score_status text DEFAULT 'complete',  -- 'complete' | 'preliminary' | 'stale'
  scanned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,  -- now() + 7 days for free, longer for subs
  brand_dna_id uuid REFERENCES branddna.brands(id),  -- null for unauth scans
  share_slug text UNIQUE NOT NULL,  -- "hungry-house" for URL
  share_views int DEFAULT 0,
  share_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_score_cards_handle ON scoring.score_cards(handle);
CREATE INDEX idx_score_cards_share_slug ON scoring.score_cards(share_slug);
CREATE INDEX idx_score_cards_expires ON scoring.score_cards(expires_at);
```

### 4.2 `scoring.score_dimensions`

Five rows per scan — one per dimension.

```sql
CREATE TABLE scoring.score_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id uuid REFERENCES scoring.score_cards(id) ON DELETE CASCADE,
  dimension text NOT NULL,  -- 'visual_quality' | 'cultural_fit' | 'posting_consistency' | 'brand_coherence' | 'engagement_health'
  score int NOT NULL,  -- 0-100
  weight numeric NOT NULL,  -- 0.0-1.0
  benchmark int,  -- sector p50 for this dimension
  submetrics jsonb NOT NULL,  -- dimension-specific breakdown
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_dim_card ON scoring.score_dimensions(score_card_id);
```

### 4.3 `scoring.score_findings`

The specific evidence strings shown on the card. Variable count per scan (typically 1–3 per dimension).

```sql
CREATE TABLE scoring.score_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id uuid REFERENCES scoring.score_cards(id) ON DELETE CASCADE,
  dimension text NOT NULL,
  finding_en text NOT NULL,
  finding_ar text NOT NULL,
  evidence_count int,  -- e.g. 8 (for "8 of 30")
  evidence_total int,  -- e.g. 30
  benchmark_count int,  -- e.g. 21 (sector benchmark for "21 of 30")
  severity text,  -- 'high' | 'mid' | 'low' — controls UI emphasis
  created_at timestamptz DEFAULT now()
);
```

### 4.4 `scoring.score_actions`

Recommended workflows + estimated point lifts. One per dimension typically.

```sql
CREATE TABLE scoring.score_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id uuid REFERENCES scoring.score_cards(id) ON DELETE CASCADE,
  dimension text NOT NULL,
  workflow_id text NOT NULL,  -- 'workflow_3' | 'chain_c1' | 'branddna_onboarding' etc.
  action_label_en text NOT NULL,
  action_label_ar text NOT NULL,
  estimated_lift int NOT NULL,  -- 0-50
  timeframe_weeks int NOT NULL,
  icon_emoji text,
  created_at timestamptz DEFAULT now()
);
```

### 4.5 `scoring.competitor_scores`

Denormalized — every score card row has up to 6 competitor rows.

```sql
CREATE TABLE scoring.competitor_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id uuid REFERENCES scoring.score_cards(id) ON DELETE CASCADE,
  competitor_handle text NOT NULL,
  competitor_name text NOT NULL,
  competitor_score int NOT NULL,
  distance_meters int,
  location_label text,  -- "King Abdulaziz Rd · 2 streets"
  rank int NOT NULL,  -- 1-6, where the focal brand is one of these
  is_focal_brand boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```

### 4.6 `scoring.sector_benchmarks`

Refreshed monthly. Used by the scorers as reference points.

```sql
CREATE TABLE scoring.sector_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector text NOT NULL,
  dimension text NOT NULL,
  submetric text NOT NULL,  -- 'sharpness' | 'posts_per_week' etc.
  p25 numeric,
  p50 numeric,
  p75 numeric,
  p90 numeric,
  sample_size int NOT NULL,
  computed_at timestamptz DEFAULT now(),
  UNIQUE(sector, dimension, submetric)
);
```

Initial seed for `fnb`: requires scraping ~1,247 Saudi F&B brands once, scoring them all, and computing percentiles. This is a one-time job before launch. Beauty (~800 brands) and Retail (~1,500 brands) follow for V2.

---

## 5. Dimension scorers

Each scorer is a pure function: `(posts, sector, benchmarks) → { score, submetrics, findings, action }`.

All five run in parallel via job queue.

### 5.1 Visual Quality — 20% weight

**Inputs:** all image posts (skip videos), sector
**Output:** integer 0–100

**Sub-metrics (each 0–100, averaged equally):**

1. **Sharpness** — Laplacian variance of grayscale image, normalized.

   ```python
   import cv2
   img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
   variance = cv2.Laplacian(img, cv2.CV_64F).var()
   # Normalize: 50 → score 50, 500+ → score 100
   sharpness = min(100, variance / 5)
   ```
2. **Lighting quality** — vision model classification per image.
   Send each image to Claude Vision (via fal.ai) with prompt:

   ```
   Classify the lighting in this image into one of:
   - "natural" (window/sunlight) — score 90
   - "studio" (intentional setup) — score 100
   - "warm_ambient" (restaurant/cafe interior) — score 70
   - "fluorescent" (flat ceiling light) — score 30
   - "mixed" — score 50
   - "underexposed" — score 20
   Return only the classification string.
   ```
3. **Composition** — vision model assesses rule of thirds + negative space.

   ```
   Score this image's composition 0–100 based on:
   - Subject placement (rule of thirds or intentional centering): up to 50
   - Use of negative space: up to 30
   - Visual balance: up to 20
   Return only an integer.
   ```
4. **Sector-specific appeal** (F&B only for MVP):

   ```
   For this food image, return JSON:
   { "steam_visible": bool, "freshness_visible": bool,
     "plating_quality": "high|mid|low", "appetite_appeal": int 0-100 }
   ```

**Final score:**

```
visual_quality = mean(sharpness, lighting, composition, appeal)
```

**Findings to generate:**

- Count of posts with each lighting type → "19 of 30 shot under fluorescent ceiling light"
- Steam visibility count vs benchmark → "8 with steam visible. Sector benchmark: 21/30"
- Negative space % → "0 of 30 use plate composition with negative space"

**Action:** Always recommend `workflow_3` (Real Photo Enhancement). Lift estimate = `(75 - current_score)` capped at +30.

**Edge cases:**

- Video-heavy account (>50% videos): cap max score at 75 with footnote, recommend mixing in static posts
- Fewer than 10 images analyzed: mark dimension "preliminary"

---

### 5.2 Cultural Fit — 30% weight

**Inputs:** all posts (captions + image), sector, Saudi cultural calendar
**Output:** integer 0–100

**This is the moat dimension. Spend extra implementation care here.**

**Sub-metrics:**

1. **Language distribution (30% of dimension)** — DeepSeek classifies each caption:

   ```
   Classify this Instagram caption into ONE category:
   - "msa" — Modern Standard Arabic
   - "najdi" — Najdi (central Saudi) dialect
   - "hejazi" — Hejazi (western Saudi) dialect
   - "eastern" — Eastern Saudi dialect
   - "english_only" — English only
   - "mixed" — Arabic + English mixed
   - "other_arabic" — other Arabic dialect (Egyptian, Levantine, etc.)
   Return only the category string.

   Caption: "{caption_text}"
   ```

   Score this sub-metric by:

   - Posts in target dialect (matching brand's location): +full credit
   - Posts in MSA: +60% credit (acceptable but suboptimal)
   - Posts in English only: +30% credit (loses Arab audience)
   - Posts in non-Saudi Arabic: +20% credit (wrong dialect for KSA)
2. **Occasion alignment (50% of dimension)** — match post timestamps against Saudi calendar.

   Saudi cultural moments to track:

   ```python
   OCCASIONS_2026 = {
     "ramadan":       (date(2026, 2, 17), date(2026, 3, 19)),
     "eid_fitr":      (date(2026, 3, 20), date(2026, 3, 22)),
     "eid_adha":      (date(2026, 5, 27), date(2026, 5, 30)),
     "founding_day":  (date(2026, 2, 22), date(2026, 2, 22)),
     "national_day":  (date(2026, 9, 23), date(2026, 9, 23)),
     "mothers_day":   (date(2026, 3, 21), date(2026, 3, 21)),
   }
   ```

   For each occasion in the last 12 months:

   - Did they post during the window? +1 (hit)
   - Did they post within 3 days after the window? +0.3 (late)
   - Otherwise: 0 (miss)

   Then verify the post is *actually about* the occasion using DeepSeek:

   ```
   Is this caption about {occasion_name}? Return only "yes" or "no".
   Caption: "{caption}"
   ```

   Score = (hits + 0.3 * lates) / total_occasions_in_window × 100
3. **Cultural appropriateness (20% of dimension)** — flag anything that would hurt a Saudi brand:

   - Alcohol visible in images
   - Pork in images (F&B)
   - Inappropriate dress for the brand's tier
   - Foreign holidays celebrated as primary occasions (Christmas, Halloween, Valentine's depending on brand context)

   Use Claude Vision per image:

   ```
   Does this image contain any of: alcohol, pork, immodest dress for a Saudi
   conservative brand context? Return JSON: { "violations": [list], "severity": "high|mid|low|none" }
   ```

   Score = 100 - (severity penalties), where each "high" = -20, "mid" = -10, "low" = -3.

**Findings to generate:**

- Language breakdown: "14 captions in MSA / 11 dialect / 5 English"
- Engagement multiplier: compute average engagement per language bucket, report ratio: "Your dialect posts get 3.2× more engagement than your MSA posts"
- Missed occasions: list specific misses with dates: "0 Ramadan posts during March 11 – April 10"
- Late posts: "Saudi National Day 2025: 1 generic post 4 days late"

**Action:** Recommend specific cultural chains: `chain_c1` (Ramadan), `chain_c2` (Eid Fitr), `chain_c4` (National Day) — pick the next 1–2 missed/upcoming occasions. Lift = +20–25.

---

### 5.3 Posting Consistency — 15% weight

**Inputs:** post timestamps only. No AI needed. Pure math.
**Output:** integer 0–100

**Sub-metrics:**

1. **Cadence (40%)** — posts per week vs sector benchmark.

   ```
   posts_per_week = total_posts_last_60_days / (60/7)
   cadence_score = min(100, (posts_per_week / benchmark.p50) * 100)
   ```
2. **Gap penalty (20%)** — longest silent stretch.

   ```
   longest_gap_days = max(time_between_consecutive_posts)
   gap_score = 100 - min(100, longest_gap_days * 3)
   # 0-day gap = 100, 7-day = 79, 17-day = 49, 33+ day = 0
   ```
3. **Prime-time hit rate (40%)** — what % of posts during audience active window.

   If Graph API insights authorized: use actual audience active hours.
   Else, use sector defaults:

   - F&B: 6pm–9pm Saudi time (hungry hour)
   - Beauty: 8pm–11pm Saudi time (evening routine)
   - Retail: 7pm–10pm Saudi time (after-work browse)

   ```
   prime_time_score = (posts_in_window / total_posts) * 100
   ```

**Findings:**

- "Posts {N} per week. Sector benchmark: {benchmark}/week."
- "{N}-day gap between {date_a} and {date_b} — longest silence."
- "{pct}% posted between {bad_hour_start} and {bad_hour_end}." (Construct the negative finding when prime-time score is low — describe what hour they ARE posting in, not just that they're missing prime time. Specificity hits harder.)

**Action:** Always recommend AI Content Calendar automation. Lift = `(85 - current_score)` capped at +35.

---

### 5.4 Brand Coherence — 20% weight

**Inputs:** all image posts (skip videos), captions
**Output:** integer 0–100

**Sub-metrics:**

1. **Color palette coherence (30%)** — count of distinct dominant colors across all posts.

   ```python
   from sklearn.cluster import KMeans
   # For each image, extract top 3 dominant colors via k-means (k=3)
   all_colors = []
   for img in images:
       kmeans = KMeans(n_clusters=3).fit(img.reshape(-1, 3))
       all_colors.extend(kmeans.cluster_centers_)
   # Cluster all dominant colors with k-means k=10
   palette_clusters = KMeans(n_clusters=10).fit(all_colors)
   # Find the top 4 clusters by point density
   # If 80%+ of dominant colors fall in top 4 clusters → score high
   ```

   Score = `(density_in_top_4_clusters / total_colors) * 100`
2. **Typography coherence (25%)** — count of distinct font *styles* (not exact fonts; that's V2).

   Use Claude Vision per image that contains visible text:

   ```
   Does this image contain text? If yes, classify the dominant font style:
   "serif" | "sans-serif" | "display" | "script" | "handwritten" | "monospace"
   Return JSON: { "has_text": bool, "font_style": string | null }
   ```

   Score = `100 - ((distinct_styles_count - 1) * 15)` — 1 style = 100, 2 = 85, 3 = 70, 7 = 10.
3. **Logo coherence (25%)** — perceptual hash comparison of logo region.

   Logo is usually in the top-left or top-right corner. For each image, crop a 120×120 region from likely logo positions. Compute pHash. Cluster pHashes — if 80%+ fall in one cluster, score high; if scattered, score low.

   ```python
   import imagehash
   from PIL import Image
   hashes = [imagehash.phash(Image.open(img).crop((0, 0, 120, 120))) for img in images]
   # Pairwise distance matrix, count pairs within distance threshold of 8
   close_pair_ratio = ...
   logo_score = close_pair_ratio * 100
   ```
4. **Voice coherence (20%)** — DeepSeek classifies caption tone:

   ```
   Classify this caption's tone:
   "formal" | "casual" | "promotional" | "storytelling" | "instructional"
   Caption: "{caption}"
   ```

   Score = `100 - ((distinct_tones_count - 1) * 20)`. Cap at 0.

**Findings:**

- "Across {N} posts: {fonts_count} different fonts, {palettes_count} color palettes, {logo_variants} logo variations."
- "Caption tone splits: {N} formal, {N} casual, {N} promotional — {tones_count} different brands talking."

**Action:** Always recommend `branddna_onboarding`. Lift = `(80 - current_score)` capped at +30.

---

### 5.5 Engagement Health — 15% weight

**Inputs:** Graph API metrics. No AI needed.
**Output:** integer 0–100

**Sub-metrics (each scored vs sector benchmark p50):**

1. **Save rate (30%)** — `saves / impressions` (Graph API only — if unauthorized, fallback to `comments_rate * 0.8` as proxy)
2. **DM response time (25%)** — `avg(time_to_first_response)` in hours; Graph API insights
3. **Comments-to-followers ratio (25%)** — `total_comments_last_30_posts / followers / 30`
4. **Follower growth rate (20%)** — `(followers_today - followers_30d_ago) / followers_30d_ago`

For each sub-metric:

```
sub_score = min(100, (actual_value / benchmark.p50) * 50)
# So if you're at p50, you score 50. p100 = 100.
```

For DM response time, invert (lower is better):

```
sub_score = max(0, 100 - (response_hours / benchmark.p50) * 50)
```

**Findings:**

- "Save rate {N}% (sector median: {benchmark}%)"
- "DM response time {hours} hours (sector median: {benchmark} minutes)"
- "Followers growing {pct}% monthly — but no one's saving your posts." (Construct narrative finding from sub-metric divergence)

**Action:** Recommend `workflow_4` (UGC Repost) + Captions Chain. Lift = +15.

---

## 6. Aggregate score

```python
def overall_score(dimensions):
    return round(
        dimensions["visual_quality"]     * 0.20 +
        dimensions["cultural_fit"]       * 0.30 +
        dimensions["posting_consistency"] * 0.15 +
        dimensions["brand_coherence"]    * 0.20 +
        dimensions["engagement_health"]  * 0.15
    )
```

That's it. Don't add bias terms, "AI smoothing," or other adjustments. The transparent linear weighting is the methodology — Sultan reads this and trusts it because he can verify it.

**Sanity check the math:**
Hungry House example from the design — 28×0.20 + 41×0.30 + 22×0.15 + 35×0.20 + 44×0.15 = 5.6 + 12.3 + 3.3 + 7.0 + 6.6 = **34.8 → 34**. Confirmed.

---

## 7. Competitor scoring

For the focal brand at `(lat, lng)` in `sector`:

1. **Discover candidates.** Query brands in our `scoring.score_cards` table:

   ```sql
   SELECT * FROM scoring.score_cards
   WHERE sector = $1
     AND ST_DWithin(
       ST_MakePoint(location_lng, location_lat)::geography,
       ST_MakePoint($2, $3)::geography,
       3000  -- 3km radius
     )
   ORDER BY overall_score DESC
   LIMIT 20;
   ```
2. **If fewer than 5 candidates exist:** trigger background scans for known brands in the area (we maintain a `scoring.known_brands` table seeded from Google Places + manual curation). Don't block the main scan — return what we have, refresh later.
3. **Pick the 5 displayed competitors:**

   - Top 1 in category (the local leader)
   - Top 1 chain brand if any (Albaik, Hardee's, etc. — recognizable name beats nearest)
   - 1 direct geographic competitor (nearest distance)
   - 1 below the focal brand's score (so they're not always at the bottom)
   - 1 randomized middle for variety
4. **Cache competitor scores 7 days.** Don't re-scan competitors on every focal-brand scan. Re-scan if `expires_at < now()`.
5. **Geographic labels.** For each competitor, generate a human-readable distance label:

   - `< 500m`: "2 streets" or "around the corner"
   - `< 1.5km`: "0.X km" + neighborhood name
   - `< 5km`: "X.X km" + neighborhood
   - Always include the road name when distance < 1km

---

## 8. Output JSON schema

This is what the webpage at `score.ogzai.com/{slug}` consumes. Lock this schema first — the frontend renders from it, and any change here breaks the page.

```json
{
  "schema_version": "1.0",
  "score_card_id": "uuid",
  "share_slug": "hungry-house",
  "scanned_at": "2026-05-12T14:22:00Z",
  "score_status": "complete",

  "brand": {
    "handle": "hungryhouse_riyadh",
    "name_en": "Hungry House",
    "name_ar": "هنغري هاوس",
    "sector": "fnb",
    "sector_label_en": "Fast Casual",
    "sector_label_ar": "وجبات سريعة",
    "city": "Riyadh",
    "neighborhood": "Al Wurud",
    "followers_count": 3200
  },

  "overall_score": 34,
  "score_tier": "low",

  "competitor_anchor": {
    "name": "Bukhara Express",
    "score": 46,
    "delta": -12,
    "distance_label_en": "2 STREETS AWAY · KING ABDULAZIZ RD",
    "distance_label_ar": "شارعين عنك · طريق الملك عبدالعزيز"
  },

  "neighborhood": [
    {
      "name": "Albaik",
      "score": 71,
      "tier": "high",
      "location_en": "Granada Mall · 1.4 km",
      "location_ar": "مول غرناطة · ١.٤ كم",
      "is_focal": false
    },
    "... 5 more entries with same shape, including is_focal:true for the user"
  ],

  "dimensions": [
    {
      "key": "visual_quality",
      "name_en": "Visual Quality",
      "name_ar": "جودة الصور",
      "weight": 0.20,
      "weight_description_en": "photography & composition",
      "weight_description_ar": "تصوير وتكوين",
      "score": 28,
      "tier": "low",
      "benchmark": 62,
      "spark_data": [18, 20, 16, 21, 17, 19, 22, 18, 15],
      "spark_label_en": "30 posts analyzed",
      "spark_label_ar": "٣٠ منشور",
      "finding_en": "Your last 30 posts: 8 with steam visible...",
      "finding_ar": "آخر ٣٠ منشور: ٨ بس فيها بخار...",
      "action": {
        "workflow_id": "workflow_3",
        "icon_emoji": "📸",
        "label_en": "Workflow 3 · Real Photo Enhancement...",
        "label_ar": "سير العمل ٣ · تحسين الصور...",
        "estimated_lift": 18,
        "timeframe_weeks": 6
      }
    },
    "... 4 more dimensions"
  ],

  "cultural_fit_deepdive": {
    "language_breakdown": { "msa": 14, "najdi": 11, "english": 5 },
    "occasions": [
      { "key": "ramadan", "status": "miss" },
      { "key": "eid_fitr", "status": "miss" },
      { "key": "eid_adha", "status": "hit" },
      { "key": "national_day", "status": "late" },
      { "key": "founding_day", "status": "miss" }
    ],
    "dialect_multiplier": 3.2,
    "dialect_multiplier_note_en": "more engagement on dialect posts vs MSA",
    "dialect_multiplier_note_ar": "تفاعل أعلى على منشوراتك باللهجة..."
  },

  "methodology": {
    "posts_analyzed": 30,
    "vision_pipeline": "fal.ai · FLUX.1 Dev classifier",
    "nlp_pipeline": "DeepSeek V3 + OGz dialect model",
    "benchmark_dataset_size": 1247,
    "benchmark_sector": "fnb",
    "weights": { "vq": 0.20, "cf": 0.30, "pc": 0.15, "bc": 0.20, "eh": 0.15 },
    "last_refresh": "2026-05-12T14:22:00Z",
    "formula": "Σ(dim × weight) / 100"
  }
}
```

**Tier mapping:**

- `low`: score < 40 (amber)
- `mid`: 40–69 (gold)
- `high`: 70+ (emerald)

---

## 9. Refresh cadence & job orchestration

### 9.1 Free tier (unauthenticated scan)

- One scan per handle per 7 days
- Stored 30 days then archived
- Anyone with the share URL can view until expiry

### 9.2 Paid one-time (SAR 99)

- Full report unlocked (all 5 competitor scores, methodology PDF, 90-day plan)
- Score refreshed once at unlock, then valid 30 days
- 90-day action plan emailed

### 9.3 Subscription (SAR 2,500/mo)

- Score refreshed weekly automatically (Mondays 06:00 AST)
- Historical trend lines stored indefinitely
- "What changed this week" callout generated from week-over-week deltas

### 9.4 Job queue

Use n8n (already in stack) for orchestration. Job types:

| Job                    | Trigger      | Steps                                                                          |
| ---------------------- | ------------ | ------------------------------------------------------------------------------ |
| `scan_handle`        | User input   | ingest → fan-out 5 scorers → aggregate → competitor scan → store → notify |
| `refresh_sub`        | Weekly cron  | re-scan all active subscriber handles                                          |
| `refresh_benchmarks` | Monthly cron | re-compute sector benchmarks from `score_cards` table                        |
| `cleanup_expired`    | Daily cron   | archive `score_cards` past `expires_at`                                    |

---

## 10. Cost per scan

Approximate API costs per single focal-brand scan (before competitor scan):

| Service                                      | Calls                  | Unit cost                | Subtotal           |
| -------------------------------------------- | ---------------------- | ------------------------ | ------------------ |
| fal.ai Vision (Claude Vision via fal proxy)  | 30 images × 3 prompts | $0.005 | $0.45           |                    |
| fal.ai Vision (cultural fit appropriateness) | 30 images × 1 prompt  | $0.005 | $0.15           |                    |
| DeepSeek V3 (language classification)        | 30 captions            | $0.0003 | $0.009         |                    |
| DeepSeek V3 (tone + occasion verification)   | 30 + 6 calls           | $0.0003 | $0.011         |                    |
| Instagram Graph API or scraper               | 1 profile + 30 media   | included / $0.02 | $0.02 |                    |
| Supabase storage                             | one write batch        | negligible               | < $0.001           |
| **Focal scan total**                   |                        |                          | **≈ $0.64** |

Competitor scan adds up to 5× the focal cost when fully refreshing — but with 7-day caching, most competitor scans are reads. Amortized: ~$0.30 added per scan.

**Total: ~$0.95 per fresh scan in API costs.** At free-tier scale, this is the unit economics constraint. Cap free scans per IP at 3 per month or require email gate after first scan.

---

## 11. MVP scope vs V2

### MVP (Phase 1, ship with launch)

- F&B sector only
- Images only (videos counted in cadence, skipped for visual analysis)
- Top 5 competitors from existing database + on-demand fill
- English + Arabic UI
- Free + paid one-time scans
- 7-day score expiry
- Sharpness via OpenCV, lighting/composition/appeal via Claude Vision
- Najdi vs MSA vs English language classification (no Hejazi/Eastern split)
- Saudi calendar: Ramadan, Eid Fitr, Eid Adha, National Day, Founding Day, Mother's Day

### V2 (Phase 2, post-launch within 8 weeks)

- Beauty + Retail sectors
- Custom-trained models replacing some Claude Vision calls (cost reduction)
- Hejazi/Eastern dialect detection
- Video frame extraction + analysis
- Subscription weekly refresh
- Score trend lines (historical comparison)
- "What changed this week" automated narrative

### V3 (deferred, Phase 3)

- Cross-platform scoring (Snapchat, TikTok)
- Predictive lift modeling (machine learning on the action → realized lift correlation, once we have data)
- White-label score cards for B2B agencies

---

## 12. Edge cases & failure handling

| Situation                                       | Behavior                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Handle doesn't exist                            | Return 404 with helpful "did you mean?"                                                                             |
| Account just made public, no posts yet          | Mark "preliminary," score off available posts, banner "Score will sharpen as you post more"                         |
| Account in non-Saudi market                     | Score still works but cultural fit defaults to MSA-friendly weights; show "Optimised for Saudi audience" disclaimer |
| Account in non-FMCG/Beauty/Retail sector        | Return "We don't score this sector yet — join the waitlist"                                                        |
| User shares card publicly, then deletes account | Card stays viewable until expiry, brand name shown, posts not displayed                                             |
| User requests deletion                          | Hard delete from `score_cards`, cascade delete all related rows                                                   |
| Score landed on Friday (sub refresh)            | Skip — Saudi weekend, low signal                                                                                   |

---

## 13. Acceptance criteria

To accept this build as complete, the following must be true:

- [ ] A new handle entered on `score.ogzai.com` produces a complete Score Card in under 90 seconds (P95)
- [ ] All five dimensions produce reproducible scores within ±2 points across two consecutive scans of the same handle
- [ ] The Score Card webpage renders correctly from the JSON output, matching the design at `/score-cards/hungry-house`
- [ ] WhatsApp share button opens a pre-filled message with the live score and competitor delta
- [ ] Cost per scan stays under $1.00 in API spend
- [ ] Methodology section shows all real numbers (1,247 brands, etc.)
- [ ] Arabic UI displays correctly in RTL with Hassan-voice copy
- [ ] Sector benchmark dataset (F&B, n=1,247) is populated and accessible
- [ ] Competitor scoring shows 6 brands including the focal brand, ranked by score
- [ ] Free-tier rate limiting prevents single-IP abuse (>3 scans/month)

---

## 14. Open questions for OGz (resolve before Wave 2)

1. **Free tier rate limiting.** Cap at 3 scans/month/IP, or require email after scan 1? Email gate = better lead capture, lower viral spread. Recommend: free first scan, email gate from scan 2.
2. **Methodology PDF.** Generated on the fly per brand (paid tier) or static document? Recommend: per-brand PDF using Puppeteer + the page template.
3. **Competitor opt-out.** If a brand wants their score removed from competitor strips for other brands, do we honor that? Recommend: yes, but only for paying customers.
4. **Cross-brand insights.** Can we use one brand's scoring data to inform another's recommendations (anonymized)? Recommend: yes, with explicit ToS clause. This is core to the data flywheel thesis.
5. **Failure communication.** If a scan fails mid-way, do we partial-render the card or block? Recommend: block + retry queue. A half-rendered card is worse than a clear "we'll have it ready in 5 min" message.

---

## 15. Build wave sequencing

**Wave 1 (weeks 1–3)**

- Ingestion (Graph API + scraper fallback)
- Storage schema migration
- Posting Consistency scorer (no AI — quickest win to prove pipeline)
- Engagement Health scorer (no AI)
- JSON output schema lock

**Wave 2 (weeks 3–5)**

- Visual Quality scorer (Claude Vision integration)
- Brand Coherence scorer (color + tone)
- Frontend wiring to Supabase

**Wave 3 (weeks 5–7)**

- Cultural Fit scorer (DeepSeek + calendar)
- Competitor scoring + neighborhood discovery
- Sector benchmark seeding (one-time scrape of 1,247 F&B brands)
- WhatsApp share + OG image generator

**Wave 4 (week 7–8)**

- Methodology PDF generation
- Refresh job (subscription weekly)
- Acceptance testing against design spec
- Production deploy

---

**End of spec.** Questions to alhareth@ogzstudios.com.
