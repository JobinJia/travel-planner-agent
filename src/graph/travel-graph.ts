import { ChatPromptTemplate } from "@langchain/core/prompts";
import { START, END, Annotation, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { getCheckpointer } from "./checkpointer.js";
import { CandidatePlan, ConfirmationOption, TravelPreferenceProfile } from "../types/travel.js";
import {
  CLARIFICATION_PROMPT,
  CONFIRMATION_PROMPT,
  FINALIZER_PROMPT,
  OPTION_GENERATOR_PROMPT,
  REQUIREMENT_ANALYST_PROMPT
} from "../prompts/travel-graph.js";
import { buildPackingChecklist, estimateBudget, getSeasonAdvice } from "../tools/travel-tools.js";
import { buildLiveTravelContext } from "../tools/live-travel-context.js";

const CandidatePlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  pace: z.enum(["relaxed", "balanced", "packed"]),
  travelStyle: z.enum(["budget", "balanced", "premium"]),
  suitableFor: z.string(),
  highlights: z.array(z.string()).min(2).max(6),
  dailyOutline: z.array(z.string()).min(3).max(10),
  dailyPlan: z.array(
    z.object({
      day: z.number().int().min(1).max(14),
      theme: z.string(),
      items: z.array(
        z.object({
          timeOfDay: z.enum(["morning", "afternoon", "evening"]),
          title: z.string(),
          locationHint: z.string(),
          activityType: z.enum(["sightseeing", "food", "shopping", "nature", "transport", "hotel", "mixed"])
        })
      ).min(1).max(5)
    })
  ).min(3).max(10)
});

const TravelProfileSchema = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budgetCny: z.number().optional(),
  travelers: z.number().optional(),
  interests: z.array(z.string()).default([]),
  pace: z.enum(["relaxed", "balanced", "packed"]).optional(),
  travelStyle: z.enum(["budget", "balanced", "premium"]).optional(),
  notes: z.array(z.string()).default([])
});

const ClarificationSchema = z.object({
  missingInfo: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([])
});

const OptionSetSchema = z.object({
  options: z.array(CandidatePlanSchema).length(2)
});

const GraphState = Annotation.Root({
  latestUserRequest: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => ""
  }),
  conversationTurns: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  }),
  profile: Annotation<TravelPreferenceProfile | null>({
    reducer: (_current, update) => update,
    default: () => null
  }),
  missingInfo: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => []
  }),
  assumptions: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => []
  }),
  options: Annotation<CandidatePlan[]>({
    reducer: (_current, update) => update,
    default: () => []
  }),
  comparison: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => ""
  }),
  liveContext: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => ""
  }),
  routeContext: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => ""
  }),
  requiresConfirmation: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false
  }),
  confirmationMessage: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => ""
  }),
  confirmationOptions: Annotation<ConfirmationOption[]>({
    reducer: (_current, update) => update,
    default: () => []
  }),
  confirmationResolved: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false
  }),
  finalAnswer: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => ""
  })
});

function createModel() {
  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0.2
  });
}

function mergeProfile(
  previous: TravelPreferenceProfile | null,
  next: Partial<z.infer<typeof TravelProfileSchema>>
): TravelPreferenceProfile {
  return {
    origin: next.origin ?? previous?.origin,
    destination: next.destination ?? previous?.destination,
    startDate: next.startDate ?? previous?.startDate,
    endDate: next.endDate ?? previous?.endDate,
    budgetCny: next.budgetCny ?? previous?.budgetCny,
    travelers: next.travelers ?? previous?.travelers,
    interests: next.interests && next.interests.length > 0 ? next.interests : (previous?.interests ?? []),
    pace: next.pace ?? previous?.pace,
    travelStyle: next.travelStyle ?? previous?.travelStyle,
    notes: [...(previous?.notes ?? []), ...(next.notes ?? [])]
  };
}

function computeTripDays(profile: TravelPreferenceProfile | null) {
  if (!profile?.startDate || !profile?.endDate) {
    return 5;
  }

  const start = new Date(profile.startDate);
  const end = new Date(profile.endDate);
  const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return Number.isFinite(diff) && diff > 0 ? diff : 5;
}

function inferTripType(interests: string[]): "city" | "nature" | "business" | "mixed" {
  const normalized = interests.join(" ").toLowerCase();
  if (normalized.includes("徒步") || normalized.includes("自然") || normalized.includes("山")) {
    return "nature";
  }
  if (normalized.includes("商务") || normalized.includes("会议")) {
    return "business";
  }
  if (normalized.includes("城市") || normalized.includes("美食") || normalized.includes("逛")) {
    return "city";
  }
  return "mixed";
}

