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
  refreshThreadLiveContext,
  runPlanningTurn,
  runRevisionTurn
} from "./app/travel-planner-service.js";
import { checkDatabaseHealth, closePool, getDatabaseMode } from "./infrastructure/database.js";
import { geocodeDestination, searchNearbyPoi } from "./providers/amap.js";

const paramsSchema = z.object({
  threadId: z.string().min(1)
});
const listQuerySchema = z.object({
  archived: z.enum(["true", "false"]).optional(),
  q: z.string().optional()
});
const nearbyFoodQuerySchema = z.object({
  location: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "location 必须为 lng,lat 格式"),
  radius: z.coerce.number().int().min(100).max(5000).optional(),
  keyword: z.string().min(1).optional(),
  city: z.string().min(1).optional()
});
const nearbyByAddressQuerySchema = z.object({
  address: z.string().min(1, "address 不能为空"),
  radius: z.coerce.number().int().min(100).max(5000).optional(),
  keyword: z.string().min(1).optional(),
  city: z.string().min(1).optional()
});

type AppErrorResponse = {
  error: string;
  code: string;
  message: string;
  requestId: string;
  details?: string;
  statusCode: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(value: unknown, key: string) {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

function buildAppErrorResponse(error: unknown, fallbackError: string, requestId: string): AppErrorResponse {
  const message = error instanceof Error ? error.message : "服务内部发生未知错误。";
  const status = typeof (isRecord(error) ? error.status : undefined) === "number"
    ? Number((error as Record<string, unknown>).status)
    : undefined;
  const code = getStringField(error, "code");
  const lcErrorCode = getStringField(error, "lc_error_code");
  const errorType = getStringField(error, "name") || getStringField(error, "type");

  if (status === 401 || code === "invalid_api_key" || lcErrorCode === "MODEL_AUTHENTICATION" || errorType === "AuthenticationError") {
    return {
      error: fallbackError,
      code: "OPENAI_AUTHENTICATION_FAILED",
      message: "OpenAI API Key 无效或已失效，请检查 .env 中的 OPENAI_API_KEY。",
      details: message,
      requestId,
      statusCode: 401
    };
  }

  if (status === 429 || code === "rate_limit_exceeded") {
    return {
      error: fallbackError,
      code: "OPENAI_RATE_LIMITED",
      message: "OpenAI 请求触发限流，请稍后重试。",
      details: message,
      requestId,
      statusCode: 429
    };
  }

  if (status === 403 || code === "insufficient_quota") {
    return {
      error: fallbackError,
      code: "OPENAI_QUOTA_EXCEEDED",
      message: "OpenAI 账户额度不足或当前项目无权限访问该模型。",
      details: message,
      requestId,
      statusCode: 403
    };
  }

  if (code === "model_not_found") {
    return {
      error: fallbackError,
      code: "OPENAI_MODEL_UNAVAILABLE",
      message: "当前配置的模型不可用，请检查 OPENAI_MODEL 是否可访问。",
      details: message,
      requestId,
      statusCode: 400
    };
  }

  if (error instanceof Error) {
    return {
      error: fallbackError,
      code: "INTERNAL_ERROR",
      message: "规划执行失败。",
      details: message,
      requestId,
      statusCode: 500
    };
  }

  return {
    error: fallbackError,
    code: "UNKNOWN_ERROR",
    message: "规划执行失败，且未能解析出具体原因。",
    requestId,
    statusCode: 500
  };
}

function buildRouteErrorResponse(
  error: unknown,
  fallbackError: string,
  requestId: string,
  fallbackMessage: string,
  statusCode = 500
): AppErrorResponse {
  if (error instanceof Error) {
    return {
      error: fallbackError,
      code: fallbackError,
      message: fallbackMessage,
      details: error.message,
      requestId,
      statusCode
    };
  }

  return {
    error: fallbackError,
    code: fallbackError,
    message: fallbackMessage,
    requestId,
    statusCode
  };
}

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

  async function handleNearbyPoiSearch(request: Fastify.FastifyRequest, reply: Fastify.FastifyReply) {
    try {
      const query = nearbyFoodQuerySchema.parse(request.query);
      const pois = await searchNearbyPoi(
        query.location,
        query.keyword || "美食",
        query.radius ?? 1000,
        query.city
      );

      return reply.send({
        location: query.location,
        radius: query.radius ?? 1000,
        keyword: query.keyword || "美食",
        city: query.city,
        count: pois.length,
        pois
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "INVALID_REQUEST",
          issues: error.issues
        });
      }

      request.log.error(error);
      const payload = buildRouteErrorResponse(error, "POI_SEARCH_FAILED", request.id, "附近地点查询失败。");
      return reply.code(payload.statusCode).send(payload);
    }
  }

  app.get("/api/pois/nearby", handleNearbyPoiSearch);
  app.get("/api/pois/nearby-food", handleNearbyPoiSearch);
  app.get("/api/pois/nearby-by-address", async (request, reply) => {
    try {
      const query = nearbyByAddressQuerySchema.parse(request.query);
      const geocode = await geocodeDestination(query.address);

      if (!geocode?.location) {
        return reply.code(404).send({
          error: "ADDRESS_NOT_FOUND",
          message: "未能解析该地址，无法查询附近 POI。"
        });
      }

      const pois = await searchNearbyPoi(
        geocode.location,
        query.keyword || "美食",
        query.radius ?? 1000,
        query.city || geocode.city
      );

      return reply.send({
        address: query.address,
        resolvedAddress: geocode.formattedAddress,
        location: geocode.location,
        radius: query.radius ?? 1000,
        keyword: query.keyword || "美食",
        city: query.city || geocode.city,
        count: pois.length,
        pois
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "INVALID_REQUEST",
          issues: error.issues
        });
      }

      request.log.error(error);
      const payload = buildRouteErrorResponse(error, "POI_SEARCH_FAILED", request.id, "按地址查询附近地点失败。");
      return reply.code(payload.statusCode).send(payload);
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
      const payload = buildAppErrorResponse(error, "PLANNING_FAILED", request.id);
      return reply.code(payload.statusCode).send(payload);
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
      const payload = buildAppErrorResponse(error, "REVISION_FAILED", request.id);
      return reply.code(payload.statusCode).send(payload);
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
      request.log.error(error);
      const payload = buildRouteErrorResponse(error, "THREAD_LIST_FAILED", request.id, "线程列表加载失败。");
      return reply.code(payload.statusCode).send(payload);
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

      request.log.error(error);
      const payload = buildRouteErrorResponse(error, "THREAD_ARCHIVE_FAILED", request.id, "线程归档操作失败。");
      return reply.code(payload.statusCode).send(payload);
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
      const payload = buildRouteErrorResponse(error, "THREAD_LOOKUP_FAILED", request.id, "线程加载失败。");
      return reply.code(payload.statusCode).send(payload);
    }
  });

  app.post("/api/trips/:threadId/refresh-live-context", async (request, reply) => {
    try {
      const { threadId } = paramsSchema.parse(request.params);
      const refreshed = await refreshThreadLiveContext(threadId);

      if (!refreshed) {
        return reply.code(404).send({
          error: "THREAD_NOT_FOUND"
        });
      }

      return reply.send(refreshed);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "INVALID_THREAD_ID",
          issues: error.issues
        });
      }

      request.log.error(error);
      const payload = buildRouteErrorResponse(error, "REFRESH_LIVE_CONTEXT_FAILED", request.id, "刷新实时信息失败。");
      return reply.code(payload.statusCode).send(payload);
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
