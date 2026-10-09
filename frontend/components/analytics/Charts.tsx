"use client";
import { CategorySpend, NutritionPoint, SpendingPoint, euro } from "@/lib/analytics";


export function SpendingChart({ data }: { data: SpendingPoint[] }) {
  if (data.length === 0) return <p className="text-muted small">Geen bestellingen gevonden.</p>;
  const max = Math.max(...data.map(d => d.total_spent), 1);
  const W = 600, H = 160;
  const PAD = { top: 12, right: 12, bottom: 30, left: 52 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;
  const barW = Math.max(4, iW / data.length - 3);
  const toX = (i: number) => PAD.left + (i + 0.5) * (iW / data.length);
  const toY = (v: number) => PAD.top + iH - (v / max) * iH;
  const yTicks = [0, max * 0.5, max].map(v => ({ v, y: toY(v) }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 180, display: "block" }}>
      {yTicks.map(({ v, y }, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#dee2e6" strokeWidth={0.5} />
          <text x={PAD.left - 4} y={y + 3} fontSize={8} fill="#adb5bd" textAnchor="end">{euro(v)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = toX(i);
        const barH = (d.total_spent / max) * iH;
        const y = PAD.top + iH - barH;
        return (
          <g key={i}>
            <rect x={x - barW / 2} y={y} width={barW} height={barH} fill="#003d9b" rx={2} opacity={0.8} />
            <text x={x} y={H - PAD.bottom + 10} fontSize={7} fill="#6c757d" textAnchor="middle">
              {d.label.length > 8 ? d.label.slice(0, 7) + "…" : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function TrendLine({ data, field }: { data: SpendingPoint[]; field: "total_spent" | "avg_per_order" }) {
  if (data.length < 2) return null;
  const vals = data.map(d => d[field]);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals);
  const range = max - min || 1;
  const W = 600, H = 80;
  const PAD = { top: 8, right: 8, bottom: 8, left: 44 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;
  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * iW;
  const toY = (v: number) => PAD.top + ((max - v) / range) * iH;
  const pts = vals.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const n = vals.length;
  const sumX = vals.reduce((s, _, i) => s + i, 0);
  const sumY = vals.reduce((s, v) => s + v, 0);
  const sumXY = vals.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = vals.reduce((s, _, i) => s + i * i, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const trendPts = [0, n - 1].map(i => `${toX(i)},${toY(intercept + slope * i)}`).join(" ");
  const trendUp = slope > 0;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 90, display: "block" }}>
        <line x1={PAD.left} y1={toY(min)} x2={W - PAD.right} y2={toY(min)} stroke="#dee2e6" strokeWidth={0.5} />
        <line x1={PAD.left} y1={toY(max)} x2={W - PAD.right} y2={toY(max)} stroke="#dee2e6" strokeWidth={0.5} />
        <text x={PAD.left - 3} y={toY(min) + 3} fontSize={7} fill="#adb5bd" textAnchor="end">{euro(min)}</text>
        <text x={PAD.left - 3} y={toY(max) + 3} fontSize={7} fill="#adb5bd" textAnchor="end">{euro(max)}</text>
        <polyline points={pts} fill="none" stroke="#003d9b" strokeWidth={2} />
        <polyline points={trendPts} fill="none" stroke={trendUp ? "#dc3545" : "#198754"} strokeWidth={1} strokeDasharray="4,2" />
      </svg>
      <div className="small text-muted mt-1">
        Trend: <span className={trendUp ? "text-danger" : "text-success"}>
          {trendUp ? "↑ Stijgend" : "↓ Dalend"}
        </span>{" "}({euro(Math.abs(slope))} per periode)
      </div>
    </div>
  );
}

export function NutritionLineChart({ data, field, color }: {
  data: NutritionPoint[]; field: keyof NutritionPoint; color: string;
}) {
  const vals = data.map(d => d[field] as number | null);
  const validVals = vals.filter((v): v is number => v !== null && v > 0);
  if (validVals.length < 2) return null;
  const max = Math.max(...validVals, 1);
  const min = Math.min(...validVals);
  const range = max - min || 1;
  const W = 600, H = 60;
  const PAD = { top: 6, right: 8, bottom: 6, left: 48 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;
  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * iW;
  const toY = (v: number) => PAD.top + ((max - v) / range) * iH;
  const pts = vals
    .map((v, i) => v !== null && v > 0 ? `${toX(i)},${toY(v)}` : null)
    .filter(Boolean)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 70, display: "block" }}>
      <text x={PAD.left - 3} y={PAD.top + 4} fontSize={7} fill="#adb5bd" textAnchor="end">{Math.round(max)}</text>
      <text x={PAD.left - 3} y={H - PAD.bottom + 1} fontSize={7} fill="#adb5bd" textAnchor="end">{Math.round(min)}</text>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {vals.map((v, i) => v !== null && v > 0 ? (
        <circle key={i} cx={toX(i)} cy={toY(v)} r={2.5} fill={color} />
      ) : null)}
    </svg>
  );
}

export function NutritionBar({ label, value, max, unit, color }: {
  label: string; value: number | null; max: number; unit: string; color: string;
}) {
  if (value == null) return null;
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="mb-2">
      <div className="d-flex justify-content-between small mb-1">
        <span>{label}</span>
        <span className="text-muted">{value.toFixed(1)}{unit}</span>
      </div>
      <div style={{ height: 8, background: "#e9ecef", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
}

export function CategoryChart({ data }: { data: CategorySpend[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map(d => d.total_spent), 1);
  const colors = ["#003d9b", "#198754", "#fd7e14", "#dc3545", "#6f42c1", "#20c997", "#ffc107", "#0dcaf0", "#6c757d"];
  return (
    <div>
      {data.map((d, i) => {
        const pct = (d.total_spent / max) * 100;
        return (
          <div key={i} className="mb-2">
            <div className="d-flex justify-content-between small mb-1">
              <span className="text-truncate" style={{ maxWidth: "55%" }}>{d.category}</span>
              <span className="d-flex gap-2 align-items-center">
                {d.total_savings > 0 && (
                  <span className="text-success" title="Bespaard via bonus">−{euro(d.total_savings)}</span>
                )}
                <span className="text-muted">{euro(d.total_spent)}</span>
              </span>
            </div>
            <div style={{ height: 10, background: "#e9ecef", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: colors[i % colors.length], borderRadius: 4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

