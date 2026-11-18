# Shared contracts (read before starting)

The foundation is done. Parallel agents build **on** these files and must not
change their shapes without coordinating. The full spec is `docs/PLAN.md`.

## Ground rules

- The browser talks **only** to Next.js route handlers. It never talks to Supabase,
  and it never imports `lib/db.ts`, `lib/storage.ts`, `lib/env.ts` or `lib/queries/*`.
- Client components can import the pure modules: `lib/types/*`, `lib/media.ts`, `lib/ratings.ts`,
  `lib/fetcher.ts`, `lib/cn.ts`, `lib/paths.ts`, `lib/ai/types.ts`, `lib/ai/grounding.ts`
  (the one grounding check, used by the editor and logged by the worker), `lib/editor/schemas.ts`,
  `lib/sharing/*`, `lib/annotations.ts` (clip drawings: schema, clip-time conversion, geometry), `lib/carZones.ts` (car diagram zones,
  `guessZone`, `zoneSummary`). `lib/recording.ts` (recorder constants and the pure checks: `videoCutAt`, `recorderStalled`).
  **Server-only**: `lib/segmentCheck.ts` (ffprobe) and `lib/baseUrl.ts` (`publicBaseUrl()`: the address for customer links and
  the pairing QR; `PUBLIC_BASE_URL` unless that's localhost, then the request's own address). Build links with it, not with `env().PUBLIC_BASE_URL`.
- Live updates use **SWR polling** (`lib/fetcher.ts`), about every 2 s while something is in progress.
- No `alert`/`confirm`. Confirmations happen in the page.
- UI: shadcn/ui primitives live in `components/ui` (add more with `npx shadcn@latest add <name>`);
  app pieces (`Page`, `EmptyState`, `Field`, `StatusBadge`, `RatingBadge`, `ConfirmDialog`) live in
  `components/app`. Use the theme tokens in `app/globals.css` (`bg-card`, `text-muted-foreground`,
  `bg-red-bg`, ...), never raw colors. Keep it flat: no drop shadows or gradients. Ratings always show
  **text plus color** (`RatingBadge`). Destructive actions confirm with `ConfirmDialog`. Icons: `lucide-react`.
  Reference sheet: `/dev/ui`.

## Data access (`lib/db.ts`, `lib/storage.ts`)

| Export | Use |
|---|---|
| `sql` | Tagged-template Postgres client (postgres.js v4). Timestamps come back as ISO strings, bigint as a string. |
| `withActor('tech' \| 'ai', tx => …)` | A transaction with `app.actor` set. **Every write to `line_items`/`clips` must go through this** so the edit log gets the right actor. Route handlers use `'tech'`, the worker uses `'ai'`. |
| `isRaisedException(e)` | True for `raise exception` errors (for example from `send_report`). Return their `message` as a 409. |
| `uploadStream(path, body, type, len?, { upsert? })` | Streams a request body straight into Storage. Use it for segment uploads; don't buffer the whole file. `upsert` is only for recording pieces (a retake reuses the path). |
| `uploadFile`, `downloadToFile`, `removeObjects`, `removePrefix(id)` | Worker and delete helpers. |
| `storagePaths.*` (`lib/paths.ts`) | The only place that builds storage paths. |

## Route helpers (`lib/http.ts`)

`jsonError(status, msg, code?)` returns `{ error, code? }`. Also `isUuid` and `isShareToken`. Validate bodies with `zod`.

## Implemented endpoints (foundation-owned)

| Endpoint | Returns (`lib/types/api.ts`) | Built by |
|---|---|---|
| `GET /api/inspections` | `InspectionListResponse` | `lib/queries/inspection.ts#listInspections` |
| `POST /api/inspections` | `CreateInspectionResponse` (201) | route |
| `GET /api/inspections/[id]` | `InspectionDetail` | `lib/queries/inspection.ts#getInspectionDetail` |
| `GET /api/share/[token]?v=` | `ShareResponse` | `lib/queries/share.ts#getShare` |
| `GET /api/media/[...path]` | Tech-side Storage proxy, Range/206. Cached as immutable, except recording pieces (`no-store`: a retake reuses the path; see `isOverwritablePath`) | `lib/mediaProxy.ts` |
| `GET /api/share/[token]/media/[versionClipId]/clip\|thumbnail` | Customer-side media, scoped to the token | `lib/mediaProxy.ts` |
| `POST /api/inspections/[id]/segments?n=` | 201 `{ segment_number, status, video_cut_at_ms }` (`video_cut_at_ms`: where the picture stopped while the sound kept going, else null; see `lib/segmentCheck.ts`); 409 `code: already_uploaded \| not_recording` | recorder |
| `DELETE /api/inspections/[id]/segments/[n]` | 204; only the highest n, only while recording | recorder |
| `POST /api/inspections/[id]/finish` | 200 `{ ok }`; idempotent once processing. 409 `code: video_cut` while a piece has `video_cut_at_ms`, unless the body is `{ allow_video_cut: true }` | recorder |

