export type CurrentWeather = {
  location: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPercent: number;
  condition: string;
  weatherCode: number;
  windKmh: number;
  windDirectionDegrees: number;
  precipitationMm: number;
  highC: number;
  lowC: number;
  precipitationProbabilityPercent: number | null;
  observedAt: string;
  fetchedAt: string;
  source: "Open-Meteo";
};

type GeocodingResult = {
  name?: string;
  country?: string;
  country_code?: string;
  admin1?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
};

type GeocodingResponse = { results?: GeocodingResult[] };
type ForecastResponse = {
  current?: Record<string, string | number | null>;
  daily?: Record<string, Array<string | number | null> | undefined>;
};

const weatherCache = new Map<
  string,
  { expiresAt: number; value: CurrentWeather }
>();
const CACHE_MS = 12 * 60_000;

export function isWeatherRequest(text: string) {
  return /\b(?:wetter(?:bericht)?|weather|forecast|temperatur(?:en)?|temperature|regn\w*|rain\w*|niederschlag|schnee\w*|snow\w*|wind(?:geschwindigkeit)?|sonnig|bewölkt)\b/i.test(
    text,
  );
}

export function extractWeatherLocation(text: string) {
  const segments = text.slice(0, 12_000).split(/[.!?\n]+/);
  for (const segment of segments) {
    const match =
      /\b(?:wetter(?:bericht)?|weather|forecast|temperatur(?:en)?|temperature|regn\w*|rain\w*|niederschlag|schnee\w*|snow\w*|wind(?:geschwindigkeit)?)\b[\s\S]{0,100}?\b(?:in|für|bei|at|for)\s+([^,;!?\.]{2,100}(?:,\s*[^;!?\.]{2,50})?)/i.exec(
        segment,
      );
    if (!match) continue;
    const location = match[1]
      .replace(
        /\s+(?:und|sowie)\s+(?:aktuelle?|heutige?|gestern|morgen|ki-|nachrichten|news).+$/i,
        "",
      )
      .replace(
        /\s+(?:bitte|heute|morgen|aktuell|aktuelle|aktuellen|dann)\b.*$/i,
        "",
      )
      .trim()
      .replace(/^[\s,]+|[\s,]+$/g, "");
    if (location.length >= 2 && location.length <= 80) return location;
  }
  return "";
}

function numeric(value: string | number | null | undefined, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rounded(value: string | number | null | undefined) {
  return Math.round(numeric(value) * 10) / 10;
}

function describeWeather(code: number, isDay: number) {
  if (code === 0) return isDay ? "Klar" : "Klare Nacht";
  if (code === 1) return "Überwiegend klar";
  if (code === 2) return "Teilweise bewölkt";
  if (code === 3) return "Bedeckt";
  if (code === 45 || code === 48) return "Neblig";
  if ([51, 53, 55, 56, 57].includes(code)) return "Nieselregen";
  if ([61, 63, 65, 66, 67].includes(code)) return "Regen";
  if ([71, 73, 75, 77].includes(code)) return "Schnee";
  if ([80, 81, 82].includes(code)) return "Regenschauer";
  if ([85, 86].includes(code)) return "Schneeschauer";
  if ([95, 96, 99].includes(code)) return "Gewitter";
  return "Wetterdaten verfügbar";
}

async function getJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Nexar-Bots/1.0 (weather widget)",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(`Wetterdienst antwortet mit HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function countryHint(timeZone: string) {
  if (timeZone === "Europe/Vienna") return "AT";
  if (timeZone === "Europe/Berlin") return "DE";
  if (timeZone === "Europe/Zurich") return "CH";
  return "";
}

async function geocode(place: string, timeZone: string) {
  const variants = [
    place,
    place.replace(/\s+(?:bei|near|in der nähe von)\s+.+$/i, "").trim(),
  ].filter(
    (value, index, all) => value.length >= 2 && all.indexOf(value) === index,
  );
  for (const variant of variants) {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({
      name: variant,
      count: "10",
      language: "de",
      format: "json",
    }).toString();
    const response = await getJson<GeocodingResponse>(url);
    const results = response.results || [];
    if (!results.length) continue;
    const hint = countryHint(timeZone);
    return results.find((item) => item.country_code === hint) || results[0];
  }
  throw new Error(`Ort „${place}“ wurde nicht gefunden`);
}

export async function fetchCurrentWeather(
  place: string,
  timeZone = "Europe/Vienna",
): Promise<CurrentWeather> {
  const normalizedPlace = place.trim().slice(0, 80);
  if (normalizedPlace.length < 2)
    throw new Error("Für das Wetter-Widget fehlt ein Ort");
  const cacheKey = `${normalizedPlace.toLocaleLowerCase("de-DE")}|${timeZone}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const location = await geocode(normalizedPlace, timeZone);
  if (
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude)
  ) {
    throw new Error(`Koordinaten für „${normalizedPlace}“ fehlen`);
  }
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: "1",
    timezone: location.timezone || timeZone || "auto",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
  }).toString();
  const forecast = await getJson<ForecastResponse>(url);
  const current = forecast.current || {};
  const daily = forecast.daily || {};
  const code = numeric(current.weather_code, -1);
  if (code < 0)
    throw new Error(
      "Der Wetterdienst hat keine aktuellen Bedingungen zurückgegeben",
    );
  const admin =
    location.admin1 && location.admin1 !== location.name
      ? `, ${location.admin1}`
      : "";
  const snapshot: CurrentWeather = {
    location: `${location.name || normalizedPlace}${admin}`,
    country: location.country || "",
    latitude: location.latitude!,
    longitude: location.longitude!,
    timezone: location.timezone || timeZone,
    temperatureC: rounded(current.temperature_2m),
    feelsLikeC: rounded(current.apparent_temperature),
    humidityPercent: Math.round(numeric(current.relative_humidity_2m)),
    condition: describeWeather(code, numeric(current.is_day, 1)),
    weatherCode: code,
    windKmh: rounded(current.wind_speed_10m),
    windDirectionDegrees: Math.round(numeric(current.wind_direction_10m)),
    precipitationMm: rounded(current.precipitation),
    highC: rounded(daily.temperature_2m_max?.[0]),
    lowC: rounded(daily.temperature_2m_min?.[0]),
    precipitationProbabilityPercent:
      daily.precipitation_probability_max?.[0] == null
        ? null
        : Math.round(numeric(daily.precipitation_probability_max[0])),
    observedAt: String(current.time || new Date().toISOString()),
    fetchedAt: new Date().toISOString(),
    source: "Open-Meteo",
  };
  weatherCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_MS,
    value: snapshot,
  });
  return snapshot;
}
