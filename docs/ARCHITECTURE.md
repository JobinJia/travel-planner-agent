# Architecture

## High-Level Shape

The system has 4 layers:

1. Presentation
2. API / orchestration
3. planning graph and domain logic
4. persistence and external providers

## Layer Breakdown

### 1. Presentation

- Browser frontend:
  - [public/index.html](/Users/jobin/myself/code-workspace/travel-planner-agent/public/index.html)
  - [public/app.js](/Users/jobin/myself/code-workspace/travel-planner-agent/public/app.js)
  - [public/styles.css](/Users/jobin/myself/code-workspace/travel-planner-agent/public/styles.css)
- CLI:
  - [src/index.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/index.ts)

### 2. API / orchestration

- Fastify server:
  - [src/server.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/server.ts)
- shared application service:
  - [src/app/travel-planner-service.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/app/travel-planner-service.ts)

Responsibilities:

- validate request payloads
- invoke graph
- manage thread IDs
- persist thread snapshots
- read thread history
- expose REST API

### 3. Planning graph and domain logic

- Graph:
  - [src/graph/travel-graph.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/graph/travel-graph.ts)
- Prompts:
  - [src/prompts/travel-graph.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/prompts/travel-graph.ts)
- domain tools:
  - [src/tools/travel-tools.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/tools/travel-tools.ts)
  - [src/tools/live-travel-context.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/tools/live-travel-context.ts)
- types:
  - [src/types/travel.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/types/travel.ts)

### 4. Persistence and providers

- LangGraph checkpointer:
  - [src/graph/checkpointer.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/graph/checkpointer.ts)
- DB utilities:
  - [src/infrastructure/database.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/infrastructure/database.ts)
- thread snapshot store:
  - [src/store/thread-snapshot-store.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/store/thread-snapshot-store.ts)
- thread message store:
  - [src/store/thread-message-store.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/store/thread-message-store.ts)
- external providers:
  - [src/providers/amap.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/providers/amap.ts)
  - [src/providers/qweather.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/providers/qweather.ts)

## LangGraph State Flow

The graph state currently includes:

- user request and accumulated conversation turns
- structured travel profile
- missing info and assumptions
- candidate options
- comparison text
- live context and route context
- confirmation state
- final answer

Main nodes:

1. `collect_requirements`
2. `clarify_missing_info`
3. `generate_options`
4. `compare_options`
5. conditional branch:
   - `request_confirmation`
   - or `finalize_itinerary`

## Confirmation Mechanism

When route analysis contains `拥挤度 高` and the latest user turn does not already express a tradeoff, the graph sets:

- `requiresConfirmation = true`
- `confirmationMessage`
- `confirmationOptions`

The frontend renders those options as buttons.

Structured confirmation actions:

- `compress`
- `extend`
- `transit`
- `keep`

## Route Evaluation Logic

Route evaluation currently uses:

- destination geocoding from AMap
- POI lookup from AMap
- route estimates in three modes:
  - walking
  - transit
  - driving
- per-day route assessment based on structured `dailyPlan`

This logic is aggregated into:

- `liveContext`
- `routeContext`

## API Surface

Current main endpoints:

- `GET /health`
- `GET /health/db`
- `POST /api/trips/plan`
- `POST /api/trips/revise`
- `GET /api/trips`
- `PATCH /api/trips/archive`
- `GET /api/trips/thread/:threadId`

## Storage Strategy

### Postgres

Used for:

- LangGraph checkpoint state
- thread message history table

### Local files

Used for:

- thread snapshots
- thread summary list
- archive flag persistence
- fallback recovery path

## Frontend Information Model

The frontend maintains:

- selected thread
- search query
- archive filter
- current conversation bubbles
- currently highlighted candidate option

It does not yet have a dedicated client-side state framework.

## Why This Architecture

- simple enough to keep moving quickly
- structured enough to support productization
- backend and frontend loosely coupled through stable JSON payloads
- graph logic separated from providers and storage
- fallback paths exist when DB or third-party APIs are unavailable
