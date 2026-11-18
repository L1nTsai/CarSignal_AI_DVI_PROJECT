/**
 * The Gemini prompt (plan §8). Pure: no SDK imports, so tests and the script can use it.
 */

/** 65_400 ms -> "1:05". Rounds down to the whole second. */
export function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface PromptInput {
  duration_ms: number;
  /** Start of each recorded piece on the stitched timeline, ms. Starts with 0. */
  segment_starts_ms: number[];
}

function partsSentence({ segment_starts_ms }: PromptInput): string {
  const starts = segment_starts_ms.length > 0 ? segment_starts_ms : [0];
  if (starts.length === 1) return "It was recorded in one continuous part.";
  const list = starts.map(formatMmSs).join(", ");
  return (
    `It was recorded in ${starts.length} parts that were joined together; the parts start at ${list}. ` +
    "The jumps at those times are cuts, not continuous footage."
  );
}

export function buildPrompt(input: PromptInput): string {
  return `You are turning a car technician's narrated inspection video into digital vehicle inspection (DVI) line items.

The video is ${formatMmSs(input.duration_ms)} long. ${partsSentence(input)}

Create one line for each distinct vehicle component the technician inspects out loud. If the same component
comes up more than once, create ONE line and list every mention.

For each line:
- component_name: the component as the technician named it. Short, Title Case, include position
  (e.g. "Left Front Tire", "Wipers", "Engine Air Filter").
- rating: good, monitor, or needs_attention.
  - If the technician states a rating ("mark it needs attention", "put it on monitor"), use it. rating_basis = "stated".
  - Otherwise infer it ONLY from the technician's own words ("these look good" → good). rating_basis = "inferred".
- note: a short, cleaned-up version of what the technician said about this component, written for a car owner.
  Remove filler words and instructions to the app (like "mark it needs attention").
  Use ONLY what was said. Do NOT add measurements, causes, diagnoses, or repair recommendations the
  technician did not state. Keep any numbers exactly as spoken.
- car_zone: where the component is on a top-down diagram of the car, front at the top. "l"/"left" is the
  driver's side, "r"/"right" the passenger side. Wheels, tires, brakes and suspension at one corner go to that
  wheel (wheel_lf, wheel_rf, wheel_lr, wheel_rr); engine-bay parts and fluids go to hood_engine; wipers go to
  windshield; interior and cabin filter go to cabin; exhaust and anything under the car go to underbody.
  Use "none" when the component has no single spot (e.g. "all four tires", "front brakes" covering both sides,
  or a general comment).
- mentions: every time the technician talks about this component:
  - quote: the technician's exact words about it, verbatim. Write spoken numbers as digits
    (e.g. "4/32", "35 psi", "12,000 miles") but do not change their value.
  - visible_start_s, visible_end_s: seconds from the start of the video when the component is on camera
    around this mention. If it is never clearly on camera, use when it is being discussed.
  - best_frame_s: the second with the clearest, steadiest view of the component.

Do not create lines for things that are only visible but never talked about, or for chit-chat ("okay, moving on").

Also return transcript: everything the technician says, in order, as captions.
- Each segment is one short sentence or phrase (at most about 12 words), verbatim, including chit-chat.
- start_s, end_s: seconds from the start of the video when those words are spoken (not when something is on camera).
- Segments must not overlap. Leave out silence. Write spoken numbers as digits, as in the quotes.

Return JSON that matches the schema.`;
}