function detectConfirmationIntent(input: string) {
  const normalized = input.replace(/\s+/g, "");
  if (
    normalized.includes("保持不变")
    || normalized.includes("就这样")
    || normalized.includes("按原计划")
    || normalized.includes("接受")
  ) {
    return "keep";
  }

  if (
    normalized.includes("延长")
    || normalized.includes("多玩")
    || normalized.includes("加一天")
    || normalized.includes("加2天")
  ) {
    return "extend";
  }

  if (
    normalized.includes("公交优先")
    || normalized.includes("公共交通")
    || normalized.includes("地铁")
    || normalized.includes("公交")
  ) {
    return "transit";
  }

  if (
    normalized.includes("压缩")
    || normalized.includes("删掉")
    || normalized.includes("减少")
    || normalized.includes("放慢")
  ) {
    return "compress";
  }

  return null;
}

function buildConfirmationOptions(): ConfirmationOption[] {
  return [
    {
      action: "compress",
      label: "压缩景点",
      description: "减少每天的核心点位，优先保住体验质量。"
    },
    {
      action: "extend",
      label: "延长一天",
      description: "通过增加旅行天数换取更宽松的节奏。"
    },
    {
      action: "transit",
      label: "公交优先",
      description: "优先按公共交通重排路线，控制成本与城市通勤。"
    },
    {
      action: "keep",
      label: "保持不变",
      description: "接受当前偏紧节奏，直接输出最终方案。"
    }
  ];
}

function shouldRequireConfirmation(routeContext: string, latestUserRequest: string) {
  if (!routeContext.includes("拥挤度 高")) {
    return false;
  }

  return detectConfirmationIntent(latestUserRequest) === null;
}

async function collectRequirementsNode(state: typeof GraphState.State) {
  const model = createModel().withStructuredOutput(TravelProfileSchema);
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", REQUIREMENT_ANALYST_PROMPT],
    [
      "human",
      [
        "已有旅行档案：{profile}",
        "历史对话：{conversationTurns}",
        "用户本轮输入：{latestUserRequest}",
        "请输出更新后的结构化偏好。"
      ].join("\n")
    ]
  ]);

  const chain = prompt.pipe(model);
  const extracted = await chain.invoke({
    profile: JSON.stringify(state.profile ?? {}, null, 2),
    conversationTurns: state.conversationTurns.join("\n"),
    latestUserRequest: state.latestUserRequest
  });

  return {
    profile: mergeProfile(state.profile, extracted)
  };
}

async function clarifyMissingInfoNode(state: typeof GraphState.State) {
  const model = createModel().withStructuredOutput(ClarificationSchema);
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", CLARIFICATION_PROMPT],
    [
      "human",
      [
        "当前档案：{profile}",
        "用户最新需求：{latestUserRequest}",
        "请判断还缺哪些关键信息，以及为了继续产出方案可以采用哪些假设。"
      ].join("\n")
    ]
  ]);

  const chain = prompt.pipe(model);
  const clarification = await chain.invoke({
    profile: JSON.stringify(state.profile ?? {}, null, 2),
    latestUserRequest: state.latestUserRequest
  });

  return clarification;
}

async function generateOptionsNode(state: typeof GraphState.State) {
  const model = createModel().withStructuredOutput(OptionSetSchema);
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", OPTION_GENERATOR_PROMPT],
    [
      "human",
      [
        "当前档案：{profile}",
        "待确认信息：{missingInfo}",
        "默认假设：{assumptions}",
        "请输出两个候选旅游方案。"
      ].join("\n")
    ]
  ]);

  const chain = prompt.pipe(model);
  const generated = await chain.invoke({
    profile: JSON.stringify(state.profile ?? {}, null, 2),
    missingInfo: JSON.stringify(state.missingInfo, null, 2),
    assumptions: JSON.stringify(state.assumptions, null, 2)
  });

  return {
    options: generated.options
  };
}

