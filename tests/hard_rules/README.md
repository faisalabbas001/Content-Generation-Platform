# Hard Rules audit suite

These specs gate every PR merge (see `.github/workflows/hard-rules.yml`).

| #  | Rule                                | Spec                                          |
|----|-------------------------------------|-----------------------------------------------|
| 1  | CEO always routes first             | 01_ceo_always_first.spec.ts                   |
| 2  | Memory Controller is only writer    | 02_memory_controller_gate.spec.ts             |
| 3  | No Arabic in image prompts          | 03_arabic_never_in_image_prompts.spec.ts      |
| 4  | No Weavy URLs in DB                 | 04_no_weavy_urls_in_db.spec.ts                |

