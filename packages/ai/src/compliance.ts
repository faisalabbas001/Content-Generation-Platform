/**
 * Deterministic Compliance Gate — spec §11.1
 *
 * Runs BEFORE the LLM (CCO). Checks the caption + visual brief text for any
 * of the 10 hard-block violation keywords. If any match, the content is
 * rejected immediately without an LLM call.
 *
 * This is not the CCO — it is the Compliance Gate (Spine-02 in spec §9.2).
 * The Compliance Gate is deterministic. No model can override it.
 *
 * Usage:
 *   const gate = checkHardBlocks(caption, visualBrief)
 *   if (gate.blocked) { // reject, do not call CCO }
 */

export interface HardBlockResult {
  blocked:    boolean
  violations: HardBlockViolation[]
}

export interface HardBlockViolation {
  code:        string
  description: string
  match:       string   // the substring that triggered this
}

// ── The 10 hard-block violation patterns (spec §11.1) ────────────────────────
// Each entry: code, human description, keywords/phrases to detect in text.
// Text detection is a belt-and-suspenders layer — the CCO vision pass is the
// primary detector for visual violations. Text checks catch explicit references
// to banned scenarios in captions or visual briefs.

const HARD_BLOCKS: Array<{
  code:        string
  description: string
  keywords:    string[]
}> = [
  {
    code:        'left_hand_serving',
    description: 'Left hand serving food or beverages',
    keywords:    ['left hand serving', 'left hand hold', 'يد اليسار تقدم', 'باليد اليسرى'],
  },
  {
    code:        'left_hand_exchange',
    description: 'Left hand used for formal object exchange',
    keywords:    ['left hand gift', 'left hand present', 'left hand card', 'يد اليسار يعطي'],
  },
  {
    code:        'sole_pointing',
    description: 'Sole of foot pointed at a person',
    keywords:    ['sole of foot', 'feet pointing', 'باطن القدم'],
  },
  {
    code:        'beckoning_palm_up',
    description: 'Palm-up beckoning gesture',
    keywords:    ['palm up', 'beckoning', 'wave over', 'الإشارة بالكف لأعلى'],
  },
  {
    code:        'cross_gender_contact',
    description: 'Physical contact between non-mahrams in traditional content',
    keywords:    ['handshake between man and woman', 'touching between man and woman', 'مصافحة بين رجل وامرأة'],
  },
  {
    code:        'food_consumption_ramadan_daylight',
    description: 'Food/drink consumed during Ramadan daylight',
    keywords:    ['eating during ramadan', 'drinking during ramadan', 'daytime food ramadan', 'الأكل في نهار رمضان'],
  },
  {
    code:        'quran_mishandling',
    description: 'Quran placed under objects or mishandled',
    keywords:    ['quran under', 'quran on floor', 'stepping on quran', 'القرآن تحت', 'يدوس على القرآن'],
  },
  {
    code:        'index_finger_pointing',
    description: 'Index finger pointing directly at a person',
    keywords:    ['index finger pointing at', 'pointing finger at person', 'الإشارة بالسبابة إلى شخص'],
  },
  {
    code:        'western_head_shake_no',
    description: 'Western head-shake (side-to-side) for no',
    keywords:    ['head shake no', 'shaking head no', 'هز الرأس للرفض'],
  },
  {
    code:        'counting_wrong_sequence',
    description: 'Counting starting at index finger',
    keywords:    ['counting from index', 'index finger count', 'العد بالسبابة'],
  },
]

/**
 * Check caption + visual brief text for hard-block violations.
 * Fast O(n) scan — no external calls.
 */
export function checkHardBlocks(
  ...texts: Array<string | null | undefined>
): HardBlockResult {
  const combined = texts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const violations: HardBlockViolation[] = []

  for (const block of HARD_BLOCKS) {
    for (const kw of block.keywords) {
      if (combined.includes(kw.toLowerCase())) {
        violations.push({
          code:        block.code,
          description: block.description,
          match:       kw,
        })
        break  // one match per violation code is enough
      }
    }
  }

  return {
    blocked:    violations.length > 0,
    violations,
  }
}

/**
 * Ramadan-aware check — only activates food_consumption_ramadan_daylight
 * when the Ramadan occasion flag is set.
 */
export function checkHardBlocksWithContext(
  texts: Array<string | null | undefined>,
  ctx: { ramadan_active: boolean },
): HardBlockResult {
  const result = checkHardBlocks(...texts)
  if (!ctx.ramadan_active) {
    // Remove Ramadan-specific violation if not in Ramadan
    return {
      blocked:    result.violations.filter((v) => v.code !== 'food_consumption_ramadan_daylight').length > 0,
      violations: result.violations.filter((v) => v.code !== 'food_consumption_ramadan_daylight'),
    }
  }
  return result
}
