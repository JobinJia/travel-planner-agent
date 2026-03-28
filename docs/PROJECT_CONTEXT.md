# Project Context

## Goal

Build a travel planning assistant from zero with TypeScript, centered on:

- travel preference collection
- multi-turn itinerary planning
- candidate plan comparison
- route-aware pacing analysis
- structured user confirmation when tradeoffs are needed
- browser UI + HTTP API + CLI

## What Exists Today

The project is no longer a skeleton. It already includes:

- `LangGraph` workflow with stateful trip planning
- `Fastify` API server
- static browser frontend served by Fastify
- `PostgresSaver` for LangGraph checkpointing
- separate Postgres-backed thread message persistence
- local file snapshots for fallback and thread list recovery
- domestic China-oriented live providers:
  - AMap for geocoding / POI / routing
  - QWeather for forecast

## Core Product Flow

1. User submits a planning request.
2. Graph extracts and merges preferences.
3. Graph checks missing constraints and assumptions.
4. Graph generates two candidate plans.
5. System estimates budget and analyzes route density.
6. If route density is too high and user has not chosen a tradeoff, graph returns a confirmation request.
7. User confirms one option such as `压缩景点` or `保持不变`.
8. Graph finalizes itinerary.

## Persistence Model

- LangGraph state:
  - Postgres when `POSTGRES_URL` exists
  - otherwise `MemorySaver`
- Thread messages:
  - Postgres table `thread_messages` when `POSTGRES_URL` exists
  - local snapshot fallback otherwise
- Thread snapshots:
  - always stored in `.data/threads/*.json`
  - used for thread list, recovery fallback, archive state

## Current UI Scope

The frontend currently supports:

- creating or continuing a thread
- viewing result text
- viewing live context and route context
- browsing candidate plans
- browsing structured `dailyPlan`
- recovering thread history from the sidebar
- searching threads
- archiving and unarchiving threads
- clicking structured confirmation options

## What To Preserve

- `pnpm` as the only package manager
- `Fastify + LangGraph` as the backend core
- AMap/QWeather provider separation from graph logic
- thread-centric product model
- structured confirmation options for frontend rendering

## Likely Next Product Directions

- auth and per-user thread isolation
- richer frontend state management
- better diffing between candidate plans
- real booking or map provider integrations
- observability and tracing
