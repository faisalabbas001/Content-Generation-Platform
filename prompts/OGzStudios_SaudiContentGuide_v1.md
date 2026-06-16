# OGz Studios — Saudi Content Generation Guide v1

**Scope:** Expert reference for all Saudi SME content generation.
**Used by:** COO (Haiku 4.5) when compiling CaptionContext for DeepSeek.
**Enforced by:** CCO (GPT-5) via method_adherence score.
**Version:** 1.0 · Phase 1 · Saudi Arabia F&B / Beauty / Retail baseline

---

## Part 1 — Arabic Font Selection by Dialect

The font is applied POST-GENERATION by Sharp in N8N-V01. DeepSeek must note the correct font hint inside `visual_brief_en` so V01 picks the right typeface. Arabic text is NEVER in image prompts — the font hint is English-only metadata.

| Dialect | Font | Character | When to Specify |
|---------|------|-----------|-----------------|
| `Najdi` | Noto Naskh Arabic | Traditional, warm, rooted in Riyadh / Najd heritage | Riyadh-centric brands, family F&B, mid-market heritage |
| `Hejazi` | Noto Naskh Arabic | Warm, classic, Mecca/Jeddah coastal warmth | Jeddah brands, pilgrimage-adjacent, warm hospitality |
| `Gulf` | Cairo | Modern, clean, lighter weight, cosmopolitan | Gulf-market brands, premium positioning, modern retail |
| `MSA_formal` | Noto Naskh Arabic | Neutral, professional, pan-Arab reach | Finance, Healthcare, Government, B2B |
| `MSA_accessible` | Noto Naskh Arabic | Neutral, mass-market, no regional markers | National chains, multi-city brands |
| `Mixed` | Noto Naskh Arabic | Default fallback | Unconfirmed dialect; use safe option |

**How to note in visual_brief_en:**
Append at the end of the English brief: `[FONT: Noto Naskh Arabic · Najdi]` or `[FONT: Cairo · Gulf]`.

---

## Part 2 — Sector Content Rules (Saudi-Specific)

### F&B (Food & Beverage)

**Default archetype:** Everyman (mass-market), Caregiver (family-service brands)
**Default voice:** intimate_humble → authoritative_warm at maturity
**Primary dialect:** Najdi (Riyadh), Hejazi (Jeddah), Gulf (Eastern Province)

**Content mix by intent:**
- Brand-Building: 40% emotional, 30% lifestyle, 20% product, 10% offer
- Conversion: 35% product, 25% offer, 25% emotional, 15% lifestyle
- Occasion (Ramadan/Eid): 50% cultural, 30% product, 20% emotional

**What Saudi F&B audiences respond to:**
- Family dining scenes (3+ people, multi-generational, warm lighting)
- Traditional dishes with storytelling: mandi, kabsa, harees, jareesh, dates, qahwa
- Authentic behind-the-scenes moments (chef hands, steam rising, fresh ingredients)
- Local city pride ("في قلب الرياض", "من جدة")
- Qahwa and dates culture — always high engagement regardless of brand sector

**What to avoid (Saudi F&B):**
- Solo eating shots — family-first culture; individual dining reads as lonely
- Western aesthetic clichés (chalkboard menus, mason jars, millennial pink)
- Alcohol-adjacent vocabulary, even metaphorical
- Daytime food content during Ramadan hours (Fajr → Maghrib)
- Pork-adjacent language or imagery in any form
- Heavy discount language for premium brands — erodes brand equity

**Visual brief standards for F&B:**
- Lighting: warm golden hour, candlelight, or soft natural window light
- Composition: overhead flatlay OR three-quarter lifestyle OR family hands reaching
- Mood: warmth, abundance, togetherness, hospitality
- Always include steam / freshness cues on hot dishes
- Color temperature: warm (never clinical white)

**Caption anatomy (F&B):**
- Lead with scene or emotion, not price or product name
- Product name appears sentence 2 or 3, not sentence 1
- Hashtags: 10–15 tags. Lead with dish name in Arabic, then city, then brand category
- Emoji: 2–4 max (food emoji are highest CTR: 🍗🥩🍖🌿)
- CTA: soft invitation ("تفضّلوا" / "زوروا") — never hard-push CTAs for mid-market

---

### Beauty & Wellness

**Default archetype:** Lover (premium), Caregiver (accessible)
**Default voice:** playful_curious (Lover) → intimate_humble (Caregiver)
**Primary dialect:** MSA_accessible or Hejazi

**Content mix by intent:**
- Brand-Building: 40% lifestyle, 30% educational, 20% product, 10% testimonial
- Conversion: 35% product showcase, 30% testimonial, 25% educational, 10% offer
- Occasion (pre-Eid): 50% product hero, 30% celebration lifestyle, 20% offer

