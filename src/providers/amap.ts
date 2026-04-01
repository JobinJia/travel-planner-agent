const AMAP_BASE_URL = "https://restapi.amap.com";

function getAmapApiKey() {
  const key = process.env.AMAP_API_KEY?.trim();
  if (!key || key === "your_amap_api_key") {
    return null;
  }

  return key;
}

type AmapGeocodeResponse = {
  status: string;
  info?: string;
  infocode?: string;
  geocodes?: Array<{
    formatted_address?: string;
    location?: string;
    adcode?: string;
    province?: string;
    city?: string | string[];
    district?: string | string[];
  }>;
};

type AmapPoiResponse = {
  status: string;
  info?: string;
  infocode?: string;
  pois?: Array<{
    id?: string;
    name?: string;
    type?: string;
    address?: string;
    location?: string;
  }>;
};

type AmapDrivingRouteResponse = {
  status: string;
  info?: string;
  infocode?: string;
  route?: {
    paths?: Array<{
      distance?: string;
      duration?: string;
    }>;
  };
};

type AmapWalkingRouteResponse = {
  status: string;
  info?: string;
  infocode?: string;
  route?: {
    paths?: Array<{
      distance?: string;
      duration?: string;
    }>;
  };
};

type AmapTransitRouteResponse = {
  status: string;
  info?: string;
  infocode?: string;
  route?: {
    transits?: Array<{
      duration?: string;
      walking_distance?: string;
      distance?: string;
    }>;
  };
};

type AmapWeatherLiveResponse = {
  status: string;
  info?: string;
  infocode?: string;
  lives?: Array<{
    province: string;
    city: string;
    weather: string;
    temperature: string;
    winddirection: string;
    windpower: string;
    humidity: string;
    reporttime: string;
  }>;
};

type AmapWeatherForecastResponse = {
  status: string;
  info?: string;
  infocode?: string;
  forecasts?: Array<{
    province: string;
    city: string;
    casts: Array<{
      date: string;
      dayweather: string;
      nightweather: string;
      daytemp: string;
      nighttemp: string;
      daywind: string;
      daypower: string;
    }>;
  }>;
};

export type AmapWeatherLive = {
  city: string;
  weather: string;
  temperature: string;
  humidity: string;
  winddirection: string;
  windpower: string;
  reporttime: string;
};

export type AmapWeatherForecast = {
  date: string;
  dayweather: string;
  nightweather: string;
  daytemp: string;
  nighttemp: string;
};

export type RouteMode = "walking" | "driving" | "transit";
export type RouteSummary = {
  mode: RouteMode;
  distanceMeters: number;
  durationSeconds: number;
  walkingDistanceMeters?: number;
};

async function requestJson<T>(path: string, params: Record<string, string>) {
  const key = getAmapApiKey();
  if (!key) {
    return null;
  }

  const url = new URL(path, AMAP_BASE_URL);
  for (const [param, value] of Object.entries(params)) {
    url.searchParams.set(param, value);
  }
  url.searchParams.set("key", key);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`AMap request failed: ${response.status}`);
  }

  const data = await response.json() as T & {
    status?: string;
    info?: string;
    infocode?: string;
  };

  if (data && typeof data === "object" && data.status && data.status !== "1") {
    const info = data.info || "unknown error";
    const infocode = data.infocode ? ` (${data.infocode})` : "";
    throw new Error(`AMap API error: ${info}${infocode}`);
  }

  return data;
}

function normalizeLocationText(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).find(Boolean);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

export async function geocodeDestination(address: string) {
  const data = await requestJson<AmapGeocodeResponse>("/v3/geocode/geo", {
    address
  });

  if (!data || data.status !== "1" || !data.geocodes?.[0]?.location) {
    return null;
  }

  const item = data.geocodes[0];
  return {
    formattedAddress: item.formatted_address || address,
    location: item.location,
    adcode: item.adcode,
    province: normalizeLocationText(item.province),
    city: normalizeLocationText(item.city),
    district: normalizeLocationText(item.district)
  } as {
    formattedAddress: string;
    location: string;
    adcode?: string;
    province?: string;
    city?: string;
    district?: string;
  };
}

