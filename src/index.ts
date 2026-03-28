import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { runPlanningTurn } from "./app/travel-planner-service.js";

function getQueryFromArgs() {
  const queryFlagIndex = process.argv.findIndex((arg) => arg === "--query");
  if (queryFlagIndex >= 0) {
    return process.argv[queryFlagIndex + 1];
  }

  return undefined;
}

function getThreadIdFromArgs() {
  const threadFlagIndex = process.argv.findIndex((arg) => arg === "--thread");
  if (threadFlagIndex >= 0) {
    return process.argv[threadFlagIndex + 1];
  }

  return undefined;
}

async function promptForQuery(rl: ReturnType<typeof createInterface>) {
  const answer = await rl.question("请输入你的旅行规划需求: ");
  return answer.trim();
}

async function runSingleQuery() {
  const query = getQueryFromArgs();

  if (!query) {
    throw new Error("No travel planning request provided.");
  }

  const threadId = getThreadIdFromArgs();
  const result = await runPlanningTurn({
    threadId,
    message: query
  });

  console.log(`\n=== Travel Plan (${result.threadId}) ===\n`);
  console.log(result.finalAnswer);
}

async function runInteractiveSession() {
  const rl = createInterface({ input, output });
  const threadId = getThreadIdFromArgs();

  try {
    const displayThread = threadId ?? "auto-generated";
    console.log(`当前会话线程: ${displayThread}`);
    console.log("输入旅行需求开始规划；输入 exit 结束。");

    while (true) {
      const query = await promptForQuery(rl);
      if (!query) {
        continue;
      }

      if (query.toLowerCase() === "exit") {
        break;
      }

      const result = await runPlanningTurn({
        threadId,
        message: query
      });

      console.log("\n=== Travel Plan ===\n");
      console.log(result.finalAnswer);
      console.log(`\nthread_id: ${result.threadId}`);
      console.log("\n你可以继续补充要求，例如“预算降到 1.5 万”或“想把节奏放慢一些”。\n");
    }
  } finally {
    rl.close();
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Copy .env.example to .env and fill in your key.");
  }

  if (getQueryFromArgs()) {
    await runSingleQuery();
    return;
  }

  await runInteractiveSession();
}

main().catch((error) => {
  console.error("\nAgent failed:\n");
  console.error(error);
  process.exit(1);
});
