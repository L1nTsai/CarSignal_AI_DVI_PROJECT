/**
 * Grounding check (plan §9). Pure; safe anywhere.
 *
 * unsupportedNumbers(note, quotes) returns every number in the note that isn't
 * in any of the line's quotes, with its unit when one is attached, e.g.
 * ["12,000 miles"]. Numbers in quotes may be spoken as words ("four
 * millimeters"), so simple number words are converted before comparing.
 */

const UNITS = [
  "%", "percent", "mm", "millimeter", "millimeters", "millimetre", "millimetres", "cm", "in", "inch", "inches",
  "\"", "ft", "foot", "feet", "mi", "mile", "miles", "km", "kilometer", "kilometers", "k", "psi", "v", "volt",
  "volts", "a", "amp", "amps", "qt", "quart", "quarts", "l", "liter", "liters", "litre", "litres", "mph",
  "rpm", "nm", "lb", "lbs", "ft-lb", "ft-lbs", "degree", "degrees", "°", "°f", "°c", "f", "c", "year", "years",
  "month", "months", "week", "weeks", "day", "days", "hour", "hours", "thousand", "hundred", "32nds",
];
const UNIT_SET = new Set(UNITS);

// 4, 4.5, 12,000, 4/32, 3-4 (each side is checked separately)
const NUMBER_RE = /\d+(?:,\d{3})*(?:\.\d+)?(?:\/\d+)?/g;

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, half: 0.5,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };

function canonical(num: string): string {
  if (num.includes("/")) return num.replace(/,/g, "");
  const n = Number(num.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : num;
}

/** Every number value present in `text`, digits and simple words, as canonical strings. */
function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(NUMBER_RE)) {
    out.add(canonical(m[0]));
    // "12k" / "12 thousand" also count as 12000
    const after = lower.slice(m.index + m[0].length).trimStart();
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) {
      if (/^(k\b|thousand\b)/.test(after)) out.add(String(n * 1000));
      if (/^hundred\b/.test(after)) out.add(String(n * 100));
    }
  }
  // Number words: "four", "twenty five", "twelve thousand", "four thirty-seconds" (-> 4/32 is not handled).
  const words = lower.replace(/-/g, " ").split(/[^a-z]+/).filter(Boolean);
  let current: number | null = null;
  let total = 0;
  const flush = () => {
    if (current !== null || total > 0) out.add(String(total + (current ?? 0)));
    current = null;
    total = 0;
  };
  for (const w of words) {
    if (w in ONES) {
      current = (current ?? 0) + ONES[w];
    } else if (w in TENS) {
      current = (current ?? 0) + TENS[w];
    } else if (w in SCALES) {
      const scale = SCALES[w];
      if (scale >= 1000) {
        total += (current ?? 1) * scale;
        current = null;
      } else {
        current = (current ?? 1) * scale;
      }
    } else if (w === "and" && (current !== null || total > 0)) {
      continue;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

/** Numbers (with unit) in `note` that no quote contains. Order of appearance, no duplicates. */
export function unsupportedNumbers(note: string, quotes: string[]): string[] {
  const said = new Set<string>();
  for (const q of quotes) for (const n of numbersIn(q)) said.add(n);

  const result: string[] = [];
  const seen = new Set<string>();
  for (const m of note.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const end = m.index + raw.length;
    const value = canonical(raw);
    const rest = note.slice(end);
    const unitMatch = /^\s?([%"°]|[A-Za-z°][A-Za-z0-9°-]*)/.exec(rest);
    const unit = unitMatch && UNIT_SET.has(unitMatch[1].toLowerCase()) ? unitMatch[0] : "";

    let supported = said.has(value);
    if (!supported && unit) {
      const u = unit.trim().toLowerCase();
      const n = Number(raw.replace(/,/g, ""));
      if ((u === "k" || u === "thousand") && said.has(String(n * 1000))) supported = true;
      if (u === "hundred" && said.has(String(n * 100))) supported = true;
    }
    if (supported) continue;

    const token = `${raw}${unit}`;
    if (!seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}