async function compareOptionsNode(state: typeof GraphState.State) {
  const profile = state.profile;
  const destination = profile?.destination || "未明确目的地";
  const days = computeTripDays(profile);
  const travelers = profile?.travelers ?? 2;
  const month = profile?.startDate ? new Date(profile.startDate).getMonth() + 1 : undefined;
  const seasonAdvice = destination === "未明确目的地" ? "目的地未明确，季节建议暂不适用。" : getSeasonAdvice(destination, month);

  const comparisonLines = state.options.map((option, index) => {
    const budget = estimateBudget({
      destination,
      days,
      travelers,
      travelStyle: option.travelStyle
    });

    const budgetFit =
      profile?.budgetCny && budget.total > profile.budgetCny
        ? `超出当前预算约 ${budget.total - profile.budgetCny} 元`
        : profile?.budgetCny
          ? `在当前预算内，预计结余约 ${profile.budgetCny - budget.total} 元`
          : "用户未提供总预算，暂按经验估算";

    return [
      `方案 ${index + 1}：${option.title}`,
      `定位：${option.summary}`,
      `节奏：${option.pace}，风格：${option.travelStyle}`,
      `预算估算：约 ${budget.total} CNY（住宿餐饮 ${budget.breakdown.hotelAndFood}，交通 ${budget.breakdown.transport}，活动 ${budget.breakdown.activities}）`,
      `预算判断：${budgetFit}`,
      `适合人群：${option.suitableFor}`
    ].join("\n");
  });

  const recommended =
    state.options.find((option) => option.travelStyle === (profile?.travelStyle ?? "balanced")) ?? state.options[0];

  const tripType = inferTripType(profile?.interests ?? []);
  const packingChecklist = buildPackingChecklist({
    destination,
    weather: seasonAdvice,
    tripType,
    days
  });

  const comparison = [
    ...comparisonLines,
    `季节建议：${seasonAdvice}`,
    `推荐优先采用：${recommended.title}`,
    `打包清单建议：${packingChecklist.join("、")}`
  ].join("\n\n");

  const realtime = await buildLiveTravelContext(profile, state.options);
  const liveContext = realtime.liveContext;
  const routeContext = realtime.routeContext;

  return {
    comparison,
    liveContext,
    routeContext,
    requiresConfirmation: shouldRequireConfirmation(routeContext, state.latestUserRequest),
    confirmationOptions: shouldRequireConfirmation(routeContext, state.latestUserRequest) ? buildConfirmationOptions() : [],
    confirmationResolved: detectConfirmationIntent(state.latestUserRequest) !== null
  };
}

async function requestConfirmationNode(state: typeof GraphState.State) {
  const model = createModel();
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", CONFIRMATION_PROMPT],
    [
      "human",
      [
        "当前档案：{profile}",
        "候选方案：{options}",
        "预算与比较：{comparison}",
        "路线评估：{routeContext}",
        "请向用户发出确认请求。"
      ].join("\n")
    ]
  ]);

  const chain = prompt.pipe(model);
  const answer = await chain.invoke({
    profile: JSON.stringify(state.profile ?? {}, null, 2),
    options: JSON.stringify(state.options, null, 2),
    comparison: state.comparison,
    routeContext: state.routeContext
  });

  const confirmationMessage =
    typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content);

  return {
    confirmationMessage,
    confirmationOptions: buildConfirmationOptions(),
    finalAnswer: confirmationMessage
  };
}

async function finalizeNode(state: typeof GraphState.State) {
  const model = createModel();
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", FINALIZER_PROMPT],
    [
      "human",
      [
        "当前档案：{profile}",
        "用户最新输入：{latestUserRequest}",
        "候选方案：{options}",
        "方案对比与预算判断：{comparison}",
        "实时地点与天气参考：{liveContext}",
        "路线规划与拥挤度评估：{routeContext}",
        "待确认信息：{missingInfo}",
        "默认假设：{assumptions}",
        "请输出最终旅行方案。"
      ].join("\n")
    ]
  ]);

  const chain = prompt.pipe(model);
  const answer = await chain.invoke({
    profile: JSON.stringify(state.profile ?? {}, null, 2),
    latestUserRequest: state.latestUserRequest,
    options: JSON.stringify(state.options, null, 2),
    comparison: state.comparison,
    liveContext: state.liveContext,
    routeContext: state.routeContext,
    missingInfo: JSON.stringify(state.missingInfo, null, 2),
    assumptions: JSON.stringify(state.assumptions, null, 2)
  });

  return {
    finalAnswer: typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content)
  };
}

export async function createTravelPlannerGraph() {
  const checkpointer = await getCheckpointer();
  const builder = new StateGraph(GraphState)
    .addNode("collect_requirements", collectRequirementsNode)
    .addNode("clarify_missing_info", clarifyMissingInfoNode)
    .addNode("generate_options", generateOptionsNode)
    .addNode("compare_options", compareOptionsNode)
    .addNode("request_confirmation", requestConfirmationNode)
    .addNode("finalize_itinerary", finalizeNode)
    .addEdge(START, "collect_requirements")
    .addEdge("collect_requirements", "clarify_missing_info")
    .addEdge("clarify_missing_info", "generate_options")
    .addEdge("generate_options", "compare_options")
    .addConditionalEdges("compare_options", (state) =>
      state.requiresConfirmation ? "request_confirmation" : "finalize_itinerary",
    {
      request_confirmation: "request_confirmation",
      finalize_itinerary: "finalize_itinerary"
    })
    .addEdge("request_confirmation", END)
    .addEdge("finalize_itinerary", END);

  return builder.compile({
    checkpointer
  });
}
