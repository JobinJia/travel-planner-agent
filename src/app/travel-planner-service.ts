import crypto from "node:crypto";
import { z } from "zod";

import { createTravelPlannerGraph } from "../graph/travel-graph.js";
import { createThreadSnapshotStore } from "../store/thread-snapshot-store.js";
import { appendThreadMessages, getThreadMessages } from "../store/thread-message-store.js";
import { ThreadMessage } from "../types/travel.js";

const planRequestSchema = z.object({
  threadId: z.string().min(1).optional(),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type PlanRequest = z.infer<typeof planRequestSchema>;
export type ReviseRequest = z.infer<typeof reviseRequestSchema>;

const reviseRequestSchema = z.object({
  threadId: z.string().min(1),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});
const archiveThreadSchema = z.object({
  threadId: z.string().min(1),
  archived: z.boolean()
});

const threadSnapshotStore = createThreadSnapshotStore();
let graphPromise: ReturnType<typeof createTravelPlannerGraph> | null = null;

async function getGraph() {
  if (!graphPromise) {
    graphPromise = createTravelPlannerGraph();
  }

  return graphPromise;
}

export function parsePlanRequest(input: unknown) {
  return planRequestSchema.parse(input);
}

export function parseReviseRequest(input: unknown) {
  return reviseRequestSchema.parse(input);
}

export function parseArchiveThreadRequest(input: unknown) {
  return archiveThreadSchema.parse(input);
}

async function executePlanningTurn(input: PlanRequest | ReviseRequest) {
  const threadId = input.threadId ?? crypto.randomUUID();
  const graph = await getGraph();
  const existingSnapshot = await threadSnapshotStore.get(threadId);
  const existingMessages = (await getThreadMessages(threadId))?.map((message) => ({
    role: message.role,
    content: message.content,
    createdAt: message.createdAt
  })) ?? existingSnapshot?.messages ?? [];
  const result = await graph.invoke(
    {
      latestUserRequest: input.message,
      conversationTurns: [`用户: ${input.message}`]
    },
    {
      configurable: {
        thread_id: threadId,
        metadata: input.metadata ?? {}
      }
    }
  );

  const response = {
    threadId,
    finalAnswer: result.finalAnswer,
    requiresConfirmation: result.requiresConfirmation,
    confirmationMessage: result.confirmationMessage,
    confirmationOptions: result.confirmationOptions,
    confirmationResolved: result.confirmationResolved,
    profile: result.profile,
    missingInfo: result.missingInfo,
    assumptions: result.assumptions,
    options: result.options,
    comparison: result.comparison,
    liveContext: result.liveContext,
    routeContext: result.routeContext
  };

  const now = new Date().toISOString();
  const newMessages: ThreadMessage[] = [
    {
      role: "user",
      content: input.message,
      createdAt: now
    },
    {
      role: "agent",
      content: response.finalAnswer,
      createdAt: now
    }
  ];
  const messages: ThreadMessage[] = [...existingMessages, ...newMessages];

  await appendThreadMessages(threadId, newMessages);

  await threadSnapshotStore.save({
    threadId,
    updatedAt: now,
    latestUserRequest: input.message,
    finalAnswer: response.finalAnswer,
    requiresConfirmation: response.requiresConfirmation,
    confirmationMessage: response.confirmationMessage,
    confirmationOptions: response.confirmationOptions,
    confirmationResolved: response.confirmationResolved,
    profile: response.profile,
    missingInfo: response.missingInfo,
    assumptions: response.assumptions,
    options: response.options,
    comparison: response.comparison,
    liveContext: response.liveContext,
    routeContext: response.routeContext,
    messages
  });

  return {
    ...response,
    messages
  };
}

export async function runPlanningTurn(input: PlanRequest) {
  return executePlanningTurn(input);
}

export async function runRevisionTurn(input: ReviseRequest) {
  return executePlanningTurn(input);
}

export async function getThreadState(threadId: string) {
  const graph = await getGraph();
  const snapshot = await graph.getState({
    configurable: {
      thread_id: threadId
    }
  });

  if (snapshot.values && Object.keys(snapshot.values).length > 0) {
    return {
      source: "graph" as const,
      state: snapshot.values
    };
  }

  const persistedSnapshot = await threadSnapshotStore.get(threadId);
  if (!persistedSnapshot) {
    return null;
  }

  const dbMessages = await getThreadMessages(threadId);
  const messages = dbMessages?.map((message) => ({
    role: message.role,
    content: message.content,
    createdAt: message.createdAt
  })) ?? persistedSnapshot.messages;

  return {
    source: "snapshot" as const,
    state: {
      ...persistedSnapshot,
      messages
    }
  };
}

export async function listThreads() {
  return threadSnapshotStore.list();
}

export async function searchThreads(input: { archived?: boolean; query?: string }) {
  return threadSnapshotStore.list(input);
}

export async function archiveThread(input: z.infer<typeof archiveThreadSchema>) {
  return threadSnapshotStore.archive(input.threadId, input.archived);
}
