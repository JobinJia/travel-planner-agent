const AMAP_BASE_URL = "https://restapi.amap.com";

type AmapGeocodeResponse = {
  status: string;
  info?: string;
  geocodes?: Array<{
    formatted_address?: string;
    location?: string;
    adcode?: string;
    city?: string | string[];
    district?: string;
  }>;
};

type AmapPoiResponse = {
  status: string;
  info?: string;
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
  route?: {
    transits?: Array<{
      duration?: string;
      walking_distance?: string;
      distance?: string;
    }>;
  };
};

export type RouteMode = "walking" | "driving" | "transit";
export type RouteSummary = {
  mode: RouteMode;
  distanceMeters: number;
  durationSeconds: number;
  walkingDistanceMeters?: number;
};

async function requestJson<T>(path: string, params: Record<string, string>) {
  const key = process.env.AMAP_API_KEY;
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

  return response.json() as Promise<T>;
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
    city: Array.isArray(item.city) ? item.city.join(",") : item.city,
    district: item.district
  } as {
    formattedAddress: string;
    location: string;
    adcode?: string;
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
