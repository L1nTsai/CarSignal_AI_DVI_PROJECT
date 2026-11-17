# CarSignal AI DVI

A technician records a narrated video walkaround on their phone. The app turns it into a
Digital Vehicle Inspection: one line per component, each with a note, a rating and matching clips and photos.
The full spec is in [`docs/PLAN.md`](docs/PLAN.md), and the shared code contracts are in [`docs/CONTRACTS.md`](docs/CONTRACTS.md).

## Prerequisites

- Node 20+
- Docker Desktop
- Supabase CLI
- ffmpeg (including ffprobe)
- `cloudflared` (or ngrok)
- A Gemini API key

On macOS: `brew install supabase/tap/supabase ffmpeg cloudflared`

## Setup

```bash
npm install
supabase start                 # local Postgres + Storage (ports 55321/55322, see below)
supabase db reset              # applies the migration + seed (creates the storage bucket)
cp .env.example .env.local     # fill in SUPABASE_SERVICE_ROLE_KEY (from `supabase status`) and GEMINI_*
npm run seed:demo              # optional: demo inspections in every status
npm run dev:all                # Next.js on :3000 + the worker
npm run tunnel                 # cloudflared quick tunnel -> prints https://<random>.trycloudflare.com
```

Put the tunnel URL in `PUBLIC_BASE_URL` in `.env.local`, then restart `npm run dev:all`.
`*.trycloudflare.com` is already allowed in `allowedDevOrigins`.
Open that URL on both the laptop and the phone. Don't use `localhost`, or the QR codes and share links will point to it.
The phone camera needs the HTTPS tunnel.

Only run the tunnel while you're developing or demoing. There's no auth.

### Ports

The Supabase ports are moved to **55xxx** (API 55321, DB 55322, Studio 55323) in
`supabase/config.toml`, so this project can run next to other local Supabase projects.

## Scripts

| Script | |
|---|---|
| `dev` / `worker` / `dev:all` | Next.js, the job worker, or both |
| `seed:demo` | Generates a test video and creates processed demo inspections |
| `test` | vitest |
| `typecheck` | `next typegen && tsc --noEmit` |
| `tunnel` | Quick Cloudflare tunnel to :3000 |
| `db:reset` | Re-applies the migration + seed (wipes data) |

## Layout

```
app/          pages + route handlers (app/api/...)
components/ui shared UI (Button, RatingBadge, StatusBadge, Card, Field, Page) — see /dev/ui
lib/          db + storage clients, row/API types, query builders, media proxy, AI contract
worker/       job loop + one handler per job kind
scripts/      seed-demo
supabase/     config.toml, migrations/, seed.sql
```
