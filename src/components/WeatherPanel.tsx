import { heatLevel, type Quake, type WeatherSnapshot } from '../lib/weather';
import { formatHour } from '../lib/analytics';
import { StatusChip } from './Charts';

// Heat right now and what to do about it; the rest of the readings sit behind
// "More details".
export function WeatherPanel({ weather, quakes, error }: { weather: WeatherSnapshot | null; quakes: Quake[]; error: string }) {
  if (error && !weather) return <p className="empty-note">{error}</p>;
  if (!weather) return <p className="empty-note">Loading weather…</p>;

  const nowLevel = heatLevel(weather.now.heatIndex);
  const peakLevel = heatLevel(weather.peakToday.heatIndex);
  const rain24 = weather.next24.reduce((sum, h) => sum + h.rainMm, 0);
  const rainChance = Math.max(0, ...weather.next24.map((h) => h.rainChance));
  const nearbyQuakes = quakes.filter((q) => q.magnitude >= 4);

  return (
    <section className="card weather-panel">
      <div className="weather-now">
        <strong>{Math.round(weather.now.heatIndex)}°C</strong>
        <span>
          feels like outside · {weather.coords.label}
        </span>
        <StatusChip severity={nowLevel.severity} label={nowLevel.label} />
      </div>
      <p className="weather-advice">{nowLevel.advice}</p>
      <details className="disclosure">
        <summary>More details</summary>
        <dl className="weather-facts">
          <div>
            <dt>Air temp</dt>
            <dd>{Math.round(weather.now.tempC)}°C</dd>
          </div>
          <div>
            <dt>Humidity</dt>
            <dd>{Math.round(weather.now.humidity)}%</dd>
          </div>
          <div>
            <dt>Peak today</dt>
            <dd>
              {Math.round(weather.peakToday.heatIndex)}°C · {formatHour(weather.peakToday.time)}
              <small>{peakLevel.label}</small>
            </dd>
          </div>
          <div>
            <dt>Rain next 24h</dt>
            <dd>
              {rain24.toFixed(1)} mm<small>{rainChance}% max chance</small>
            </dd>
          </div>
          <div>
            <dt>Wind gusts</dt>
            <dd>{Math.round(weather.maxGustKmh)} km/h</dd>
          </div>
          <div>
            <dt>Earthquakes 7d</dt>
            <dd>
              {nearbyQuakes.length ? `${nearbyQuakes.length} · max M${Math.max(...nearbyQuakes.map((q) => q.magnitude)).toFixed(1)}` : 'None ≥ M4'}
              <small>within 300 km</small>
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

export function shortDay(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
