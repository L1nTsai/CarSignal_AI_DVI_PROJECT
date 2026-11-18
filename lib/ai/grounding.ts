/**
 * Grounding check (plan §9). Pure and dependency-free, so the editor can import it.
 *
 *   unsupportedNumbers(note, quotes) -> number tokens in the note that no quote supports
 *
 * A note token is supported when some quote contains the same value and, if the note
 * gives a unit, the same unit ("4 mm" is not supported by "it's at 4" or "4 inches").
 * A unitless note number is supported by the same value with any unit.
 *
 * Values are compared numerically after normalizing: "12,000" = "12000" = "12k" =
 * "12 thousand", "4.0" = "4". Fractions stay fractions: "4/32" is not "1/8".
 * Quotes are transcribed speech, so spoken numbers in them are converted first
 * ("four thirty-seconds" -> 4/32, "thirty five psi" -> 35 psi). Spelled-out numbers
 * in the note itself aren't checked; the prompt asks for digits.
 */

export interface NumberToken {
  /** As written, including any attached unit, e.g. "12,000 miles". */
  text: string;
  /** Normalized value, e.g. "12000", "4/32", "0.5". */
  value: string;
  /** Canonical unit, e.g. "mi", "mm", "%"; null when none. */
  unit: string | null;
}

// ── Units ────────────────────────────────────────────────────────────────────
// Ambiguous short words ("in", "a", "l", "c") are deliberately left out.
const UNIT_ALIASES: Record<string, string[]> = {
  mm: ["mm", "millimeter", "millimeters", "millimetre", "millimetres", "mil", "mils"],
  cm: ["cm", "centimeter", "centimeters", "centimetre", "centimetres"],
  inch: ["inch", "inches", '"'],
  ft: ["ft", "foot", "feet"],
  psi: ["psi"],
  kpa: ["kpa"],
  "%": ["%", "percent", "per cent"],
  mi: ["mi", "mile", "miles"],
  km: ["km", "kms", "kilometer", "kilometers", "kilometre", "kilometres", "k's", "ks"],
  mph: ["mph"],
  rpm: ["rpm", "rpms"],
  v: ["v", "volt", "volts"],
  amp: ["amp", "amps", "ampere", "amperes"],
  cca: ["cca", "cold cranking amps"],
  ohm: ["ohm", "ohms", "Ω"],
  deg: ["°", "°f", "°c", "degree", "degrees"],
  qt: ["qt", "qts", "quart", "quarts"],
  liter: ["liter", "liters", "litre", "litres"],
  lb: ["lb", "lbs", "pound", "pounds"],
  ftlb: ["ft-lb", "ft-lbs", "ft lbs", "foot-pounds", "foot pounds"],
  nm: ["nm", "newton meters", "newton-meters"],
  usd: ["dollar", "dollars", "bucks"],
  year: ["year", "years", "yr", "yrs"],
  month: ["month", "months"],
  week: ["week", "weeks"],
  day: ["day", "days"],
  hour: ["hour", "hours", "hr", "hrs"],
  minute: ["minute", "minutes", "min"],
};

const UNIT_LOOKUP = new Map<string, string>();
for (const [canon, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const a of aliases) UNIT_LOOKUP.set(a.toLowerCase(), canon);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Longest first so "ft-lbs" wins over "ft".
const UNIT_ALT = [...UNIT_LOOKUP.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|");

// ── Digit tokens ─────────────────────────────────────────────────────────────
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const TOKEN_RE = new RegExp(
  String.raw`(\$\s*)?` + // 1: currency prefix
    `(${NUM})` + // 2: number
    String.raw`(?:\s*/\s*(${NUM})(?:nds|ths|rds|sts)?)?` + // 3: fraction denominator (4/32nds)
    String.raw`(k\b|\s+thousand\b)?` + // 4: thousand multiplier
    String.raw`(?:\s*(?:-\s*)?(${UNIT_ALT})(?![\p{L}\p{N}]))?`, // 5: unit (handles "4mm", "4 mm", "4-mm")
  "giu",
);

function normNumber(s: string, multiplier = 1): string {
  const n = Number(s.replace(/,/g, "")) * multiplier;
  // Avoid float noise like 4.1 * 1000 = 4099.999…
  return String(Math.round(n * 1e6) / 1e6);
}

/** Extracts digit-based number tokens. Exported for tests. */
export function extractNumberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const prev = start > 0 ? text[start - 1] : "";
    // Skip digits glued to letters/digits on the left (e.g. "P0420", "V6"): codes, not quantities.
    if (prev && /[\p{L}\p{N}_]/u.test(prev)) continue;
    const [full, currency, num, denom, thousand, unitRaw] = m;
    const mult = thousand ? 1000 : 1;
    const value = denom ? `${normNumber(num)}/${normNumber(denom)}` : normNumber(num, mult);
    const unit = currency ? "usd" : unitRaw ? UNIT_LOOKUP.get(unitRaw.toLowerCase()) ?? null : null;
    out.push({ text: full.trim(), value, unit });
  }
  return out;
}

