export type Coordinates = { latitude: number; longitude: number; isDefault: boolean; label: string };

const DEFAULT_COORDS = { latitude: 14.5995, longitude: 120.9842, label: 'Manila (default)' };

export function schoolCoordinates(): Coordinates {
  const lat = Number(import.meta.env.VITE_SCHOOL_LAT);
  const lon = Number(import.meta.env.VITE_SCHOOL_LON);
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
    return { latitude: lat, longitude: lon, isDefault: false, label: import.meta.env.VITE_SCHOOL_PLACE || 'School location' };
  }
  return { ...DEFAULT_COORDS, isDefault: true };
}

// NWS heat index (Rothfusz regression with the standard adjustments). Input and
// output in Celsius. Below ~27°C the regression is not meaningful, so the
// Steadman simple form is used, as in the database's heat_index_method values.
export function heatIndexC(tempC: number, humidity: number): { value: number; method: 'rothfusz' | 'simple' } {
  const t = (tempC * 9) / 5 + 32;
  const rh = humidity;
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if ((simple + t) / 2 < 80) {
    return { value: ((simple - 32) * 5) / 9, method: 'simple' };
  }
  let hi =
    -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t -
    0.05481717 * rh * rh + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;
  if (rh < 13 && t >= 80 && t <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  if (rh > 85 && t >= 80 && t <= 87) hi += ((rh - 85) / 10) * ((87 - t) / 5);
  return { value: ((hi - 32) * 5) / 9, method: 'rothfusz' };
}

export type Severity = 'good' | 'warning' | 'serious' | 'critical';

// PAGASA heat index classification.
export function heatLevel(hiC: number): { severity: Severity; label: string; advice: string } {
  if (hiC >= 52) return { severity: 'critical', label: 'Extreme danger', advice: 'Heat stroke is likely. Suspend outdoor activities.' };
  if (hiC >= 42) return { severity: 'critical', label: 'Danger', advice: 'Heat cramps and exhaustion likely. Move activities indoors.' };
  if (hiC >= 33) return { severity: 'serious', label: 'Extreme caution', advice: 'Limit outdoor time, schedule water breaks.' };
  if (hiC >= 27) return { severity: 'warning', label: 'Caution', advice: 'Fatigue is possible with long exposure. Stay hydrated.' };
  return { severity: 'good', label: 'Comfortable', advice: 'No heat precautions needed.' };
}

export type HourPoint = { time: Date; tempC: number; humidity: number; heatIndex: number; rainMm: number; rainChance: number; gustKmh: number; code: number };
export type DayPoint = { date: string; maxHeatIndex: number; rainMm: number };

export type WeatherSnapshot = {
  coords: Coordinates;
  now: HourPoint;
  next24: HourPoint[];
  days: DayPoint[];
  peakToday: HourPoint;
  heavyRainHours: number;
  thunderstormAhead: boolean;
  maxGustKmh: number;
};

type OpenMeteoResponse = {
  current: { time: string; temperature_2m: number; relative_humidity_2m: number; precipitation: number; weather_code: number; wind_gusts_10m: number };
  hourly: {
    time: string[];
    temperature_2m: number[];
    relative_humidity_2m: number[];
    precipitation: number[];
    precipitation_probability: (number | null)[];
    weather_code: number[];
    wind_gusts_10m: number[];
  };
};

export async function fetchWeather(coords: Coordinates, signal?: AbortSignal): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_gusts_10m',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,weather_code,wind_gusts_10m',
    past_days: '14',
    forecast_days: '2',
    timezone: 'auto',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  const data = (await res.json()) as OpenMeteoResponse;

  const hours: HourPoint[] = data.hourly.time.map((t, i) => {
    const tempC = data.hourly.temperature_2m[i];
    const humidity = data.hourly.relative_humidity_2m[i];
    return {
      time: new Date(t),
      tempC,
      humidity,
      heatIndex: heatIndexC(tempC, humidity).value,
      rainMm: data.hourly.precipitation[i] ?? 0,
      rainChance: data.hourly.precipitation_probability[i] ?? 0,
      gustKmh: data.hourly.wind_gusts_10m[i] ?? 0,
      code: data.hourly.weather_code[i] ?? 0,
    };
  });

  const nowTime = new Date(data.current.time);
  const now: HourPoint = {
    time: nowTime,
    tempC: data.current.temperature_2m,
    humidity: data.current.relative_humidity_2m,
    heatIndex: heatIndexC(data.current.temperature_2m, data.current.relative_humidity_2m).value,
    rainMm: data.current.precipitation,
    rainChance: 0,
    gustKmh: data.current.wind_gusts_10m,
    code: data.current.weather_code,
  };

  const next24 = hours.filter((h) => h.time >= nowTime && h.time.getTime() < nowTime.getTime() + 24 * 3600_000);
  const todayKey = data.current.time.slice(0, 10);
  const today = hours.filter((h) => dayKey(h.time) === todayKey);
  const peakToday = today.reduce((a, b) => (b.heatIndex > a.heatIndex ? b : a), today[0] ?? now);

  const byDay = new Map<string, DayPoint>();
  for (const h of hours) {
    const key = dayKey(h.time);
    if (key > todayKey) continue;
    const day = byDay.get(key) ?? { date: key, maxHeatIndex: -Infinity, rainMm: 0 };
    day.maxHeatIndex = Math.max(day.maxHeatIndex, h.heatIndex);
    day.rainMm += h.rainMm;
    byDay.set(key, day);
  }

  return {
    coords,
    now,
    next24,
    days: [...byDay.values()],
    peakToday,
    heavyRainHours: next24.filter((h) => h.rainMm >= 7.5).length,
    thunderstormAhead: next24.some((h) => h.code >= 95),
    maxGustKmh: Math.max(now.gustKmh, ...next24.map((h) => h.gustKmh)),
  };
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type Quake = { id: string; magnitude: number; place: string; time: Date; distanceKm: number };

export async function fetchEarthquakes(coords: Coordinates, signal?: AbortSignal): Promise<Quake[]> {
  const start = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const params = new URLSearchParams({
    format: 'geojson',
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    maxradiuskm: '300',
    minmagnitude: '4',
    starttime: start,
    orderby: 'time',
  });
  const res = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`, { signal });
  if (!res.ok) throw new Error(`Earthquake service returned ${res.status}`);
  const data = (await res.json()) as {
    features: { id: string; properties: { mag: number; place: string; time: number }; geometry: { coordinates: [number, number] } }[];
  };
  return data.features.map((f) => ({
    id: f.id,
    magnitude: f.properties.mag,
    place: f.properties.place,
    time: new Date(f.properties.time),
    distanceKm: distanceKm(coords.latitude, coords.longitude, f.geometry.coordinates[1], f.geometry.coordinates[0]),
  }));
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
