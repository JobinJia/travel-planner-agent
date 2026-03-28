import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let checkpointerPromise: Promise<MemorySaver | PostgresSaver> | null = null;

async function createCheckpointer() {
  const databaseUrl = process.env.POSTGRES_URL;

  if (!databaseUrl) {
    return new MemorySaver();
  }

  const checkpointer = PostgresSaver.fromConnString(databaseUrl, {
    schema: process.env.POSTGRES_SCHEMA || "public"
  });

  await checkpointer.setup();
  return checkpointer;
}

export function getCheckpointer() {
  if (!checkpointerPromise) {
    checkpointerPromise = createCheckpointer();
  }

  return checkpointerPromise;
}
