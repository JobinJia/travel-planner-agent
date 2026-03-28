import { CandidatePlan, DailyPlan, TravelPreferenceProfile } from "../types/travel.js";
import {
  geocodeDestination,
  getDrivingRoute,
  getTransitRoute,
  getWalkingRoute,
  searchPoi,
  RouteMode,
  RouteSummary
} from "../providers/amap.js";
import { getDailyForecast } from "../providers/qweather.js";

function buildPoiKeyword(destination: string, interests: string[]) {
  if (interests.some((interest) => interest.includes("美食"))) {
    return `${destination} 美食`;
  }

  if (interests.some((interest) => interest.includes("自然") || interest.includes("徒步"))) {
    return `${destination} 自然景点`;
  }

  return `${destination} 景点`;
}

function extractDayLabel(outline: string, index: number) {
  const matched = outline.match(/(Day\s*\d+|第\s*\d+\s*天)/i);
  return matched?.[0]?.replace(/\s+/g, "") || `Day${index + 1}`;
}

function sanitizeOutline(outline: string) {
  return outline
    .replace(/Day\s*\d+[:：-]*/gi, "")
    .replace(/第\s*\d+\s*天[:：-]*/g, "")
    .replace(/[，,。；;、]/g, " ")
    .trim();
}

function tokenizeOutline(outline: string) {
  return sanitizeOutline(outline)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 4);
}

function buildKeywordsFromDailyPlan(destination: string, day: DailyPlan) {
  return day.items
    .map((item) => item.locationHint || item.title)
    .map((text) => text.trim())
    .filter((text) => text.length >= destination.length + 2)
    .slice(0, 4);
}

function summarizeModeLabel(mode: RouteMode) {
  if (mode === "walking") {
    return "步行";
  }
  if (mode === "transit") {
    return "公交";
  }
  return "驾车";
}

function pickPreferredMode(option: CandidatePlan): RouteMode {
  if (option.pace === "relaxed") {
    return "walking";
  }
  if (option.travelStyle === "budget") {
    return "transit";
  }
  if (option.pace === "packed") {
    return "driving";
  }
  return "transit";
}

function assessCongestion(option: CandidatePlan, routeByMode: Partial<Record<RouteMode, number>>) {
  const preferredMode = pickPreferredMode(option);
  const preferredMinutes = routeByMode[preferredMode] ?? routeByMode.transit ?? routeByMode.driving ?? routeByMode.walking ?? null;
  if (preferredMinutes === null) {
    return `方案“${option.title}”未获取到路线数据，无法做拥挤度判断。`;
  }

  const isPacked = option.pace === "packed";
  const isRelaxed = option.pace === "relaxed";
  const score = preferredMinutes + (isPacked ? 40 : 0) - (isRelaxed ? 20 : 0);
  const level = score >= 160 ? "高" : score >= 90 ? "中" : "低";

  return `方案“${option.title}”按${summarizeModeLabel(preferredMode)}样本路线估算，单日核心点通勤约 ${preferredMinutes} 分钟，拥挤度 ${level}。`;
}

async function collectRouteMatrix(routeSamples: Array<{ name: string; location: string }>, city?: string) {
  if (routeSamples.length < 2) {
    return {
      legsByMode: {
        walking: [],
        transit: [],
        driving: []
      },
      totalMinutesByMode: {}
    };
  }

  const pairs = routeSamples.slice(0, -1).map((poi, index) => ({
    origin: poi.location,
    destination: routeSamples[index + 1].location
  }));

  const [walkingLegs, transitLegs, drivingLegs] = await Promise.all([
    Promise.all(pairs.map((pair) => getWalkingRoute(pair.origin, pair.destination))),
    Promise.all(pairs.map((pair) => getTransitRoute(pair.origin, pair.destination, city))),
    Promise.all(pairs.map((pair) => getDrivingRoute(pair.origin, pair.destination)))
  ]);

  const totalMinutesByMode: Partial<Record<RouteMode, number>> = {};
  const modeEntries: Array<[RouteMode, Array<RouteSummary | null>]> = [
    ["walking", walkingLegs],
    ["transit", transitLegs],
    ["driving", drivingLegs]
  ];

  for (const [mode, legs] of modeEntries) {
    const validLegs = legs.filter((item): item is RouteSummary => item !== null);
    if (validLegs.length > 0) {
      totalMinutesByMode[mode] = Math.round(
        validLegs.reduce((total, item) => total + item.durationSeconds, 0) / 60
      );
    }
  }

  return {
    legsByMode: {
      walking: walkingLegs,
      transit: transitLegs,
      driving: drivingLegs
    },
    totalMinutesByMode
  };
}

