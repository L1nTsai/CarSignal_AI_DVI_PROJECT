-- When the AI step last saved this inspection's transcript. Lets the editor tell
-- "nothing was said" (set, no transcript_segments) from "processed before
-- transcripts existed" (null).
alter table inspections add column transcribed_at timestamptz;
