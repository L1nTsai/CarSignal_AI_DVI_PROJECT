-- Recording check (owner decision, 2026-11-17): iOS can take the camera away
-- from Safari mid-recording while the microphone keeps going, leaving a piece
-- whose picture stops early (the stitch then freezes on the last frame).
-- The upload route probes each piece and records where the picture stopped.
-- null = fine, or not checked (pieces from before 0007, or the probe failed).
alter table video_segments
  add column video_cut_at_ms integer constraint video_segments_video_cut_check check (video_cut_at_ms >= 0);