**What Saudi beauty audiences respond to:**
- Before/after transformations (modest, no revealing imagery)
- Ingredient stories and authenticity claims ("مكونات طبيعية", "خالٍ من")
- Saudi-first beauty standards — modest coverage, abayas styled beautifully
- Self-care as self-respect — spiritual framing resonates ("اعتنِ بنفسك")
- Saudi female empowerment themes — subtle, aspirational, not confrontational

**What to avoid (Beauty):**
- Revealing imagery — even for secular brands, modesty is a commercial benefit
- Western body-image standards (extreme thinness, western beauty ideals)
- Alcohol-containing ingredient lists highlighted
- Medical health claims without evidence (CCO HARD_BLOCK)

**Visual brief standards for Beauty:**
- Lighting: soft studio, glowy skin lighting, or natural window diffusion
- Composition: close-up product hero OR hands/wrist lifestyle OR lifestyle portrait (modest)
- Mood: elegance, self-care, ritual, soft
- Color temperature: neutral-to-cool (cream, blush, white, champagne)

---

### Retail (Fashion / Abaya / Accessories)

**Default archetype:** Lover (premium abaya), Everyman (accessible fashion)
**Default voice:** editorial_dramatic (Lover premium) → intimate_humble (Everyman)
**Primary dialect:** MSA_accessible, Najdi, Hejazi

**Content mix by intent:**
- Brand-Building: 35% lifestyle, 35% product showcase, 20% cultural, 10% offer
- Conversion: 45% product hero, 25% offer, 20% testimonial, 10% lifestyle
- Occasion (Ramadan): 40% modest fashion lifestyle, 30% gift-giving, 30% product

**What Saudi retail audiences respond to:**
- Modest fashion that doesn't look restricted — flowing, elegant, purposeful
- Quality craftsmanship signals: fabric texture close-ups, tailoring detail, hand-finishing
- Family and sister occasions — Eid outfit coordination
- National Day editions — green/gold colorways, Saudi cultural markers
- Exclusivity and scarcity signals for premium brands

**What to avoid (Retail):**
- Non-hijab model photography for conservative brand positioning
- Price-led content for premium positioning (undermines luxury)
- Western street-fashion aesthetics (not aspirational in Saudi context)

---

### Healthcare (Clinics / Wellness / Nutrition)

**Default archetype:** Caregiver (clinics), Sage (expertise services)
**Default voice:** authoritative_warm → devotional_serene (high religious sensitivity)
**Primary dialect:** MSA_formal or MSA_accessible

**Hard rules (Healthcare):**
- No unsubstantiated health claims — any claim triggers CCO HARD_BLOCK
- No testimonials about medical outcomes
- Religious framing welcomed: "الصحة أمانة" type messaging scores well
- Expert credentials must be genuine and verifiable if referenced

**Content mix:** 45% educational, 30% trust-building, 20% service showcase, 5% community

---

## Part 3 — Saudi Occasion Content Playbook

Each occasion has: engagement window (lead days), content themes, content to avoid, and cadence rule override.

### Ramadan (Critical — engagement_multiplier: 2.5–2.8x)

**Lead time:** Begin Ramadan content 7–10 days before start. Wind down 3 days after Eid Al-Fitr.
**Peak engagement:** Asr to Fajr window. Post scheduling: 15:00, 17:00, 19:00, 21:00 AST.
**Content themes:** Iftar generosity, suhoor family, gratitude, giving, community, heritage dishes, qahwa, dates, sweets gifting.
**Content to avoid:** Daytime food photography (Fajr → Maghrib), solo dining, Western food, alcohol-adjacent, aggressive promotions, playful irony.
**Caption tone:** Elevated warmth, gratitude, slower cadence, longer sentences. "رمضان كريم" type openers only first 3 days — audiences fatigue quickly on generic Ramadan greetings.
**Cadence override:** `occasion_aligned` — every post should feel Ramadan-coherent, even product posts.

---

### Eid Al-Fitr (High — engagement_multiplier: 2.2–2.5x)

**Lead time:** 5 days before. Post on Eid day: celebratory, short, joyful.
**Content themes:** Family feast, Eid sweets, gifting, celebration, joy, new beginnings.
**Caption tone:** Joyful, short, celebratory. Eid day posts should be 1–2 sentences max.
**Best content types:** Sweets showcase, family gathering visuals, gift packaging.
**Cadence override:** `burst_then_quiet` — 3–4 high-energy posts over Eid days, then return to normal cadence.

---

### Eid Al-Adha (Critical for F&B — engagement_multiplier: 2.2x)