export async function searchPoi(keyword: string, city?: string) {
  const data = await requestJson<AmapPoiResponse>("/v5/place/text", {
    keywords: keyword,
    page_size: "5",
    city: city || ""
  });

  if (!data || data.status !== "1") {
    return [];
  }

  return (data.pois || []).map((poi) => ({
    id: poi.id || "",
    name: poi.name || keyword,
    type: poi.type || "",
    address: poi.address || "",
    location: poi.location || ""
  }));
}

export async function searchNearbyPoi(
  location: string,
  keyword: string,
  radiusMeters = 1000,
  city?: string
) {
  const data = await requestJson<AmapPoiResponse>("/v5/place/around", {
    location,
    keywords: keyword,
    radius: String(radiusMeters),
    page_size: "10",
    city: city || ""
  });

  if (!data || data.status !== "1") {
    return [];
  }

  return (data.pois || []).map((poi) => ({
    id: poi.id || "",
    name: poi.name || keyword,
    type: poi.type || "",
    address: poi.address || "",
    location: poi.location || ""
  }));
}

export async function getDrivingRoute(origin: string, destination: string) {
  const data = await requestJson<AmapDrivingRouteResponse>("/v3/direction/driving", {
    origin,
    destination
  });

  const path = data?.status === "1" ? data.route?.paths?.[0] : undefined;
  if (!path?.distance || !path.duration) {
    return null;
  }

  return {
    mode: "driving" as const,
    distanceMeters: Number(path.distance),
    durationSeconds: Number(path.duration)
  };
}

export async function getWalkingRoute(origin: string, destination: string) {
  const data = await requestJson<AmapWalkingRouteResponse>("/v3/direction/walking", {
    origin,
    destination
  });

  const path = data?.status === "1" ? data.route?.paths?.[0] : undefined;
  if (!path?.distance || !path.duration) {
    return null;
  }

  return {
    mode: "walking" as const,
    distanceMeters: Number(path.distance),
    durationSeconds: Number(path.duration)
  };
}

export async function getTransitRoute(origin: string, destination: string, city?: string) {
  const data = await requestJson<AmapTransitRouteResponse>("/v3/direction/transit/integrated", {
    origin,
    destination,
    city: city || ""
  });

  const transit = data?.status === "1" ? data.route?.transits?.[0] : undefined;
  if (!transit?.duration) {
    return null;
  }

  return {
    mode: "transit" as const,
    distanceMeters: Number(transit.distance || 0),
    durationSeconds: Number(transit.duration),
    walkingDistanceMeters: Number(transit.walking_distance || 0)
  };
}

export async function getWeatherLive(cityQuery: string): Promise<AmapWeatherLive | null> {
  const data = await requestJson<AmapWeatherLiveResponse>("/v3/weather/weatherInfo", {
    city: cityQuery,
    extensions: "base"
  });

  if (!data || data.status !== "1" || !data.lives?.[0]) {
    return null;
  }

  const live = data.lives[0];
  return {
    city: live.city,
    weather: live.weather,
    temperature: live.temperature,
    humidity: live.humidity,
    winddirection: live.winddirection,
    windpower: live.windpower,
    reporttime: live.reporttime
  };
}

export async function getWeatherForecast(cityQuery: string): Promise<AmapWeatherForecast[]> {
  const data = await requestJson<AmapWeatherForecastResponse>("/v3/weather/weatherInfo", {
    city: cityQuery,
    extensions: "all"
  });

  if (!data || data.status !== "1" || !data.forecasts?.[0]?.casts) {
    return [];
  }

  return data.forecasts[0].casts.map((cast) => ({
    date: cast.date,
    dayweather: cast.dayweather,
    nightweather: cast.nightweather,
    daytemp: cast.daytemp,
    nighttemp: cast.nighttemp
  }));
}