function buildRouteSummary(routeSamples: Array<{ name: string; location: string }>, totalMinutesByMode: Partial<Record<RouteMode, number>>) {
  if (routeSamples.length < 2) {
    return "未获取到足够的 POI 路线样本。";
  }

  const parts = (["walking", "transit", "driving"] as RouteMode[])
    .filter((mode) => totalMinutesByMode[mode] !== undefined)
    .map((mode) => `${summarizeModeLabel(mode)}约 ${totalMinutesByMode[mode]} 分钟`);

  if (parts.length === 0) {
    return "未获取到足够的 POI 路线样本。";
  }

  return `样本路线参考：${routeSamples.map((poi) => poi.name).join(" -> ")}，${parts.join("，")}。`;
}

async function collectDailyRouteSamples(destination: string, city: string | undefined, option: CandidatePlan) {
  const dailySamples = await Promise.all(
    (option.dailyPlan.length > 0 ? option.dailyPlan.slice(0, 4) : option.dailyOutline.slice(0, 4).map((outline, index) => ({
      day: index + 1,
      theme: extractDayLabel(outline, index),
      items: tokenizeOutline(outline).map((keyword, itemIndex) => ({
        timeOfDay: itemIndex === 0 ? "morning" as const : itemIndex === 1 ? "afternoon" as const : "evening" as const,
        title: keyword,
        locationHint: keyword,
        activityType: "mixed" as const
      }))
    }))).map(async (day, index) => {
      const outline = option.dailyOutline[index] ?? `${extractDayLabel(`Day ${day.day}`, index)} ${day.theme}`;
      const keywords = buildKeywordsFromDailyPlan(destination, day);
      const poiResults = await Promise.all(
        keywords.map((keyword) => searchPoi(`${destination} ${keyword}`, city))
      );

      const pois = poiResults
        .flat()
        .filter((poi) => poi.location)
        .slice(0, 3)
        .map((poi) => ({
          name: poi.name,
          location: poi.location
        }));

      const routeMatrix = await collectRouteMatrix(pois, city);
      return {
        dayLabel: `Day${day.day}`,
        outline,
        pois,
        routeMatrix
      };
    })
  );

  return dailySamples.filter((sample) => sample.pois.length >= 2);
}

function scoreCongestionByMinutes(option: CandidatePlan, preferredMinutes: number | null) {
  if (preferredMinutes === null) {
    return "未知";
  }

  const isPacked = option.pace === "packed";
  const isRelaxed = option.pace === "relaxed";
  const score = preferredMinutes + (isPacked ? 40 : 0) - (isRelaxed ? 20 : 0);
  return score >= 160 ? "高" : score >= 90 ? "中" : "低";
}

