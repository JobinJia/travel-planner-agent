const QWEATHER_API_HOST = process.env.QWEATHER_API_HOST || "https://devapi.qweather.com";

type QWeatherDailyResponse = {
  code: string;
  daily?: Array<{
    fxDate: string;
    textDay: string;
    tempMin: string;
    tempMax: string;
    precip: string;
  }>;
};

async function requestJson<T>(path: string, params: Record<string, string>) {
  const key = process.env.QWEATHER_API_KEY;
  if (!key) {
    return null;
  }

  const url = new URL(path, QWEATHER_API_HOST);
  for (const [param, value] of Object.entries(params)) {
    url.searchParams.set(param, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`
    },
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`QWeather request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getDailyForecast(location: string) {
  const data = await requestJson<QWeatherDailyResponse>("/v7/weather/3d", {
    location
  });

  if (!data || data.code !== "200") {
    return [];
  }

  return data.daily || [];
}