**Lead time:** 7 days before. Hajj season influence from 10 days before.
**Content themes:** Meat and grill celebration, mandi, kabsa, family feast, sacrifice generosity, Hajj spiritual context.
**Caption tone:** Celebratory + generous + proud. "ذبيحة مباركة" type framing.
**Best content types:** Grill and meat photography (highest-CTR for F&B this occasion), family feast, outdoor dining.
**For non-F&B brands:** Focus on gift-giving, Eid generosity, family gatherings.
**Cadence override:** `burst_then_quiet` — lead heavy, then post-Eid quiet.

---

### Saudi National Day — Sep 23 (High — engagement_multiplier: 1.9x)

**Lead time:** 10–14 days before. Build Saudi pride gradually.
**Content themes:** Traditional Saudi cuisine, heritage, قهوة عربية, dates, Saudi green/gold colors, pride in Saudi craftsmanship, "صنع في السعودية".
**Caption tone:** Proud, heritage-rooted, warm patriotism — NOT nationalistic or aggressive.
**Best content types:** Traditional dish photography with Saudi flag colors, behind-the-scenes heritage content, "since [year] we've been serving Saudi Arabia" narratives.
**What to avoid:** Non-Saudi cultural references, Western aesthetic, generic "Happy National Day" text-on-image (low engagement, low originality score).
**Color guidance for visual_brief_en:** Include "green #006C35 and gold #C8A84B accent tones" in brief.

---

### Saudi Founding Day — Feb 22 (Moderate — engagement_multiplier: 1.4x)

**Content themes:** Saudi heritage, pride, "منذ تأسيس المملكة" narratives, continuity, tradition.
**Caption tone:** Reverent, proud, heritage-rooted.
**Best for:** Mature brands, heritage-positioned brands. Launch-stage brands skip unless directly relevant.

---

### Winter / Riyadh Season — Dec (Moderate — engagement_multiplier: 1.4x)

**Content themes:** Outdoor dining (cooler weather), entertainment season, cozy experiences, premium gifting, year-end gratitude.
**Caption tone:** Warm, inviting, premium for Riyadh Season brands; grateful and reflective for year-end.

---

## Part 4 — Arabic Caption Anatomy (Saudi Mobile-First Rules)

### Sentence structure
- Optimal sentence length: **10–18 words** (Saudi mobile reading pattern)
- Max 3–4 sentences per caption before the hashtag block
- Line break after every 2 sentences — white space improves readability on mobile
- Never start with the brand name — start with scene, emotion, or question

### Opening line rules (by diagnostic_pattern)
- `story_opener`: Start with a moment — "في يوم جميل..." / "من مطبخنا إلى..."
- `question_opener`: Genuine question first — "ايش الأكلة اللي تفتكرها وقت الجوع؟"
- `claim_opener`: Confident statement — "الكبسة الحقيقية تبدأ من هنا."
- `observation_opener`: Quiet noticing — "الجو في الرياض اليوم يختلف..."

### Hashtag strategy
- Count: **8–15 hashtags** (Saudi audience engagement sweet spot; >20 signals spam)
- Order: [Arabic dish/product] → [brand category in Arabic] → [city] → [Saudi] → [sector English]
- Example: `#كبسة #مطعم_الرياض #مطعم_سعودي #رياض #سعودية #FoodPhotography`
- Never create hashtags with English in the middle of an Arabic phrase
- Always include at least one city hashtag

### Emoji usage (by brand tone)
| Brand tone | Emoji count | Type |
|-----------|------------|------|
| Conservative / religious-sensitive | 0–2 | ❤️ 🤍 ✨ only |
| Mid-market F&B | 2–4 | Food emojis + ❤️ |
| Casual / youth | 4–8 | Food + fun combinations |
| Premium luxury | 0–1 | Subtle, never loud |

### Numbers in Arabic captions
- Heritage/traditional brands: Arabic-Indic numerals (٣، ٢٠٢٦، ٢٥٪)
- Modern/tech/youth brands: Western Arabic numerals (3, 2026, 25%)
- Prices: always in SAR, format: "١٢٠ ريال" or "120 SAR"

### CTA placement rules
- CTA always on its own line, always last
- `soft_invitation`: "تفضّلوا علينا" / "يسعدنا استقبالكم"
- `direct_ask`: "اطلب الآن" / "احجز مكانك عبر الرابط في البايو"
- `open_question`: "وأنتم؟ ايش وجبتكم المفضلة؟"
- `community_call`: "شاركونا تجربتكم في التعليقات 💬"

---

## Part 5 — Visual Brief Writing Standards for N8N-V01

