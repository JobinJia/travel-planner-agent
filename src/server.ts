import "dotenv/config";

import path from "node:path";

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";

import {
  archiveThread,
  getThreadState,
  listThreads,
  parseArchiveThreadRequest,
  parsePlanRequest,
  parseReviseRequest,
  runPlanningTurn,
  runRevisionTurn
} from "./app/travel-planner-service.js";
import { checkDatabaseHealth, closePool, getDatabaseMode } from "./infrastructure/database.js";

const paramsSchema = z.object({
  threadId: z.string().min(1)
});
const listQuerySchema = z.object({
  archived: z.enum(["true", "false"]).optional(),
  q: z.string().optional()
});

async function buildServer() {
  const app = Fastify({
    logger: true
  });

  await app.register(fastifyStatic, {
    root: path.resolve(process.cwd(), "public"),
    prefix: "/"
  });

  app.get("/health", async () => {
    return {
      ok: true,
      persistence: getDatabaseMode()
    };
  });

  app.get("/health/db", async (_request, reply) => {
    try {
      const health = await checkDatabaseHealth();
      const statusCode = health.ok ? 200 : 503;
      return reply.code(statusCode).send(health);
    } catch (error) {
      return reply.code(503).send({
        ok: false,
        mode: getDatabaseMode(),
        details: error instanceof Error ? error.message : "数据库探测失败。"
      });
    }
  });

  app.post("/api/trips/plan", async (request, reply) => {
    try {
      const payload = parsePlanRequest(request.body);
      const result = await runPlanningTurn(payload);
      return reply.send(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "INVALID_REQUEST",
          issues: error.issues
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "PLANNING_FAILED"
      });
    }
  });

  app.post("/api/trips/revise", async (request, reply) => {
    try {
      const payload = parseReviseRequest(request.body);
      const result = await runRevisionTurn(payload);
      return reply.send(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "INVALID_REQUEST",
          issues: error.issues
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "REVISION_FAILED"
      });
    }
  });

  app.get("/api/trips", async (request, reply) => {
    try {
      const query = listQuerySchema.parse(request.query);
      const threads =
        query.archived !== undefined || query.q
          ? await listThreads()
          : await listThreads();
      const filtered = threads.filter((thread) =>
        query.archived === undefined ? true : String(Boolean(thread.archived)) === query.archived
      ).filter((thread) =>
        query.q
          ? thread.threadId.toLowerCase().includes(query.q.toLowerCase()) || thread.latestUserRequest.toLowerCase().includes(query.q.toLowerCase())
          : true
      );
      return reply.send({
        threads: filtered
      });
    } catch (error) {
      return reply.code(500).send({
        error: "THREAD_LIST_FAILED"
      });
    }
  });

  app.patch("/api/trips/archive", async (request, reply) => {
    try {
      const payload = parseArchiveThreadRequest(request.body);
      const snapshot = await archiveThread(payload);
      if (!snapshot) {
        return reply.code(404).send({
          error: "THREAD_NOT_FOUND"
        });
      }

      return reply.send({
        ok: true,
        threadId: snapshot.threadId,
        archived: snapshot.archived ?? false
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "INVALID_REQUEST",
          issues: error.issues
        });
      }

      return reply.code(500).send({
        error: "THREAD_ARCHIVE_FAILED"
      });
    }
  });

  app.get("/api/trips/thread/:threadId", async (request, reply) => {
    try {
      const { threadId } = paramsSchema.parse(request.params);
      const snapshot = await getThreadState(threadId);

      if (!snapshot) {
        return reply.code(404).send({
          error: "THREAD_NOT_FOUND"
        });
      }

      return reply.send({
        threadId,
        source: snapshot.source,
        state: snapshot.state
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "INVALID_THREAD_ID",
          issues: error.issues
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "THREAD_LOOKUP_FAILED"
      });
    }
  });

  return app;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Copy .env.example to .env and fill in your key.");
  }

  const dbHealth = await checkDatabaseHealth();
  const app = await buildServer();
  const port = Number(process.env.PORT || 3000);
  app.log.info({
    persistence: getDatabaseMode(),
    database: dbHealth
  }, "startup checks completed");

  app.addHook("onClose", async () => {
    await closePool();
  });

  await app.listen({
    host: "0.0.0.0",
    port
  });
}

main().catch((error) => {
  console.error("\nServer failed:\n");
  console.error(error);
  process.exit(1);
});
