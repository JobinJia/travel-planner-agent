import { CandidatePlan, DailyPlan, OptionRouteMetrics, TravelPreferenceProfile } from "../types/travel.js";
import {
  geocodeDestination,
  getDrivingRoute,
  getTransitRoute,
  getWalkingRoute,
  getWeatherLive,
  getWeatherForecast,
  searchPoi,
  RouteMode,
  RouteSummary
} from "../providers/amap.js";

function hasConfiguredAmapKey() {
  const key = process.env.AMAP_API_KEY?.trim();
  return Boolean(key && key !== "your_amap_api_key");
}

function dedupeNonEmpty(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

function buildWeatherQueryCandidates(destination: string, geocode: {
  adcode?: string;
  province?: string;
  city?: string;
  district?: string;
  formattedAddress: string;
}) {
  void destination;
  void geocode.formattedAddress;
  return dedupeNonEmpty([
    geocode.adcode,
    geocode.district,
    geocode.city,
    geocode.province,
  ]);
}

async function resolveWeatherContext(candidates: string[]) {
  let lastError: Error | null = null;

  for (const query of candidates) {
    try {
      const [live, forecast] = await Promise.all([
        getWeatherLive(query),
        getWeatherForecast(query)
      ]);

      if (live || forecast.length > 0) {
        return {
          live,
          forecast,
          query,
          error: null
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("unknown error");
    }
  }

  return {
    live: null,
    forecast: [] as Awaited<ReturnType<typeof getWeatherForecast>>,
    query: "",
    error: lastError ?? new Error(`AMap 天气查询无结果，已尝试：${candidates.join(" -> ")}`)
  };
}


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

function pickBestAvailableMinutes(
  preferredMode: RouteMode,
  routeByMode: Partial<Record<RouteMode, number>>
) {
  return routeByMode[preferredMode] ?? routeByMode.transit ?? routeByMode.driving ?? routeByMode.walking ?? null;
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
  const preferredMinutes = pickBestAvailableMinutes(preferredMode, routeByMode);
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

function scoreCongestionByMinutes(option: CandidatePlan, preferredMinutes: number | null): "低" | "中" | "高" | "未知" {
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
    const preferredMinutes = pickBestAvailableMinutes(preferredMode, sample.routeMatrix.totalMinutesByMode);
    const level = scoreCongestionByMinutes(option, preferredMinutes);

    const modeParts = (["walking", "transit", "driving"] as RouteMode[])
      .filter((mode) => sample.routeMatrix.totalMinutesByMode[mode] !== undefined)
      .map((mode) => `${summarizeModeLabel(mode)} ${sample.routeMatrix.totalMinutesByMode[mode]} 分钟`);

    return `${sample.dayLabel}：${sample.pois.map((poi) => poi.name).join(" -> ")}；${modeParts.join("，")}；按${summarizeModeLabel(preferredMode)}评估拥挤度 ${level}`;
  });

  return [`方案“${option.title}”逐日路线评估：`, ...lines].join("\n");
}

function buildOptionRouteMetrics(option: CandidatePlan, routeByMode: Partial<Record<RouteMode, number>>, dailySamples: Array<{
  dayLabel: string;
  outline: string;
  pois: Array<{ name: string; location: string }>;
  routeMatrix: { totalMinutesByMode: Partial<Record<RouteMode, number>> };
}>): OptionRouteMetrics {
  const preferredMode = pickPreferredMode(option);
  const preferredMinutes = pickBestAvailableMinutes(preferredMode, routeByMode);
  const dailyMetrics = dailySamples.map((sample) => {
    const dayPreferredMinutes = pickBestAvailableMinutes(preferredMode, sample.routeMatrix.totalMinutesByMode);
    return {
      dayLabel: sample.dayLabel,
      preferredMinutes: dayPreferredMinutes,
      congestionLevel: scoreCongestionByMinutes(option, dayPreferredMinutes),
      minutesByMode: {
        walking: sample.routeMatrix.totalMinutesByMode.walking,
        transit: sample.routeMatrix.totalMinutesByMode.transit,
        driving: sample.routeMatrix.totalMinutesByMode.driving
      }
    };
  });

  const validDayMinutes = dailyMetrics
    .map((item) => item.preferredMinutes)
    .filter((value): value is number => typeof value === "number");

  return {
    title: option.title,
    preferredMode,
    preferredModeLabel: summarizeModeLabel(preferredMode),
    preferredMinutes,
    congestionLevel: scoreCongestionByMinutes(option, preferredMinutes),
    averagePreferredMinutesPerDay: validDayMinutes.length > 0
      ? Math.round(validDayMinutes.reduce((sum, value) => sum + value, 0) / validDayMinutes.length)
      : null,
    peakPreferredMinutesPerDay: validDayMinutes.length > 0 ? Math.max(...validDayMinutes) : null,
    evaluatedDays: dailyMetrics.length,
    sampleMinutesByMode: {
      walking: routeByMode.walking,
      transit: routeByMode.transit,
      driving: routeByMode.driving
    },
    dailyMetrics
  };
}

export async function buildLiveTravelContext(profile: TravelPreferenceProfile | null, options: CandidatePlan[] = []) {
  if (!profile?.destination) {
    return {
      liveContext: "未提供目的地，无法查询实时地点与天气信息。",
      routeContext: "未提供目的地，无法进行路线规划评估。",
      optionRouteMetrics: [] as OptionRouteMetrics[]
    };
  }

  const destination = profile.destination;

  const hasAmapKey = hasConfiguredAmapKey();

  if (!hasAmapKey) {
    return {
      liveContext: "未配置高德 API Key，当前使用纯模型规划。",
      routeContext: "未配置高德 API Key，无法进行路线规划评估。",
      optionRouteMetrics: [] as OptionRouteMetrics[]
    };
  }

  try {
    const geocode = await geocodeDestination(destination);
    if (!geocode) {
      return {
        liveContext: `未能从高德解析目的地“${destination}”，已回退为通用规划。`,
        routeContext: "目的地解析失败，无法进行路线规划评估。",
        optionRouteMetrics: [] as OptionRouteMetrics[]
      };
    }

    const weatherCandidates = buildWeatherQueryCandidates(destination, geocode);
    const [weatherResult, poisResult] = await Promise.allSettled([
      resolveWeatherContext(weatherCandidates),
      searchPoi(buildPoiKeyword(destination, profile.interests), geocode.city)
    ]);

    const weatherLive =
      weatherResult.status === "fulfilled"
        ? weatherResult.value.live
        : null;
    const weatherForecast =
      weatherResult.status === "fulfilled"
        ? weatherResult.value.forecast
        : [];
    const weatherError =
      weatherResult.status === "fulfilled"
        ? weatherResult.value.error
        : weatherResult.reason instanceof Error
          ? weatherResult.reason
          : new Error("unknown error");
    const weatherQuery =
      weatherResult.status === "fulfilled"
        ? weatherResult.value.query
        : "";
    const pois =
      poisResult.status === "fulfilled"
        ? poisResult.value
        : [];

    const weatherParts: string[] = [];
    if (weatherLive) {
      weatherParts.push(`实况：${weatherLive.weather} ${weatherLive.temperature}°C 湿度${weatherLive.humidity}% ${weatherLive.winddirection}风${weatherLive.windpower}级`);
    }
    if (weatherForecast.length > 0) {
      const forecastText = weatherForecast
        .map((item) => `${item.date} ${item.dayweather} ${item.nighttemp}-${item.daytemp}°C`)
        .join("；");
      weatherParts.push(`预报：${forecastText}`);
    }
    if (weatherQuery) {
      weatherParts.unshift(`查询参数：${weatherQuery}`);
    }
    if (weatherParts.length === 0 && weatherError) {
      weatherParts.push(`未获取到天气信息，原因：${weatherError.message}`);
    }
    const weatherSummary = weatherParts.length > 0 ? weatherParts.join("\n") : "未获取到天气信息。";

    const poiSummary =
      pois.length > 0
        ? pois
            .slice(0, 3)
            .map((poi) => `${poi.name}${poi.address ? `（${poi.address}）` : ""}`)
            .join("、")
        : "未获取到 POI 建议。";

    const liveContext = [
      `高德解析目的地：${geocode.formattedAddress}`,
      `天气参考：${weatherSummary}`,
      `POI 参考：${poiSummary}`
    ].join("\n");

    let routeContext: string;
    let optionRouteMetrics: OptionRouteMetrics[] = [];

    try {
      const routeSamples = pois
        .filter((poi) => poi.location)
        .slice(0, 3);

      const routeMatrix = await collectRouteMatrix(routeSamples, geocode.city);

      const routeSummary = buildRouteSummary(routeSamples, routeMatrix.totalMinutesByMode);

      const optionRouteAssessments = await Promise.all(
        options.map(async (option) => {
          const dailySamples = await collectDailyRouteSamples(destination, geocode.city, option);
          const aggregateLine = assessCongestion(option, routeMatrix.totalMinutesByMode);
          const dailyAssessment = buildOptionDailyAssessment(option, dailySamples);
          return {
            text: [aggregateLine, dailyAssessment].join("\n"),
            metrics: buildOptionRouteMetrics(option, routeMatrix.totalMinutesByMode, dailySamples)
          };
        })
      );

      routeContext =
        options.length > 0
          ? [routeSummary, ...optionRouteAssessments.map((item) => item.text)].join("\n\n")
          : routeSummary;
      optionRouteMetrics = optionRouteAssessments.map((item) => item.metrics);
    } catch (routeError) {
      routeContext = `路线规划评估失败：${routeError instanceof Error ? routeError.message : "unknown error"}`;
    }

    return { liveContext, routeContext, optionRouteMetrics };
  } catch (error) {
    return {
      liveContext: `实时数据查询失败，已回退为通用规划。失败原因：${error instanceof Error ? error.message : "unknown error"}`,
      routeContext: "路线规划评估失败，已忽略路线约束。",
      optionRouteMetrics: [] as OptionRouteMetrics[]
    };
  }
}
