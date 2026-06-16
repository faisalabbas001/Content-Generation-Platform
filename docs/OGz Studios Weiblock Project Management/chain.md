1

2

3

4

5

6

7

8

9

10

11

12

13

14

15

16

17

18

19

20

21

22

23

24

25

OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 1 of 75
O G Z S T U D I O S · O P E N C L A W
Production Chain Library
Phase 1 Build Specification
Complete chain registry, prompt templates, JSON specifications, and parameter
mappings for all 26 production chains across the Universal, F&B, Retail, Beauty, and
Video layers.
P R E P A R E D B Y
OGz Studios
F O R
Weiblock — Phase 1
V E R S I O N
v1.0 · April 2026
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 2 of 75
How to Read This Document
This document defines every production chain Weiblock will build for OpenClaw Phase 1. It contains 26
chains organized into five layers: 6 universal chains that work across all sectors, 5 F&B-specific chains, 5
beauty-specific chains, 5 retail-specific chains, and 5 video chains.
Each chain entry contains four sections. The Specification table gives the chain's identity, fal.ai model,
cost, and governance metadata. The Parameter Mapping table shows how BrandDNA fields populate
the prompt template. The Description explains when and why this chain is used. The JSON
Implementation gives the complete database record that Weiblock should insert into the
prompt_templates table in Supabase.
The CEO agent reads chain metadata to decide which chain to assign to each calendar slot. N8N-V01
then reads the JSON template, resolves parameter values from the client's BrandDNA, assembles the
final fal.ai payload, and executes generation. Adding a new chain in the future is one new database row
and one new template — the workflow itself does not need rebuilding.
Document Structure
Chains are presented in build order: Universal first (Wave 1, weeks 1-6), then sector-specific static
(Wave 2, weeks 7-10), then video (Wave 3, weeks 11-14). This sequence matches the recommended
Weiblock build cadence and ensures that every client has working content from Day 1, with sector
specialization and video upsells coming online before Ramadan 2027 preparation begins.
Chain Registry Summary
All 26 chains at a glance. Frequency = posts per week per active client. Cost = USD per generation.
I D C H A I N N A M E L A Y E R T I E R F A L . A I M O D E L C O S T F R E Q /
W K
U01 Product Hero Static Universal T1 flux/dev $0.025 3-5
U02 Promotional Offer Universal T1 gpt-image-2 $0.100 2-3
U03 Occasion Greeting Universal T1 flux/dev $0.025 1 (per
active
occasion
)
U04 Behind the Scenes Universal T1 flux/dev $0.025 1-2
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 3 of 75
U05 Social Proof Universal T1 flux/dev $0.025 1
U06 New Arrival / Launch Universal T1 flux-pro/v1.1 $0.050 1-2
F01 Hot Food Hero F&B Sector T1 flux/dev $0.025 3-5
F02 Beverage Showcase F&B Sector T1 flux/dev $0.025 3-4
F03 Ramadan Iftar Spread F&B Sector T1 flux-pro/v1.1 $0.050 2-3
during
Ramada
n
F04 Menu Price Card F&B Sector T1 gpt-image-2 $0.100 0.5
F05 Cloud Kitchen Packaging F&B Sector T1 flux-pro/kontext $0.040 1
B01 Before / After Service Beauty Sector T1 flux-pro/kontext $0.040 1-2
B02 Service Showcase Static Beauty Sector T1 flux/dev $0.025 3-4
B03 Product Flat Lay Beauty Sector T1 flux-pro/kontext $0.040 1-2
B04 Booking CTA Beauty Sector T1 flux/dev $0.025 1-2
B05 Bridal Beauty Package Beauty Sector T1 flux-pro/v1.1 $0.050 1
(during
wedding
season)
R01 Apparel Flat Lay Retail Sector T1 flux/dev $0.025 3-5
R02 Apparel On-Model Retail Sector T1 flux-pro/v1.1 $0.050 2-3
R03 Price Tag Reveal Retail Sector T1 gpt-image-2 $0.100 1-2
R04 Collection Story Retail Sector T1 flux-pro/v1.1 $0.050 0.5
R05 Fragrance / Oud Showcase Retail Sector T1 flux-pro/v1.1-ultra $0.070 1-2
V01 Ramadan Atmosphere Clip Video — Tier 2 T2 kling-video/v1.6/pro/
image-to-video
$0.700 1 during
Ramada
n
V02 Before/After Transition Video — Tier 2 T2 kling-video/v1.6/pro/
image-to-video
$0.490 1
V03 Product Unboxing Loop Video — Tier 2 T2 kling-video/v1.6/pro/
image-to-video
$0.420 1
V04 Occasion Announcement Video — Tier 2 T2 seedance-2.0 $0.980 1 per
active
occasion
V05 New Arrival Reveal Video — Tier 2 T2 kling-video/v1.6/pro/
image-to-video
$0.700 1
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 4 of 75
Total chain cost if every chain runs once: $4.26 USD. Tier 1 chains (static images): $0.97. Tier 2 chains
(video): $3.29. A typical Starter client uses 18-22 Tier 1 generations per month at an average cost of
~$0.60-1.00 per month — well within the SAR 195 variable cost target.
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 5 of 75
Universal Chains
These six chains work across every sector. Build first. They cover roughly 60% of weekly content volume
for any active SME regardless of category.
U01 Product Hero Static
Single product on a clean background with strong directional lighting. The most common post type
across every sector — every SME posts this multiple times per week. The backbone of weekly calendar
generation.
S P E C I F I C A T I O N
S E C T O R S F&B, Retail, Beauty
F O R M A T T I E R Tier 1 (Static Image)
F A L . A I M O D E L fal-ai/flux/dev
C O S T P E R O U T P U T $0.025 USD
I N T E N T S T A T E S launch, grow, harvest
O C C A S I O N A F F I N I T Y None — always eligible
C O M P L I A N C E L E V E L standard
R E F E R E N C E I M A G E Not required
A R A B I C O V E R L A Y Sharp/Canvas post-gen: product_name, price_optional
G E N E R A T I O N M O D E Synchronous
F R E Q U E N C Y 3-5 posts per week per active client
P A R A M E T E R M A P P I N G
How each placeholder in the prompt template gets resolved at generation time. The COO agent assembles these
values from BrandDNA before n8n calls fal.ai.
P A R A M E T E R S O U R C E F A L L B A C K / M A P P I N G
{product_descriptor} BrandDNA.A.brand_differentiator Fallback: "premium product"
{background_color} BrandDNA.A.brand_color_secondar
y
Fallback: "clean white"
{quality_tier} BrandDNA.A.price_position budget→clean lifestyle / mid→professional /
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 6 of 75
premium→high-end editorial / luxury→ultra-
premium luxury
{lighting_style} BrandDNA.A.sector F&B→warm appetizing / Retail→bright clean
studio / Beauty→soft diffused beauty
P R O M P T T E M P L A T E
{product_descriptor} hero shot on {background_color} background, {quality_tier} commercial
photography, {lighting_style} lighting, sharp focus, high detail, centered composition, no
text, no people, no watermark
J S O N I M P L E M E N T A T I O N — I N S E R T I N T O p r o m p t _ t e m p l a t e s T A B L E
{
"template_id": "U01_prompt_v1",
"chain_id": "U01",
"version": 1,
"fal_model": "fal-ai/flux/dev",
"positive_prompt": {
"template": "{product_descriptor} hero shot on {background_color} background, {quality_tier}
commercial photography, {lighting_style} lighting, sharp focus, high detail, centered composition, no
text, no people, no watermark",
"parameters": {
"product_descriptor": {
"source": "BrandDNA.A.brand_differentiator",
"fallback": "premium product",
"type": "string"
},
"background_color": {
"source": "BrandDNA.A.brand_color_secondary",
"fallback": "clean white",
"type": "string"
},
"quality_tier": {
"source": "BrandDNA.A.price_position",
"mapping": {
"budget": "clean lifestyle",
"mid": "professional",
"premium": "high-end editorial",
"luxury": "ultra-premium luxury"
},
"type": "mapped_enum"
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 7 of 75
},
"lighting_style": {
"source": "BrandDNA.A.sector",
"mapping": {
"F&B": "warm appetizing",
"Retail": "bright clean studio",
"Beauty": "soft diffused beauty"
},
"type": "mapped_enum"
}
}
},
"negative_prompt": "text, watermark, logo, blurry, low quality, distorted, extra limbs, face, person,
ugly, deformed, signature",
"generation_params": {
"image_size": "square_hd",
"num_inference_steps": 28,
"guidance_scale": 3.5,
"num_images": 1,
"enable_safety_checker": true
},
"arabic_overlay": {
"enabled": true,
"fields": [
"product_name",
"price_optional"
],
"font": "Cairo",
"position": "bottom_center",
"background_opacity": 0.6
},
"cost_usd": 0.025,
"active": true
}
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 8 of 75
U02 Promotional Offer
Price-led content with discount, bundle, or limited-time offer. Second highest frequency content type.
Conversion-intent driven, Snapchat and Instagram Stories native. Uses GPT Image 2 because Arabic price
text needs compositional integration, not overlay.
S P E C I F I C A T I O N
S E C T O R S F&B, Retail, Beauty
F O R M A T T I E R Tier 1 (Static Image)
F A L . A I M O D E L fal-ai/gpt-image-2
C O S T P E R O U T P U T $0.100 USD
I N T E N T S T A T E S grow, harvest, defend
O C C A S I O N A F F I N I T Y ramadan, eid_alfitr, national_day
C O M P L I A N C E L E V E L standard
R E F E R E N C E I M A G E Not required
A R A B I C O V E R L A Y Disabled (text composed in-image)
G E N E R A T I O N M O D E Synchronous
F R E Q U E N C Y 2-3 posts per week per active client
P A R A M E T E R M A P P I N G
How each placeholder in the prompt template gets resolved at generation time. The COO agent assembles these
values from BrandDNA before n8n calls fal.ai.
P A R A M E T E R S O U R C E F A L L B A C K / M A P P I N G
{offer_type} Generation.input.offer_type Fallback: "limited time"
{product_descriptor} BrandDNA.A.brand_differentiator Fallback: "featured product"
{discount_value} Generation.input.discount_value Fallback: "30%"
{brand_color_primary} BrandDNA.A.brand_color_primary Fallback: "deep red"
{urgency_level} BrandDNA.A.tone_attributes calm→understated / energetic→bold /
playful→fun
{sector_visual_style} BrandDNA.A.sector F&B→appetizing food styling /
Retail→fashion editorial / Beauty→clean
beauty layout
P R O M P T T E M P L A T E
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 9 of 75
{offer_type} promotional poster, {product_descriptor} prominently displayed, {discount_value}
discount badge in {brand_color_primary}, urgent {urgency_level} typography in Arabic,
{sector_visual_style}, no watermark
J S O N I M P L E M E N T A T I O N — I N S E R T I N T O p r o m p t _ t e m p l a t e s T A B L E
{
"template_id": "U02_prompt_v1",
"chain_id": "U02",
"version": 1,
"fal_model": "fal-ai/gpt-image-2",
"positive_prompt": {
"template": "{offer_type} promotional poster, {product_descriptor} prominently displayed,
{discount_value} discount badge in {brand_color_primary}, urgent {urgency_level} typography in
Arabic, {sector_visual_style}, no watermark",
"parameters": {
"offer_type": {
"source": "Generation.input.offer_type",
"fallback": "limited time",
"type": "string"
},
"product_descriptor": {
"source": "BrandDNA.A.brand_differentiator",
"fallback": "featured product",
"type": "string"
},
"discount_value": {
"source": "Generation.input.discount_value",
"fallback": "30%",
"type": "string"
},
"brand_color_primary": {
"source": "BrandDNA.A.brand_color_primary",
"fallback": "deep red",
"type": "string"
},
"urgency_level": {
"source": "BrandDNA.A.tone_attributes",
"mapping": {
"calm": "understated",
"energetic": "bold",
"playful": "fun"
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 10 of 75
},
"type": "mapped_enum"
}
}
},
"negative_prompt": "blurry, low quality, watermark, distorted text, fake currency",
"generation_params": {
"image_size": "square_hd",
"quality": "high",
"num_images": 1
},
"arabic_overlay": {
"enabled": false
},
"cost_usd": 0.1,
"active": true
}
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 11 of 75
U03 Occasion Greeting
National holidays, Islamic occasions, seasonal moments. Auto-triggered by the occasion layer —
generated for the brand without client request. The differentiator is brand alignment in a sea of identical
generic greetings.
S P E C I F I C A T I O N
S E C T O R S F&B, Retail, Beauty
F O R M A T T I E R Tier 1 (Static Image)
F A L . A I M O D E L fal-ai/flux/dev
C O S T P E R O U T P U T $0.025 USD
I N T E N T S T A T E S launch, grow, defend, harvest, recover
O C C A S I O N A F F I N I T Y ramadan, eid_alfitr, eid_aladha, national_day, founding_day
C O M P L I A N C E L E V E L elevated
R E F E R E N C E I M A G E Not required
A R A B I C O V E R L A Y Sharp/Canvas post-gen: occasion_arabic_greeting, brand_signature
G E N E R A T I O N M O D E Synchronous
F R E Q U E N C Y 1 (per active occasion) posts per week per active client
P A R A M E T E R M A P P I N G
How each placeholder in the prompt template gets resolved at generation time. The COO agent assembles these
values from BrandDNA before n8n calls fal.ai.
P A R A M E T E R S O U R C E F A L L B A C K / M A P P I N G
{occasion_visual_motif
}
OccasionLayer.current.visual_motif Fallback: "celebratory composition"
{brand_color_palette} BrandDNA.A.brand_colors Fallback: "warm gold and deep navy"
{occasion_atmosphere} OccasionLayer.current.atmosphere ramadan→warm spiritual / eid→joyful
celebratory / national_day→proud regal /
founding_day→heritage proud
{sector_appropriate_se
tting}
BrandDNA.A.sector F&B→table setting / Retail→product flat lay /
Beauty→still life
P R O M P T T E M P L A T E
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 12 of 75
{occasion_visual_motif}, {brand_color_palette} color palette, {occasion_atmosphere}
atmosphere, {sector_appropriate_setting}, elegant composition, no text, no people facing
camera, no watermark
J S O N I M P L E M E N T A T I O N — I N S E R T I N T O p r o m p t _ t e m p l a t e s T A B L E
{
"template_id": "U03_prompt_v1",
"chain_id": "U03",
"version": 1,
"fal_model": "fal-ai/flux/dev",
"positive_prompt": {
"template": "{occasion_visual_motif}, {brand_color_palette} color palette, {occasion_atmosphere}
atmosphere, {sector_appropriate_setting}, elegant composition, no text, no people facing camera, no
watermark",
"parameters": {
"occasion_visual_motif": {
"source": "OccasionLayer.current.visual_motif",
"fallback": "celebratory composition",
"type": "string"
},
"brand_color_palette": {
"source": "BrandDNA.A.brand_colors",
"fallback": "warm gold and deep navy",
"type": "string"
}
}
},
"negative_prompt": "text, watermark, faces, cross, christmas, alcohol, pork, inappropriate symbols",
"generation_params": {
"image_size": "square_hd",
"num_inference_steps": 32,
"guidance_scale": 4,
"num_images": 1,
"enable_safety_checker": true
},
"arabic_overlay": {
"enabled": true,
"fields": [
"occasion_arabic_greeting",
"brand_signature"
],
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 13 of 75
"font": "Cairo",
"position": "center",
"background_opacity": 0.4
},
"cost_usd": 0.025,
"active": true
}
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 14 of 75
U04 Behind the Scenes
Process, preparation, the human behind the brand. Phone-camera aesthetic intentionally — authenticity
drives Instagram algorithm performance. Lower production cost, high engagement-to-reach ratio.
S P E C I F I C A T I O N
S E C T O R S F&B, Retail, Beauty
F O R M A T T I E R Tier 1 (Static Image)
F A L . A I M O D E L fal-ai/flux/dev
C O S T P E R O U T P U T $0.025 USD
I N T E N T S T A T E S grow, defend
O C C A S I O N A F F I N I T Y None — always eligible
C O M P L I A N C E L E V E L standard
R E F E R E N C E I M A G E Not required
A R A B I C O V E R L A Y Sharp/Canvas post-gen: process_caption_short
G E N E R A T I O N M O D E Synchronous
F R E Q U E N C Y 1-2 posts per week per active client
P A R A M E T E R M A P P I N G
How each placeholder in the prompt template gets resolved at generation time. The COO agent assembles these
values from BrandDNA before n8n calls fal.ai.
P A R A M E T E R S O U R C E F A L L B A C K / M A P P I N G
{sector_workspace} BrandDNA.A.sector F&B→kitchen counter / Retail→workshop
atelier / Beauty→salon station
{process_action} Generation.input.process_action Fallback: "craft work"
P R O M P T T E M P L A T E
Behind the scenes {sector_workspace}, {process_action} in progress, natural unposed
composition, soft window light, slight motion blur, authentic documentary style, no faces, no
logos, no watermark
J S O N I M P L E M E N T A T I O N — I N S E R T I N T O p r o m p t _ t e m p l a t e s T A B L E
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 15 of 75
{
"template_id": "U04_prompt_v1",
"chain_id": "U04",
"version": 1,
"fal_model": "fal-ai/flux/dev",
"positive_prompt": {
"template": "Behind the scenes {sector_workspace}, {process_action} in progress, natural unposed
composition, soft window light, slight motion blur, authentic documentary style, no faces, no logos, no
watermark",
"parameters": {
"sector_workspace": {
"source": "BrandDNA.A.sector",
"mapping": {
"F&B": "kitchen counter",
"Retail": "workshop atelier",
"Beauty": "salon station"
},
"type": "mapped_enum"
},
"process_action": {
"source": "Generation.input.process_action",
"fallback": "craft work",
"type": "string"
}
}
},
"negative_prompt": "faces, watermark, logos, polished studio, perfect, staged, ugly",
"generation_params": {
"image_size": "portrait_hd",
"num_inference_steps": 25,
"guidance_scale": 3,
"num_images": 1,
"enable_safety_checker": true
},
"arabic_overlay": {
"enabled": true,
"fields": [
"process_caption_short"
],
"font": "Cairo",
"position": "top_left",
"background_opacity": 0.5
},
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 16 of 75
"cost_usd": 0.025,
"active": true
}
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 17 of 75
U05 Social Proof
Customer review, rating screenshot, testimonial. Every SME has reviews — most never turn them into
content. Auto-triggered when new Google or Talabat review detected (Phase 2) or manually via
dashboard.
S P E C I F I C A T I O N
S E C T O R S F&B, Retail, Beauty
F O R M A T T I E R Tier 1 (Static Image)
F A L . A I M O D E L fal-ai/flux/dev
C O S T P E R O U T P U T $0.025 USD
I N T E N T S T A T E S grow, harvest, defend
O C C A S I O N A F F I N I T Y None — always eligible
C O M P L I A N C E L E V E L standard
R E F E R E N C E I M A G E Not required
A R A B I C O V E R L A Y Sharp/Canvas post-gen: review_text, rating_stars, customer_initial
G E N E R A T I O N M O D E Synchronous
F R E Q U E N C Y 1 posts per week per active client
P A R A M E T E R M A P P I N G
How each placeholder in the prompt template gets resolved at generation time. The COO agent assembles these
values from BrandDNA before n8n calls fal.ai.
P A R A M E T E R S O U R C E F A L L B A C K / M A P P I N G
{brand_color_primary} BrandDNA.A.brand_color_primary Fallback: "deep teal"
{sector_subtle_motif} BrandDNA.A.sector F&B→subtle plate silhouette / Retail→fabric
texture / Beauty→soft botanical
P R O M P T T E M P L A T E
Minimal testimonial card design, {brand_color_primary} accent, generous negative space,
premium typography placeholder area, {sector_subtle_motif} background element, no text, no
faces, no watermark
J S O N I M P L E M E N T A T I O N — I N S E R T I N T O p r o m p t _ t e m p l a t e s T A B L E
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 18 of 75
{
"template_id": "U05_prompt_v1",
"chain_id": "U05",
"version": 1,
"fal_model": "fal-ai/flux/dev",
"positive_prompt": {
"template": "Minimal testimonial card design, {brand_color_primary} accent, generous negative
space, premium typography placeholder area, {sector_subtle_motif} background element, no text, no
faces, no watermark",
"parameters": {
"brand_color_primary": {
"source": "BrandDNA.A.brand_color_primary",
"fallback": "deep teal",
"type": "string"
},
"sector_subtle_motif": {
"source": "BrandDNA.A.sector",
"mapping": {
"F&B": "subtle plate silhouette",
"Retail": "fabric texture",
"Beauty": "soft botanical"
},
"type": "mapped_enum"
}
}
},
"negative_prompt": "text, faces, busy composition, cluttered, watermark",
"generation_params": {
"image_size": "square_hd",
"num_inference_steps": 25,
"guidance_scale": 3,
"num_images": 1,
"enable_safety_checker": true
},
"arabic_overlay": {
"enabled": true,
"fields": [
"review_text",
"rating_stars",
"customer_initial"
],
"font": "Cairo",
"position": "center",
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 19 of 75
"background_opacity": 0
},
"cost_usd": 0.025,
"active": true
}
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 20 of 75
U06 New Arrival / Launch
New product, new menu item, new collection piece. Bold visual treatment with quality step-up —
launches deserve premium production. Drives follower saves: 'I need to remember this.'
S P E C I F I C A T I O N
S E C T O R S F&B, Retail, Beauty
F O R M A T T I E R Tier 1 (Static Image)
F A L . A I M O D E L fal-ai/flux-pro/v1.1
C O S T P E R O U T P U T $0.050 USD
I N T E N T S T A T E S launch, grow, harvest
O C C A S I O N A F F I N I T Y None — always eligible
C O M P L I A N C E L E V E L standard
R E F E R E N C E I M A G E Not required
A R A B I C O V E R L A Y Sharp/Canvas post-gen: new_arrival_label, product_name
G E N E R A T I O N M O D E Synchronous
F R E Q U E N C Y 1-2 posts per week per active client
P A R A M E T E R M A P P I N G
How each placeholder in the prompt template gets resolved at generation time. The COO agent assembles these
values from BrandDNA before n8n calls fal.ai.
P A R A M E T E R S O U R C E F A L L B A C K / M A P P I N G
{product_descriptor} Generation.input.product_descripto
r
Fallback: "new product"
{brand_color_primary} BrandDNA.A.brand_color_primary Fallback: "rich gold"
{quality_tier} BrandDNA.A.price_position budget→accessible / mid→refined /
premium→luxurious / luxury→couture
P R O M P T T E M P L A T E
{product_descriptor} dramatic reveal composition, {brand_color_primary} dramatic accent
lighting, premium {quality_tier} editorial photography, sharp product focus with subtle blur
background, no text, no watermark
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 21 of 75
J S O N I M P L E M E N T A T I O N — I N S E R T I N T O p r o m p t _ t e m p l a t e s T A B L E
{
"template_id": "U06_prompt_v1",
"chain_id": "U06",
"version": 1,
"fal_model": "fal-ai/flux-pro/v1.1",
"positive_prompt": {
"template": "{product_descriptor} dramatic reveal composition, {brand_color_primary} dramatic
accent lighting, premium {quality_tier} editorial photography, sharp product focus with subtle blur
background, no text, no watermark",
"parameters": {
"product_descriptor": {
"source": "Generation.input.product_descriptor",
"fallback": "new product",
"type": "string"
},
"brand_color_primary": {
"source": "BrandDNA.A.brand_color_primary",
"fallback": "rich gold",
"type": "string"
}
}
},
"negative_prompt": "text, watermark, blurry product, faces, distorted",
"generation_params": {
"image_size": "square_hd",
"num_inference_steps": 35,
"guidance_scale": 3.5,
"num_images": 1
},
"arabic_overlay": {
"enabled": true,
"fields": [
"new_arrival_label",
"product_name"
],
"font": "Cairo",
"position": "top_center",
"background_opacity": 0.6
},
"cost_usd": 0.05,
"active": true
}
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 22 of 75
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 23 of 75
F&B Sector Chains
Five chains tuned for restaurants, cafes, cloud kitchens, and specialty F&B. Highest posting frequency
cohort — F&B clients post 3-5 times daily during peak periods.
F01 Hot Food Hero
The dish at its best moment — steam, color, texture. Primary chain for restaurants and cafes. Used 3-5x
per week for active F&B accounts. Close-up composition with food styling parameters.
S P E C I F I C A T I O N
S E C T O R S F&B
F O R M A T T I E R Tier 1 (Static Image)
F A L . A I M O D E L fal-ai/flux/dev
C O S T P E R O U T P U T $0.025 USD
I N T E N T S T A T E S launch, grow, harvest
O C C A S I O N A F F I N I T Y None — always eligible
C O M P L I A N C E L E V E L standard
R E F E R E N C E I M A G E Not required
A R A B I C O V E R L A Y Sharp/Canvas post-gen: dish_name_arabic, price_optional
G E N E R A T I O N M O D E Synchronous
F R E Q U E N C Y 3-5 posts per week per active client
P A R A M E T E R M A P P I N G
How each placeholder in the prompt template gets resolved at generation time. The COO agent assembles these
values from BrandDNA before n8n calls fal.ai.
P A R A M E T E R S O U R C E F A L L B A C K / M A P P I N G
{dish_descriptor} Generation.input.dish_name Fallback: "signature dish"
{brand_color_palette} BrandDNA.A.brand_colors Fallback: "warm earth tones"
P R O M P T T E M P L A T E
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 24 of 75
{dish_descriptor} hero food photography, steam rising, fresh garnish detail,
{brand_color_palette} accent props, top-down or 45-degree angle, warm appetizing lighting,
shallow depth of field, no text, no watermark
J S O N I M P L E M E N T A T I O N — I N S E R T I N T O p r o m p t _ t e m p l a t e s T A B L E
{
"template_id": "F01_prompt_v1",
"chain_id": "F01",
"version": 1,
"fal_model": "fal-ai/flux/dev",
"positive_prompt": {
"template": "{dish_descriptor} hero food photography, steam rising, fresh garnish detail,
{brand_color_palette} accent props, top-down or 45-degree angle, warm appetizing lighting, shallow
depth of field, no text, no watermark",
"parameters": {
"dish_descriptor": {
"source": "Generation.input.dish_name",
"fallback": "signature dish",
"type": "string"
},
"brand_color_palette": {
"source": "BrandDNA.A.brand_colors",
"fallback": "warm earth tones",
"type": "string"
}
}
},
"negative_prompt": "text, watermark, raw uncooked, burnt, unappetizing, plastic looking, fake food,
alcohol, pork",
"generation_params": {
"image_size": "square_hd",
"num_inference_steps": 28,
"guidance_scale": 3.5,
"num_images": 1
},
"arabic_overlay": {
"enabled": true,
"fields": [
"dish_name_arabic",
"price_optional"
],
OpenClaw · Production Chain Library v1.0
OGz Studios · Confidential · Page 25 of 75
"font": "Cairo",
"position": "bottom_center",
"background_opacity": 0.6
},
"cost_usd": 0.025,
"active": true
}