// ── Spoken numbers (quotes only) ─────────────────────────────────────────────
const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };
/** Plural ordinals used as fraction denominators ("four thirty-seconds"). */
const DENOM_ORDINALS: Record<string, number> = {
  halves: 2, thirds: 3, quarters: 4, fourths: 4, fifths: 5, sixths: 6, sevenths: 7, eighths: 8,
  ninths: 9, tenths: 10, twelfths: 12, sixteenths: 16, twentieths: 20,
  // Only valid after a tens word: "thirty-seconds", "sixty-fourths".
  seconds: 2, secondths: 2,
};

type Word = { w: string; start: number; end: number };

/** Parses a cardinal starting at words[i]. Returns value and the index after it. */
function parseCardinal(words: Word[], i: number): { value: number; next: number } | null {
  let total = 0;
  let current = 0;
  let any = false;
  let j = i;
  let lastKind: "ones" | "tens" | "scale" | null = null;
  while (j < words.length) {
    const w = words[j].w;
    if (w === "and" && lastKind === "scale" && j + 1 < words.length && (words[j + 1].w in ONES || words[j + 1].w in TENS)) {
      j++;
      continue;
    }
    if (w in ONES && w !== "oh") {
      // "four thirty" is two numbers, not 34; "twenty four" is one.
      if (lastKind === "ones") break;
      if (lastKind === "tens" && ONES[w] >= 10) break;
      current += ONES[w];
      lastKind = "ones";
    } else if (w in TENS) {
      if (lastKind === "ones" || lastKind === "tens") break;
      // A tens word followed by "seconds"/"fourths" is a denominator, not part of this number.
      if (any && j + 1 < words.length && words[j + 1].w in DENOM_ORDINALS) break;
      current += TENS[w];
      lastKind = "tens";
    } else if (w in SCALES && any) {
      if (SCALES[w] === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * SCALES[w];
        current = 0;
      }
      lastKind = "scale";
    } else break;
    any = true;
    j++;
  }
  if (!any) return null;
  // "point five" decimals
  let value = total + current;
  if (j + 1 < words.length && words[j].w === "point" && words[j + 1].w in ONES) {
    let digits = "";
    j++;
    while (j < words.length && words[j].w in ONES && ONES[words[j].w] < 10) {
      digits += ONES[words[j].w];
      j++;
    }
    value = Number(`${value}.${digits}`);
  }
  return { value, next: j };
}

/** Parses "thirty-seconds" / "eighths" at words[i]. */
function parseDenominator(words: Word[], i: number): { value: number; next: number } | null {
  const w = words[i]?.w;
  if (w === undefined) return null;
  if (w in TENS && words[i + 1] && words[i + 1].w in DENOM_ORDINALS) {
    return { value: TENS[w] + DENOM_ORDINALS[words[i + 1].w], next: i + 2 };
  }
  if (w in DENOM_ORDINALS && w !== "seconds" && w !== "secondths") return { value: DENOM_ORDINALS[w], next: i + 1 };
  return null;
}

/** Rewrites spoken numbers as digits: "four thirty-seconds" -> "4/32". Exported for tests. */
export function spokenNumbersToDigits(text: string): string {
  const words: Word[] = [];
  for (const m of text.matchAll(/[A-Za-z]+/g)) {
    words.push({ w: m[0].toLowerCase(), start: m.index!, end: m.index! + m[0].length });
  }
  const edits: { start: number; end: number; repl: string }[] = [];
  let i = 0;
  while (i < words.length) {
    const card = parseCardinal(words, i);
    if (!card) {
      i++;
      continue;
    }
    let repl = String(card.value);
    let next = card.next;
    const denom = parseDenominator(words, next);
    if (denom) {
      repl = `${card.value}/${denom.value}`;
      next = denom.next;
    }
    edits.push({ start: words[i].start, end: words[next - 1].end, repl });
    i = next;
  }
  let out = text;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.repl + out.slice(e.end);
  return out;
}

// ── The check ────────────────────────────────────────────────────────────────
/**
 * Number tokens in `note` (as written, with unit) that no quote supports.
 * Order of first appearance, de-duplicated.
 */
export function unsupportedNumbers(note: string, quotes: readonly string[]): string[] {
  const supported = quotes.flatMap((q) => extractNumberTokens(spokenNumbersToDigits(q)));
  const out: string[] = [];
  for (const t of extractNumberTokens(note)) {
    const ok = supported.some((s) => s.value === t.value && (t.unit === null || s.unit === t.unit));
    if (!ok && !out.includes(t.text)) out.push(t.text);
  }
  return out;
}
