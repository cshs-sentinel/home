import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { Severity } from '../lib/weather';

const STATUS_ICON: Record<Severity | 'info', string> = { good: '✓', warning: '!', serious: '▲', critical: '⬣', info: 'i' };
const STATUS_WORD: Record<Severity | 'info', string> = { good: 'OK', warning: 'Watch', serious: 'Act soon', critical: 'Act now', info: 'Note' };

export function StatusChip({ severity, label }: { severity: Severity | 'info'; label?: string }) {
  return (
    <span className={`status-chip sev-${severity}`}>
      <span aria-hidden="true">{STATUS_ICON[severity]}</span> {label ?? STATUS_WORD[severity]}
    </span>
  );
}

// A number and its label. A status chip appears only when something needs
// attention, so a calm dashboard stays quiet.
export function StatTile({ label, value, sub, severity }: { label: string; value: string; sub?: string; severity?: Severity }) {
  return (
    <div className={`stat-tile${severity && severity !== 'good' ? ` sev-${severity}` : ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {severity && severity !== 'good' && <StatusChip severity={severity} />}
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// `showTable` comes from one page-level "Show data tables" switch instead of a
// toggle on every chart.
export function ChartCard({ title, subtitle, children, table, showTable = false }: { title: string; subtitle?: string; children: ReactNode; table?: { columns: string[]; rows: (string | number)[][] }; showTable?: boolean }) {
  return (
    <section className="chart-card">
      <header>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
      {showTable && table && table.rows.length > 0 && (
        <div className="table-view">
          <table>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function BarList({ data, unit = '', empty = 'No data in this period.' }: { data: { key: string; label: string; count: number }[]; unit?: string; empty?: string }) {
  if (!data.length) return <p className="empty-note">{empty}</p>;
  const max = Math.max(...data.map((d) => d.count));
  return (
    <ul className="bar-list">
      {data.map((d) => (
        <li key={d.key} tabIndex={0} title={`${d.label}: ${d.count}${unit}`} aria-label={`${d.label}: ${d.count}${unit}`}>
          <span className="bar-label">{d.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, (d.count / max) * 100)}%` }} />
            <span className="bar-value">
              {d.count}
              {unit}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

type Point = { label: string; value: number | null; detail?: string };

const PLOT_H = 150;
const AXIS_H = 26;
const PAD_L = 34;
const PAD_R = 12;
const PAD_T = 12;

function niceMax(max: number): number {
  if (max <= 5) return 5;
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  return Math.ceil(max / step) * step;
}

function ticks(min: number, max: number, integer = false): number[] {
  const mid = min + (max - min) / 2;
  return [...new Set([min, integer ? Math.round(mid) : Math.round(mid * 10) / 10, max])];
}

export function ColumnChart({ data, format = (v) => String(v), yMin = 0, yMax, refLines = [] }: { data: Point[]; format?: (v: number) => string; yMin?: number; yMax?: number; refLines?: { value: number; label: string }[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map((d) => d.value ?? 0);
  const top = yMax ?? niceMax(Math.max(...values, ...refLines.map((r) => r.value), 1));
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.min(24, Math.max(4, band * 0.6));
  const y = (v: number) => PAD_T + PLOT_H - ((v - yMin) / (top - yMin)) * PLOT_H;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)));
  const integer = data.every((d) => d.value === null || Number.isInteger(d.value));

  return (
    <div className="chart-frame" ref={ref}>
      {width > 0 && (
        <svg width={width} height={PAD_T + PLOT_H + AXIS_H} role="img" aria-label="Column chart">
          {ticks(yMin, top, integer).map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} />
              <text className="axis-text" x={PAD_L - 6} y={y(t) + 4} textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {refLines.map((r) => (
            <g key={r.label}>
              <line className="ref-line" x1={PAD_L} x2={width - PAD_R} y1={y(r.value)} y2={y(r.value)} />
              <text className="ref-text" x={width - PAD_R} y={y(r.value) - 4} textAnchor="end">
                {r.label}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD_L + i * band + (band - barW) / 2;
            const v = d.value;
            const h = v === null ? 0 : Math.max(1, y(yMin) - y(v));
            return (
              <g
                key={d.label}
                tabIndex={0}
                aria-label={`${d.label}: ${v === null ? 'no data' : format(v)}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <rect className="hit" x={PAD_L + i * band} y={PAD_T} width={band} height={PLOT_H} />
                {v !== null && <path className={`col${hover === i ? ' is-hover' : ''}`} d={roundedTop(x, y(yMin) - h, barW, h)} />}
                {i % labelEvery === 0 && (
                  <text className="axis-text" x={PAD_L + i * band + band / 2} y={PAD_T + PLOT_H + 18} textAnchor="middle">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
          <line className="baseline" x1={PAD_L} x2={width - PAD_R} y1={y(yMin)} y2={y(yMin)} />
        </svg>
      )}
      {hover !== null && data[hover] && width > 0 && (
        <Tooltip x={PAD_L + hover * band + band / 2} width={width}>
          <strong>{data[hover].value === null ? 'No data' : format(data[hover].value!)}</strong>
          <span>{data[hover].detail ?? data[hover].label}</span>
        </Tooltip>
      )}
    </div>
  );
}

export function LineChart({ data, format = (v) => v.toFixed(1), yMin, yMax }: { data: Point[]; format?: (v: number) => string; yMin: number; yMax: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  const x = (i: number) => PAD_L + i * step;
  const y = (v: number) => PAD_T + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)));

  const segments: string[] = [];
  let current = '';
  data.forEach((d, i) => {
    if (d.value === null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${x(i)},${y(d.value)}`;
  });
  if (current) segments.push(current);

  function onMove(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - box.left - step / 2) / Math.max(step, 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  }

  return (
    <div className="chart-frame" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={PAD_T + PLOT_H + AXIS_H}
          role="img"
          aria-label="Line chart"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setHover((h) => Math.min(data.length - 1, (h ?? -1) + 1));
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? data.length) - 1));
          }}
          onBlur={() => setHover(null)}
        >
          {ticks(yMin, yMax).map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} />
              <text className="axis-text" x={PAD_L - 6} y={y(t) + 4} textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.label} className="axis-text" x={x(i)} y={PAD_T + PLOT_H + 18} textAnchor="middle">
                {d.label}
              </text>
            ) : null,
          )}
          {segments.map((s) => (
            <path key={s} className="line" d={s} />
          ))}
          {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + PLOT_H} />}
          {data.map((d, i) =>
            d.value !== null && (i === data.length - 1 || hover === i || data[i - 1]?.value === null || data[i + 1]?.value === null) ? (
              <circle key={d.label} className="dot" cx={x(i)} cy={y(d.value)} r={4} />
            ) : null,
          )}
          <rect className="hit" x={PAD_L - step / 2} y={PAD_T} width={plotW + step} height={PLOT_H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hover !== null && data[hover] && width > 0 && (
        <Tooltip x={x(hover)} width={width}>
          <strong>{data[hover].value === null ? 'No data' : format(data[hover].value!)}</strong>
          <span>{data[hover].detail ?? data[hover].label}</span>
        </Tooltip>
      )}
    </div>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div className="chart-tooltip" style={{ left }} role="status">
      {children}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
