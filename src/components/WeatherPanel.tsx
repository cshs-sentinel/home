import { heatLevel, type Quake, type WeatherSnapshot } from '../lib/weather';
import { formatHour } from '../lib/analytics';
import { ChartCard, ColumnChart, StatusChip } from './Charts';

export function WeatherPanel({ weather, quakes, error, compact = false }: { weather: WeatherSnapshot | null; quakes: Quake[]; error: string; compact?: boolean }) {
  if (error && !weather) return <p className="empty-note">{error}</p>;
  if (!weather) return <p className="empty-note">Loading weather…</p>;

  const nowLevel = heatLevel(weather.now.heatIndex);
  const peakLevel = heatLevel(weather.peakToday.heatIndex);
  const rain24 = weather.next24.reduce((sum, h) => sum + h.rainMm, 0);
  const rainChance = Math.max(0, ...weather.next24.map((h) => h.rainChance));
  const nearbyQuakes = quakes.filter((q) => q.magnitude >= 4);
  const days = weather.days.slice(-14);

  return (
    <section className="weather-panel">
      <div className="weather-head">
        <div>
          <p className="eyebrow">OUTSIDE NOW · {weather.coords.label.toUpperCase()}</p>
          <div className="weather-now">
            <strong>{Math.round(weather.now.heatIndex)}°C</strong>
            <span>feels like (heat index)</span>
          </div>
          <StatusChip severity={nowLevel.severity} label={nowLevel.label} />
          <p className="weather-advice">{nowLevel.advice}</p>
        </div>
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
      </div>
      {!compact && (
        <ChartCard
          title="Daily peak heat index"
          subtitle="Last 14 days. Lines mark PAGASA Extreme caution (33°C) and Danger (42°C)."
          table={{ columns: ['Day', 'Peak heat index', 'Level', 'Rain'], rows: days.map((d) => [d.date, `${d.maxHeatIndex.toFixed(1)}°C`, heatLevel(d.maxHeatIndex).label, `${d.rainMm.toFixed(1)} mm`]) }}
        >
          <ColumnChart
            data={days.map((d) => ({ label: shortDay(d.date), value: Math.round(d.maxHeatIndex * 10) / 10, detail: `${shortDay(d.date)} · ${heatLevel(d.maxHeatIndex).label}` }))}
            format={(v) => `${Math.round(v)}°`}
            yMin={20}
            yMax={Math.max(50, ...days.map((d) => Math.ceil(d.maxHeatIndex / 5) * 5))}
            refLines={[
              { value: 33, label: 'Extreme caution 33°' },
              { value: 42, label: 'Danger 42°' },
            ]}
          />
        </ChartCard>
      )}
      {weather.coords.isDefault && (
        <p className="fine-print">Using Manila as the school location. Set VITE_SCHOOL_LAT and VITE_SCHOOL_LON for exact readings. Data: Open-Meteo and USGS.</p>
      )}
    </section>
  );
}

export function shortDay(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
