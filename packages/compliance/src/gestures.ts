/**
 * The 10 cultural gesture hard blocks (OGZ doc §11.1).
 *
 * These are the in-code fallback used when the `cultural_gesture_blocks` table
 * is empty or unavailable (e.g. local dev before the seed migration runs). The
 * DB rows take precedence; this guarantees the gate is never silently empty.
 *
 * Detection runs against the ENGLISH visual brief only (Hard Rule #3 keeps the
 * brief English), so keywords are English phrasings of each violation.
 */
import type { GestureBlock } from './types'

export const CULTURAL_GESTURE_BLOCKS: GestureBlock[] = [
  {
    gesture_key: 'left_hand_serving',
    severity: 'HARD_BLOCK',
    detection_keywords: ['left hand serving', 'serving with the left hand', 'left-hand serving', 'offering food with left hand', 'pouring with the left hand'],
  },
  {
    gesture_key: 'left_hand_exchange',
    severity: 'HARD_BLOCK',
    detection_keywords: ['left hand exchange', 'handing over with the left hand', 'giving with the left hand', 'passing with left hand'],
  },
  {
    gesture_key: 'sole_pointing',
    severity: 'HARD_BLOCK',
    detection_keywords: ['sole of the foot', 'soles facing', 'feet pointed at', 'showing the sole', 'sole pointing'],
  },
  {
    gesture_key: 'beckoning_palm_up',
    severity: 'HARD_BLOCK',
    detection_keywords: ['palm-up beckoning', 'beckoning with palm up', 'come-here gesture'],
  },
  {
    gesture_key: 'cross_gender_contact',
    severity: 'HARD_BLOCK',
    detection_keywords: ['handshake between a man and a woman', 'man and woman touching', 'mixed-gender embrace', 'cross-gender contact', 'man hugging a woman', 'couple holding hands'],
    applies_to_register: null,
  },
  {
    gesture_key: 'food_consumption_ramadan_daylight',
    severity: 'HARD_BLOCK',
    detection_keywords: ['eating', 'drinking', 'taking a bite', 'sipping', 'person consuming food', 'mid-bite', 'biting into'],
    occasion_scope: 'ramadan_daylight',
  },
  {
    gesture_key: 'quran_mishandling',
    severity: 'HARD_BLOCK',
    detection_keywords: ['quran under', 'quran on the floor', 'object on top of the quran', 'mushaf beneath', 'stepping near the quran'],
  },
  {
    gesture_key: 'index_finger_pointing',
    severity: 'HARD_BLOCK',
    detection_keywords: ['pointing with the index finger at a person', 'index finger pointing at', 'finger pointing directly at'],
  },
  {
    gesture_key: 'western_head_shake_no',
    severity: 'HARD_BLOCK',
    detection_keywords: ['shaking head to say no', 'western head shake'],
  },
  {
    gesture_key: 'counting_wrong_sequence',
    severity: 'HARD_BLOCK',
    detection_keywords: ['counting starting at the index finger', 'counting on fingers starting with index'],
  },
]

/**
 * Arabic keywords indicating religious content that must route to human review
 * (doc §11.4 — "never auto-published regardless of confidence score").
 *
 * 'الله' is intentionally excluded: it appears in everyday Arabic phrases
 * (إن شاء الله, بسم الله, الحمد لله) and would hold nearly every caption.
 * The remaining terms are specific religious acts/places.
 */
export const RELIGIOUS_CONTENT_KEYWORDS_AR: string[] = [
  'قرآن',   // Quran
  'رسول',   // Messenger / Prophet
  'صلاة',   // Prayer
  'مسجد',   // Mosque
  'حج',     // Hajj
  'عمرة',   // Umrah
]

/**
 * English keywords indicating religious visual content in the visual brief
 * (doc §11.4 — visual briefs must not auto-generate religious imagery).
 */
export const RELIGIOUS_CONTENT_KEYWORDS_EN: string[] = [
  'quran',
  'quranic',
  'mosque prayer',
  'islamic prayer',
  'prophet muhammad',
  'hadith',
  'hajj pilgrimage',
  'umrah pilgrimage',
  'holy kaaba',
]

/**
 * Crude Fajr–Maghrib daylight check for the Ramadan food rule.
 *
 * posting_time literals carry the +03:00 AST offset already (e.g.
 * "2026-03-12T13:00:00+03:00"), so the literal hour IS the AST hour. We treat
 * 05:00–17:59 AST as daylight. Approximate by design — the exact prayer window
 * shifts daily; this errs toward catching daytime food content.
 */
export function isRamadanDaylight(
  occasion: string | null | undefined,
  postingTimeIso: string | null | undefined,
): boolean {
  if (occasion !== 'ramadan') return false
  if (!postingTimeIso) return false
  const m = /T(\d{2})/.exec(postingTimeIso)
  if (!m) return false
  const hour = Number(m[1])
  return Number.isFinite(hour) && hour >= 5 && hour < 18
}