`visual_brief_en` must be English-only (Hard Rule #3). V01 uses this brief to generate images via Weavy.ai (Nano Banana default, Flux Ultra for first-ever posts).

### Mandatory fields in every brief
1. **Subject:** What is the main subject? ("a family sharing a mandi dish", "a traditional Saudi coffee cup")
2. **Lighting:** Type and quality ("warm golden hour", "dramatic studio lighting", "soft natural window light")
3. **Composition:** Shot type ("overhead flatlay", "three-quarter lifestyle shot", "close-up detail")
4. **Mood:** One adjective pair ("warm and inviting", "luxurious and refined", "playful and fresh")
5. **Color direction:** Brand colors in English ("warm reds and golds", "cream and sage green")
6. **Font hint:** `[FONT: Noto Naskh Arabic · Najdi]` — appended at end

### Saudi cultural markers to include
- For F&B traditional: "steam rising", "fresh herbs", "copper/clay vessels", "family hands reaching"
- For F&B modern: "clean surfaces", "premium plating", "professional kitchen glimpse"
- For Beauty: "soft skin glow", "modest styling", "elegant hand placement"
- For Retail/Fashion: "flowing fabric", "modest silhouette", "Eid-appropriate styling"
- For National Day: "green and gold accents", "Saudi traditional elements"

### Visual brief by sector template

**F&B traditional:**
`"Warm editorial food photography, golden-hour light from the right, a family of four hands reaching toward a large copper dish of steaming kabsa on a woven majlis setting. Mood: abundant, generous, familial. Colors: warm amber, copper, cream. [FONT: Noto Naskh Arabic · Najdi]"`

**F&B modern/café:**
`"Clean product photography, diffused natural window light, a specialty coffee in a ceramic cup with minimalist styling on a light marble surface. Mood: refined, calm, crafted. Colors: cream, charcoal, sage green. [FONT: Cairo · Gulf]"`

**Beauty:**
`"Soft close-up photography, diffused studio light, a woman's hand applying a serum with glowing skin visible. Modest styling, no face shown. Mood: luxurious, self-care, gentle. Colors: blush, cream, champagne. [FONT: Noto Naskh Arabic · Hejazi]"`

**National Day:**
`"Heritage food photography, warm golden-hour light, a traditional Saudi spread with dates and qahwa in heritage copper vessels, subtle green and gold styling accents in the background. Mood: proud, heritage, celebratory. Colors: Saudi green #006C35, gold #C8A84B, cream. [FONT: Noto Naskh Arabic · Najdi]"`

---

## Part 6 — Sector Font & Tone Matrix

Quick-reference for COO when compiling CaptionContext Layer 5.

| Sector | Font | Voice Register | Tone Summary |
|--------|------|----------------|--------------|
| F&B (traditional) | Noto Naskh Arabic | intimate_humble | Warm, familial, modest, community-first |
| F&B (modern/café) | Cairo | crafted_precise | Refined, confident, quality-forward |
| Beauty (premium) | Cairo or Noto Naskh | playful_curious | Aspirational, self-care, sensory |
| Beauty (accessible) | Noto Naskh Arabic | intimate_humble | Caring, safe, relatable |
| Retail (premium) | Cairo | authoritative_warm | Elevated, editorial, exclusivity |
| Retail (accessible) | Noto Naskh Arabic | intimate_humble | Accessible, community, occasion-led |
| Healthcare | Noto Naskh Arabic | authoritative_warm | Expert, trustworthy, caring |
| Finance | Noto Naskh Arabic | devotional_serene | Calm authority, no urgency |
| Government | Noto Naskh Arabic | authoritative_warm | Institutional, formal, accessible |

---

## Part 7 — Negative Content Patterns (Saudi Market)

These patterns are cultural-layer prohibitions beyond the brand-specific HARD_BLOCKs. CCO flags these across all brands.

### Always HARD_BLOCK
- Any food or lifestyle content implying alcohol consumption, even metaphorically ("tastes like wine", "intoxicating flavor")
- Pork-adjacent terminology in F&B content
- Health or medical outcome claims without qualifications
- Content implying gender mixing in conservative-brand contexts
- Images of unveiled women for brands that have set `religious_sensitivity: High`

### STRONG_WARN (require human review)
- "Best in [city]" / "No. 1" claims — requires substantiation
- Competitor brand mentions (even positive ones create legal exposure)
- Content that references specific Hijri dates inaccurately (embarrassing for brand)
- Price comparison language without current accuracy
- Celebrity/influencer implied endorsements without formal agreement

### SOFT_WARN (flag but allow with care)
- Humor about cultural norms (can land perfectly or land wrong; needs CCO score ≥ 80)
- English mixed into primarily Arabic captions for non-bilingual brands
- Occasion content more than 14 days early (audience fatigue on over-early occasion content)