Every other endpoint in PLAN §11 is owned by the feature agents.

### Customer data never leaks edit access

The inspection id is the edit URL, and storage paths contain it. So `ShareResponse` holds **no**
inspection, line or clip ids, quotes, AI originals or storage paths. Lines carry an opaque `key`
that stays the same across versions, for diffing. Media URLs are token-scoped.

## AI → worker (`lib/ai/types.ts`)

`analyzeInspection: AnalyzeFn = (AnalyzeInput) => Promise<ValidatedAnalysis>`

- Raw Gemini JSON is parsed with `rawAnalysisSchema` (seconds, untrusted).
- `ValidatedAnalysis` uses ms on the stitched timeline. It is clamped, mentions are sorted, and lines are
  sorted by first mention, so position = index + 1. `model` is stored in `ai_suggestions.model`.
- The worker calls `assertValidatedAnalysis(result, duration_ms)` before saving.
- `ValidatedAnalysis.transcript` (`{ text, start_ms, end_ms }[]`, sorted, non-overlapping, may be empty) is the
  full timed narration. The worker replaces `transcript_segments` for the inspection when it saves the lines;
  `InspectionDetail.transcript` returns it. Tech-only, like mention quotes: never copy it into a report version.
- If no lines are left: `throw new JobError(..., { retryable: false, userMessage: NO_COMPONENTS_MESSAGE })`.

## Worker (`worker/`)

- `index.ts` runs the loop: claim, run, then succeed / retry with backoff / fail, plus stale-lock requeue. Don't change it lightly.
- `handlers/*.ts` implement the jobs; `worker/lib/analyze.ts` re-exports the real Gemini `analyzeInspection`. Each has a `JobHandler`
  with `run(job, ctx)` and an optional `onFinalFailure`. `ctx.tmpDir` is per job and cleaned up afterwards.
- `worker/lib/ffmpeg.ts`: `ffmpeg(args)`, `probeDurationMs`, `probeDisplaySize` (rotation-aware).
- `worker/lib/inspection.ts`: `markInspectionFailed`, `setProcessingStep`, `maybeFinishProcessing`.
- `errors.ts`: `JobError(msg, { retryable, userMessage })`.

## Demo data

`npm run seed:demo` creates one inspection per status (recording, processing/cutting,
failed, ready_for_review, and sent with v1 → v2 plus an unsent edit), using an ffmpeg test
video: a 20 s landscape part, then a 16 s portrait part, with the pause point at 20 000 ms.
The ready_for_review one has no VIN, so Send is disabled. Its "Engine Air Filter" note
contains "12,000 miles", which was never said, to trigger the grounding warning.
It prints the URLs. Sharpness values are fake.

## Recorder (`/inspections/[id]/record`)

- `components/mobile/record/Recorder.tsx` (phone-only; no desktop version) handles the camera, pieces, timer and cap. `lib/recorder/uploadQueue.ts` is the serial
  upload queue, unit-tested with an injected transport. `lib/recording.ts` holds the format list and shared constants.
- On reload, it keeps the uploaded pieces and deletes everything from the first non-uploaded piece onward.
- Two watchdogs protect against iOS taking the camera mid-take: the camera one (video track mute, no preview frame for 1.5 s)
  pauses and reopens the camera; the recorder one (`recorderStalled`, data every 500 ms) restarts the take by itself. The
  segments route then checks each stored piece (`lib/segmentCheck.ts`) and saves `video_segments.video_cut_at_ms`; the
  recorder marks that part and `finish` returns 409 `video_cut` unless `allow_video_cut: true`. See PLAN §6.
- After Finish it calls `router.replace('/inspections/[id]')`. That page is owned by the inspection-page agent.
