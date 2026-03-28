# Agent Notes

This repository contains a production-oriented prototype of a travel planning assistant.

Start here when a coding agent opens this repo.

## Read First

1. [README.md](/Users/jobin/myself/code-workspace/travel-planner-agent/README.md)
2. [docs/PROJECT_CONTEXT.md](/Users/jobin/myself/code-workspace/travel-planner-agent/docs/PROJECT_CONTEXT.md)
3. [docs/ARCHITECTURE.md](/Users/jobin/myself/code-workspace/travel-planner-agent/docs/ARCHITECTURE.md)

## Current Stack

- `TypeScript`
- `pnpm`
- `Fastify`
- `LangGraph`
- `OpenAI`
- `Postgres` for LangGraph checkpoint + thread message history
- local file snapshots as fallback
- static frontend in `public/`

## Important Entrypoints

- API server: [src/server.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/server.ts)
- CLI: [src/index.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/index.ts)
- Graph: [src/graph/travel-graph.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/graph/travel-graph.ts)
- Frontend: [public/index.html](/Users/jobin/myself/code-workspace/travel-planner-agent/public/index.html)

## Key Product Behaviors

- multi-turn trip planning by `threadId`
- route-aware itinerary evaluation
- structured confirmation options when itinerary is too dense
- recoverable thread list with search and archive
- persisted message history

## Working Rules For Future Sessions

- Always use `pnpm`, never `npm`.
- Preserve the current architecture unless there is a strong reason to refactor.
- Prefer extending the existing Fastify + LangGraph flow over introducing new frameworks.
- Keep Chinese as the main user-facing language unless explicitly changed.
- When editing docs, update both `README.md` and files under `docs/` if the change affects architecture or current capability.

## Verification Commands

```bash
pnpm typecheck
pnpm build
pnpm typecheck:native
pnpm build:native
```