function buildOptionDailyAssessment(option: CandidatePlan, dailySamples: Array<{
  dayLabel: string;
  outline: string;
  pois: Array<{ name: string; location: string }>;
  routeMatrix: { totalMinutesByMode: Partial<Record<RouteMode, number>> };
}>) {
  if (dailySamples.length === 0) {
    return `方案“${option.title}”未能从每日行程中解析出足够的 POI，暂无法做逐日路线评估。`;
  }

  const preferredMode = pickPreferredMode(option);
  const lines = dailySamples.map((sample) => {
    const preferredMinutes =
      sample.routeMatrix.totalMinutesByMode[preferredMode]
      ?? sample.routeMatrix.totalMinutesByMode.transit
      ?? sample.routeMatrix.totalMinutesByMode.driving
      ?? sample.routeMatrix.totalMinutesByMode.walking
      ?? null;
    const level = scoreCongestionByMinutes(option, preferredMinutes);

    const modeParts = (["walking", "transit", "driving"] as RouteMode[])
      .filter((mode) => sample.routeMatrix.totalMinutesByMode[mode] !== undefined)
      .map((mode) => `${summarizeModeLabel(mode)} ${sample.routeMatrix.totalMinutesByMode[mode]} 分钟`);

    return `${sample.dayLabel}：${sample.pois.map((poi) => poi.name).join(" -> ")}；${modeParts.join("，")}；按${summarizeModeLabel(preferredMode)}评估拥挤度 ${level}`;
  });

  return [`方案“${option.title}”逐日路线评估：`, ...lines].join("\n");
}

export async function buildLiveTravelContext(profile: TravelPreferenceProfile | null, options: CandidatePlan[] = []) {
  if (!profile?.destination) {
    return {
      liveContext: "未提供目的地，无法查询实时地点与天气信息。",
      routeContext: "未提供目的地，无法进行路线规划评估。"
    };
  }

  const destination = profile.destination;

  if (!process.env.AMAP_API_KEY && !process.env.QWEATHER_API_KEY) {
    return {
      liveContext: "未配置高德或和风天气 API Key，当前使用纯模型规划。",
      routeContext: "未配置高德 API Key，无法进行路线规划评估。"
    };
  }

  try {
    const geocode = await geocodeDestination(destination);
    if (!geocode) {
      return {
        liveContext: `未能从高德解析目的地“${destination}”，已回退为通用规划。`,
        routeContext: "目的地解析失败，无法进行路线规划评估。"
      };
    }

    const [forecast, pois] = await Promise.all([
      process.env.QWEATHER_API_KEY ? getDailyForecast(geocode.location) : Promise.resolve([]),
      process.env.AMAP_API_KEY ? searchPoi(buildPoiKeyword(destination, profile.interests), geocode.city) : Promise.resolve([])
    ]);

    const routeSamples = pois
      .filter((poi) => poi.location)
      .slice(0, 3);

    const routeMatrix = await collectRouteMatrix(routeSamples, geocode.city);

    const weatherSummary =
      forecast.length > 0
        ? forecast
            .slice(0, 3)
            .map((item) => `${item.fxDate} ${item.textDay} ${item.tempMin}-${item.tempMax}C`)
            .join("；")
        : "未获取到实时天气。";

    const poiSummary =
      pois.length > 0
        ? pois
            .slice(0, 3)
            .map((poi) => `${poi.name}${poi.address ? `（${poi.address}）` : ""}`)
            .join("、")
        : "未获取到 POI 建议。";

    const routeSummary = buildRouteSummary(routeSamples, routeMatrix.totalMinutesByMode);

    const optionRouteAssessments = await Promise.all(
      options.map(async (option) => {
        const dailySamples = await collectDailyRouteSamples(destination, geocode.city, option);
        const aggregateLine = assessCongestion(option, routeMatrix.totalMinutesByMode);
        const dailyAssessment = buildOptionDailyAssessment(option, dailySamples);
        return [aggregateLine, dailyAssessment].join("\n");
      })
    );

    const routeContext =
      options.length > 0
        ? [routeSummary, ...optionRouteAssessments].join("\n\n")
        : routeSummary;

    return {
      liveContext: [
        `高德解析目的地：${geocode.formattedAddress}`,
        `实时天气参考：${weatherSummary}`,
        `POI 参考：${poiSummary}`
      ].join("\n"),
      routeContext
    };
  } catch (error) {
    return {
      liveContext: `实时数据查询失败，已回退为通用规划。失败原因：${error instanceof Error ? error.message : "unknown error"}`,
      routeContext: "路线规划评估失败，已忽略路线约束。"
    };
  }
}
