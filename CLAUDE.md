# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Start Fastify API server (tsx src/server.ts) on :3000
pnpm dev:cli -- --query "..." # Single CLI query
pnpm dev:cli -- --thread <id> # Multi-turn CLI session
pnpm build                # TypeScript compile to dist/
pnpm typecheck            # Type check without emit
pnpm build:native         # Build with tsgo (experimental)
pnpm typecheck:native     # Type check with tsgo (experimental)
docker compose up -d      # Start local Postgres
```

## Environment

Copy `.env.example` to `.env`. Required: `OPENAI_API_KEY`. Optional: `AMAP_API_KEY`, `POSTGRES_URL`.

When `POSTGRES_URL` is set, LangGraph uses PostgresSaver and thread messages persist to Postgres. Otherwise falls back to MemorySaver (in-memory) and local file snapshots in `.data/threads/`.

## Architecture

Four-layer system: Presentation -> API -> Planning Graph -> Persistence/Providers.

**Entrypoints:**
- `src/server.ts` — Fastify HTTP server, serves static frontend from `public/`
- `src/index.ts` — CLI entrypoint

**Core flow:**
- `src/app/travel-planner-service.ts` — Shared service layer. Both CLI and API call `executePlanningTurn()` which invokes the LangGraph graph, persists snapshots, and appends message history.
- `src/graph/travel-graph.ts` — LangGraph StateGraph with 6 nodes: `collect_requirements` -> `clarify_missing_info` -> `generate_options` -> `compare_options` -> conditional(`request_confirmation` | `finalize_itinerary`). The conditional branch triggers when route analysis detects high congestion and the user hasn't expressed a tradeoff preference.
- `src/prompts/travel-graph.ts` — System prompts for each graph node
- `src/types/travel.ts` — Domain types (TravelPreferenceProfile, CandidatePlan, ConfirmationOption, ThreadSnapshot, ThreadMessage)

**Tools & Providers:**
- `src/tools/travel-tools.ts` — Budget estimation, season advice, packing checklist
- `src/tools/live-travel-context.ts` — Aggregates real-time context from AMap (geocoding, POI, routing, weather)
- `src/providers/amap.ts` — AMap API (geocoding, POI search, route planning, weather)

**Persistence:**
- `src/graph/checkpointer.ts` — LangGraph checkpointer (Postgres or MemorySaver)
- `src/infrastructure/database.ts` — Postgres pool management and health checks
- `src/store/thread-snapshot-store.ts` — Local JSON file snapshots (`.data/threads/`)
- `src/store/thread-message-store.ts` — Thread message history (Postgres or snapshot fallback)

**Frontend:** Static HTML/JS/CSS in `public/` — no build step, no framework.

## API Endpoints

- `POST /api/trips/plan` — New planning session (threadId optional, auto-generated if omitted)
- `POST /api/trips/revise` — Continue existing thread (threadId required)
- `GET /api/trips` — List threads (query params: `archived`, `q`)
- `GET /api/trips/thread/:threadId` — Get thread state
- `PATCH /api/trips/archive` — Archive/unarchive thread
- `GET /health` / `GET /health/db` — Health checks

## Working Rules

- Always use `pnpm`, never `npm` or `yarn`.
- Chinese is the primary user-facing language.
- Preserve the Fastify + LangGraph architecture. Don't introduce new frameworks without strong justification.
- Keep AMap provider decoupled from graph logic.
- When editing docs, update both `README.md` and `docs/` if the change affects architecture or capabilities.
- ESM project (`"type": "module"`) — all local imports use `.js` extension.
- Node.js >=20 required. TypeScript targets ES2022 with NodeNext module resolution.
