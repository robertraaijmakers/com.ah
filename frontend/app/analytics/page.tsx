"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import useSWR from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import Tab from "react-bootstrap/Tab";
import Tabs from "react-bootstrap/Tabs";
import { api } from "@/lib/api";

type Period = "week" | "month" | "year" | "season";
type Range = "1m" | "3m" | "6m" | "ytd" | "last-year" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  week: "Week",
  month: "Maand",
  year: "Jaar",
  season: "Seizoen",
};

const RANGE_LABELS: Record<Range, string> = {
  "1m": "1 maand",
  "3m": "3 maanden",
  "6m": "6 mnd",
  ytd: "Dit jaar",
  "last-year": "Vorig jaar",
  all: "Alles",
};

interface SpendingPoint {
  label: string;
  period_start?: string;
  order_count: number;
  total_spent: number;
  avg_per_order: number;
}

interface NutritionPoint {
  label: string;
  period_start?: string;
  order_count: number;
  avg_kcal: number | null;
  avg_protein: number | null;
  avg_fat: number | null;
  avg_carbs: number | null;
  avg_sat_fat: number | null;
  avg_sugars: number | null;
  avg_fiber: number | null;
  avg_salt: number | null;
  total_kcal: number | null;
  total_protein: number | null;
  total_fat: number | null;
  total_carbs: number | null;
  total_fiber: number | null;
  total_salt: number | null;
}

interface TopProduct {
  name: string;
  order_count: number;
  total_qty: number;
  total_spent: number;
  total_savings: number;
}

interface CategorySpend {
  category: string;
  order_count: number;
  total_spent: number;
  total_savings: number;
  item_count: number;
}

interface RecommendationItem {
  name: string;
  suggested_qty: number;
  days_until_needed: number;
  est_inventory: number;
  avg_interval_days: number;
  last_bought_days_ago: number;
  purchase_count: number;
  median_price: number;
  estimated_cost: number;
  confidence: number;
}

interface Recommendations {
  needed: RecommendationItem[];
  soon: RecommendationItem[];
  estimated_total: number;
  items_analyzed: number;
  planning_horizon_days: number;
}

function euro(v: number) {
  return `€${v.toFixed(2)}`;
}

function rangeToParams(range: Range): { start?: string; end?: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const firstOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastCompletedDay = new Date(firstOfCurrentMonth.getTime() - 86400000);
  const completedMonths = (count: number) => {
    const start = new Date(firstOfCurrentMonth.getFullYear(), firstOfCurrentMonth.getMonth() - count, 1);
    return { start: fmt(start), end: fmt(lastCompletedDay) };
  };
  switch (range) {
    case "ytd":
      return { start: `${now.getFullYear()}-01-01`, end: fmt(lastCompletedDay) };
    case "last-year":
      return { start: `${now.getFullYear() - 1}-01-01`, end: `${now.getFullYear() - 1}-12-31` };
    case "1m": return completedMonths(1);
    case "3m": return completedMonths(3);
    case "6m": return completedMonths(6);
    default:
      return {};
  }
}

function buildQuery(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ─── Charts ──────────────────────────────────────────────────────────────────

function SpendingChart({ data }: { data: SpendingPoint[] }) {
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

function TrendLine({ data, field }: { data: SpendingPoint[]; field: "total_spent" | "avg_per_order" }) {
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

function NutritionLineChart({ data, field, color }: {
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

function NutritionBar({ label, value, max, unit, color }: {
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

function CategoryChart({ data }: { data: CategorySpend[] }) {
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

function ConfidenceBadge({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  const bg = pct >= 70 ? "success" : pct >= 40 ? "warning" : "secondary";
  return <Badge bg={bg} className="fw-normal">{pct}%</Badge>;
}

// ─── Selectors ───────────────────────────────────────────────────────────────

function PeriodRangeSelectors({
  period, range,
  onPeriod, onRange,
}: {
  period: Period; range: Range;
  onPeriod: (p: Period) => void; onRange: (r: Range) => void;
}) {
  return (
    <div className="d-flex flex-wrap gap-2 align-items-center">
      <ButtonGroup size="sm">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <Button key={p} variant={period === p ? "secondary" : "outline-secondary"} onClick={() => onPeriod(p)}>
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </ButtonGroup>
      <ButtonGroup size="sm">
        {(Object.keys(RANGE_LABELS) as Range[]).map(r => (
          <Button key={r} variant={range === r ? "primary" : "outline-secondary"} onClick={() => onRange(r)}>
            {RANGE_LABELS[r]}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}

// ─── Health scorecard ────────────────────────────────────────────────────────

interface HealthGroup {
  group: string;
  label: string;
  emoji: string;
  spent: number;
  savings: number;
  pct: number;
  rating: "green" | "yellow" | "red" | "neutral";
}

interface HealthScore {
  groups: HealthGroup[];
  food_spend: number;
  total_spend: number;
  total_savings: number;
  start: string;
  end: string;
}

const RATING_COLOR: Record<string, string> = {
  green: "#198754",
  yellow: "#fd7e14",
  red: "#dc3545",
  neutral: "#6c757d",
};

const RATING_LABEL: Record<string, string> = {
  green: "Goed",
  yellow: "Let op",
  red: "Te veel / te weinig",
  neutral: "Neutraal",
};

function HealthScorecard({ start, end }: { start?: string; end?: string }) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  const { data, isLoading } = useSWR(
    `/analytics/health-score${qs ? `?${qs}` : ""}`,
    (url: string) => api.get<HealthScore>(url),
  );

  if (isLoading) return <Spinner size="sm" />;
  if (!data || data.groups.length === 0)
    return <p className="text-muted small">Geen data voor geselecteerde periode.</p>;

  const visible = data.groups.filter(g => g.spent > 0 || g.group === "fish" || g.group === "legumes");

  return (
    <div>
      <div className="small text-muted mb-3 d-flex gap-3 flex-wrap">
        <span>Voedsel: <strong>€{data.food_spend.toFixed(2)}</strong></span>
        {data.total_spend > data.food_spend && (
          <span>Non-food: <strong>€{(data.total_spend - data.food_spend).toFixed(2)}</strong></span>
        )}
        <span>Totaal: <strong>€{data.total_spend.toFixed(2)}</strong></span>
        {data.total_savings > 0 && (
          <span className="text-success">Bespaard: <strong>−€{data.total_savings.toFixed(2)}</strong></span>
        )}
      </div>
      <div className="row g-2">
        {visible.map(g => (
          <div key={g.group} className="col-6 col-md-4 col-lg-3">
            <div
              className="p-2 rounded border h-100"
              style={{ borderColor: RATING_COLOR[g.rating] + "55", background: RATING_COLOR[g.rating] + "0a" }}
            >
              <div className="d-flex align-items-center gap-2 mb-1">
                <span style={{ fontSize: "1.1rem" }}>{g.emoji}</span>
                <span className="small fw-semibold">{g.label}</span>
                <span
                  className="ms-auto badge"
                  style={{ background: RATING_COLOR[g.rating], fontSize: "0.65rem" }}
                >
                  {RATING_LABEL[g.rating]}
                </span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <div style={{ flex: 1, height: 6, background: "#e9ecef", borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${Math.min(100, g.pct * 4)}%`,
                      height: "100%",
                      background: RATING_COLOR[g.rating],
                      borderRadius: 3,
                    }}
                  />
                </div>
                <span className="small text-muted" style={{ whiteSpace: "nowrap" }}>{g.pct.toFixed(1)}%</span>
              </div>
              <div className="small text-muted mt-1 d-flex gap-2">
                <span>€{g.spent.toFixed(2)}</span>
                {g.savings > 0 && <span className="text-success">−€{g.savings.toFixed(2)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ollama chat widget ───────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "Wat kan ik verbeteren in mijn eetpatroon?",
  "Welke gezonde producten koop ik te weinig?",
  "Hoeveel bewerkt voedsel koop ik?",
  "Geef me een weekmenu op basis van mijn aankopen.",
];

function ChatWidget({ start, end }: { start?: string; end?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(question: string) {
    if (!question.trim() || streaming) return;
    const userMsg: ChatMessage = { role: "user", content: question };
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const resp = await fetch("/api/analytics/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, messages: history, start, end }),
      });

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            if (chunk.content) {
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: next[next.length - 1].content + chunk.content,
                };
                return next;
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: `[Fout: ${e}]` };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div>
      {messages.length === 0 && (
        <div className="d-flex flex-wrap gap-2 mb-3">
          {STARTERS.map(s => (
            <button
              key={s}
              className="btn btn-outline-secondary btn-sm"
              onClick={() => send(s)}
              disabled={streaming}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div
          className="mb-3 border rounded p-3"
          style={{ maxHeight: 480, overflowY: "auto", background: "#f8f9fa" }}
        >
          {messages.map((m, i) => (
            <div key={i} className={`mb-3 ${m.role === "user" ? "text-end" : ""}`}>
              <div
                className="d-inline-block text-start rounded p-2"
                style={{
                  maxWidth: "85%",
                  background: m.role === "user" ? "#003d9b" : "#fff",
                  color: m.role === "user" ? "#fff" : "#212529",
                  fontSize: "0.875rem",
                  whiteSpace: "pre-wrap",
                  border: m.role === "assistant" ? "1px solid #dee2e6" : "none",
                }}
              >
                {m.content || (streaming && i === messages.length - 1 ? "▋" : "")}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="d-flex gap-2">
        <input
          className="form-control form-control-sm"
          placeholder="Stel een vraag over jouw boodschappen…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          disabled={streaming}
        />
        <Button size="sm" variant="primary" onClick={() => send(input)} disabled={streaming || !input.trim()}>
          {streaming ? <Spinner size="sm" /> : "Verstuur"}
        </Button>
        {messages.length > 0 && (
          <Button size="sm" variant="outline-secondary" onClick={() => setMessages([])} disabled={streaming}>
            Wis
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [range, setRange] = useState<Range>("ytd");
  const [nutritionView, setNutritionView] = useState<"total" | "avg">("total");

  const rangeParams = useMemo(() => rangeToParams(range), [range]);
  const rangeQs = useMemo(() => buildQuery(rangeParams), [rangeParams]);
  const spendingQs = useMemo(
    () => buildQuery({ period, ...rangeParams }),
    [period, rangeParams]
  );

  const { data: summaryData } = useSWR(
    `/analytics/summary${rangeQs}`,
    (url: string) => api.get<{
      total_orders: number; total_spent: number; avg_per_order: number;
      first_date: string | null; last_date: string | null;
    }>(url)
  );

  const { data: spendingData, isLoading: spendingLoading } = useSWR(
    `/analytics/spending${spendingQs}`,
    (url: string) => api.get<{ period: string; data: SpendingPoint[] }>(url)
  );

  const { data: nutritionData, isLoading: nutritionLoading } = useSWR(
    `/analytics/nutrition${spendingQs}`,
    (url: string) => api.get<{ period: string; data: NutritionPoint[]; has_nutrition_data: boolean }>(url)
  );

  const { data: productsData, isLoading: productsLoading } = useSWR(
    `/analytics/top-products${rangeQs}`,
    (url: string) => api.get<{ products: TopProduct[] }>(url)
  );

  const { data: categoriesData, isLoading: categoriesLoading } = useSWR(
    `/analytics/categories${rangeQs}`,
    (url: string) => api.get<{ categories: CategorySpend[] }>(url)
  );

  const [daysAhead, setDaysAhead] = useState(7);

  const now = new Date();
  const [exportYear, setExportYear] = useState(now.getFullYear());
  const [exportMonth, setExportMonth] = useState(now.getMonth() + 1);
  const [exportSpecificMonth, setExportSpecificMonth] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const yearsData = useSWR("/analytics/years", (url: string) => api.get<{ years: number[] }>(url));

  async function downloadCsv() {
    const pad = (n: number) => String(n).padStart(2, "0");
    const exportParams = exportSpecificMonth
      ? { start: `${exportYear}-${pad(exportMonth)}-01`, end: `${exportYear}-${pad(exportMonth)}-${new Date(exportYear, exportMonth, 0).getDate()}` }
      : rangeParams;
    const query = buildQuery(exportParams);
    setExportLoading(true);
    try {
      const resp = await fetch(`/api/analytics/export${query}`);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `bestellingen-${exportSpecificMonth ? `${exportYear}-${pad(exportMonth)}` : range}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExportLoading(false);
    }
  }
  const { data: recsData, isLoading: recsLoading } = useSWR(
    `/analytics/recommendations${buildQuery({ days_ahead: String(daysAhead), ...rangeParams })}`,
    (url: string) => api.get<Recommendations>(url)
  );

  const spending = spendingData?.data ?? [];
  const nutrition = nutritionData?.data ?? [];
  const products = productsData?.products ?? [];
  const categories = categoriesData?.categories ?? [];
  const recs = recsData ?? null;
  const analyticsStart = rangeParams.start;
  const analyticsEnd = rangeParams.end;

  // Sum totals across all periods for macro summary bars
  const nutritionSummary = useMemo(() => {
    const rows = nutrition.filter(n => n.total_kcal !== null);
    if (rows.length === 0) return null;
    const sum = (field: keyof NutritionPoint) =>
      rows.reduce((s, r) => s + ((r[field] as number | null) ?? 0), 0) || null;
    const totalOrders = rows.reduce((s, r) => s + r.order_count, 0);
    return {
      total_kcal: sum("total_kcal"),
      total_protein: sum("total_protein"),
      total_fat: sum("total_fat"),
      total_carbs: sum("total_carbs"),
      total_fiber: sum("total_fiber"),
      total_salt: sum("total_salt"),
      avg_kcal: sum("total_kcal") !== null ? sum("total_kcal")! / totalOrders : null,
    };
  }, [nutrition]);

  return (
    <>
      <h1 className="h3 mb-4">Analytics</h1>

      {/* ── Summary ── */}
      {summaryData && summaryData.total_orders > 0 && (
        <Row className="g-3 mb-4">
          {[
            { label: "Totaal uitgegeven", value: euro(summaryData.total_spent) },
            { label: "Bestellingen", value: String(summaryData.total_orders) },
            { label: "Gem. per bestelling", value: euro(summaryData.avg_per_order) },
            {
              label: "Periode",
              value: summaryData.first_date && summaryData.last_date
                ? `${summaryData.first_date} – ${summaryData.last_date}`
                : "—",
            },
          ].map(({ label, value }) => (
            <Col key={label} xs={6} sm={3}>
              <div className="text-center p-3 bg-white border rounded shadow-sm h-100">
                <div className="fw-bold fs-5">{value}</div>
                <div className="small text-muted">{label}</div>
              </div>
            </Col>
          ))}
        </Row>
      )}

      <div className="mb-3 p-3 bg-white border rounded">
        <div className="small fw-semibold mb-2">Periode</div>
        <PeriodRangeSelectors period={period} range={range} onPeriod={setPeriod} onRange={setRange} />
      </div>

      <Tabs defaultActiveKey="spending" className="mb-3" mountOnEnter>
        {/* ── Spending ── */}
        <Tab eventKey="spending" title="Uitgaven">
        <Col xs={12}>
          <Card className="shadow-sm">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">Uitgaven</span>
            </Card.Header>
            <Card.Body>
              {spendingLoading && <Spinner size="sm" />}
              {!spendingLoading && spending.length === 0 && (
                <Alert variant="info" className="mb-0">
                  Geen bestellingen gevonden. Importeer eerst bestellingen via Instellingen → Bestellingen &amp; Kassabonnen.
                </Alert>
              )}
              {spending.length > 0 && (
                <>
                  <SpendingChart data={spending} />
                  {period !== "season" && spending.length >= 3 && (
                    <div className="mt-3 pt-3 border-top">
                      <div className="small fw-medium mb-2">Trend — gem. per bestelling</div>
                      <TrendLine data={spending} field="avg_per_order" />
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-top">
                    <Table size="sm" className="mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>{PERIOD_LABELS[period]}</th>
                          <th className="text-end">Bestellingen</th>
                          <th className="text-end">Totaal</th>
                          <th className="text-end">Gem./bestelling</th>
                        </tr>
                      </thead>
                      <tbody style={{ fontSize: "0.82rem" }}>
                        {[...spending].reverse().map((d, i) => (
                          <tr key={i}>
                            <td>{d.label}</td>
                            <td className="text-end">{d.order_count}</td>
                            <td className="text-end">{euro(d.total_spent)}</td>
                            <td className="text-end">{euro(d.avg_per_order)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        {/* ── Nutrition ── */}
        <Tab eventKey="nutrition" title="Voedingswaarden">
        <Col xs={12}>
          <Card className="shadow-sm">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <span className="fw-semibold">Voedingswaarden</span>
                <div className="small text-muted">Gem. voedingswaarden per bestelling (op basis van gekochte producten)</div>
              </div>
            </Card.Header>
            <Card.Body>
              {nutritionLoading && <Spinner size="sm" />}
              {!nutritionLoading && nutrition.length === 0 && (
                <Alert variant="info" className="mb-0">
                  Geen data. Zorg dat bestellingen geïmporteerd zijn én producten voedingswaarden hebben.
                </Alert>
              )}
              {!nutritionLoading && nutrition.length > 0 && !nutritionData?.has_nutrition_data && (
                <Alert variant="warning" className="mb-3">
                  Bestellingen gevonden, maar geen voedingswaarden in de database. Scrape eerst producten om voedingswaarden te laden.
                </Alert>
              )}
              {nutrition.length > 0 && nutritionData?.has_nutrition_data && (
                <Row className="g-4">
                  {/* Macro summary bars — totals for the period */}
                  {nutritionSummary && (
                    <Col xs={12} md={4}>
                      <div className="small fw-medium mb-3">Totaal gekochte voedingsstoffen (gehele periode)</div>
                      <NutritionBar label="Calorieën" value={nutritionSummary.total_kcal} max={150000} unit="kcal" color="#003d9b" />
                      <NutritionBar label="Eiwit" value={nutritionSummary.total_protein} max={10000} unit="g" color="#198754" />
                      <NutritionBar label="Koolhydraten" value={nutritionSummary.total_carbs} max={30000} unit="g" color="#fd7e14" />
                      <NutritionBar label="Vetten" value={nutritionSummary.total_fat} max={10000} unit="g" color="#ffc107" />
                      <NutritionBar label="Vezels" value={nutritionSummary.total_fiber} max={3000} unit="g" color="#20c997" />
                      <NutritionBar label="Zout" value={nutritionSummary.total_salt} max={1000} unit="g" color="#dc3545" />
                      {nutritionSummary.avg_kcal !== null && (
                        <div className="small text-muted mt-2 pt-2 border-top">
                          Gem. {nutritionSummary.avg_kcal.toFixed(0)} kcal per bestelling
                        </div>
                      )}
                    </Col>
                  )}

                  {/* Kcal trend + table */}
                  <Col xs={12} md={8}>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="small fw-medium">
                        {nutritionView === "total" ? "Totale kcal per periode" : "Gem. kcal per bestelling"}
                      </div>
                      <ButtonGroup size="sm">
                        <Button variant={nutritionView === "total" ? "secondary" : "outline-secondary"} onClick={() => setNutritionView("total")}>Totaal</Button>
                        <Button variant={nutritionView === "avg" ? "secondary" : "outline-secondary"} onClick={() => setNutritionView("avg")}>Per bestelling</Button>
                      </ButtonGroup>
                    </div>
                    <NutritionLineChart
                      data={nutrition}
                      field={nutritionView === "total" ? "total_kcal" : "avg_kcal"}
                      color="#003d9b"
                    />
                    <div className="mt-3 overflow-auto" style={{ maxHeight: 260 }}>
                      <Table size="sm" className="mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>{PERIOD_LABELS[period]}</th>
                            <th className="text-end">Orders</th>
                            <th className="text-end">{nutritionView === "total" ? "Kcal totaal" : "Kcal/order"}</th>
                            <th className="text-end">{nutritionView === "total" ? "Eiwit tot." : "Eiwit/order"}</th>
                            <th className="text-end">{nutritionView === "total" ? "KH tot." : "KH/order"}</th>
                            <th className="text-end">{nutritionView === "total" ? "Vet tot." : "Vet/order"}</th>
                          </tr>
                        </thead>
                        <tbody style={{ fontSize: "0.82rem" }}>
                          {[...nutrition].reverse().map((n, i) => {
                            const kcal = nutritionView === "total" ? n.total_kcal : n.avg_kcal;
                            const prot = nutritionView === "total" ? n.total_protein : n.avg_protein;
                            const carb = nutritionView === "total" ? n.total_carbs : n.avg_carbs;
                            const fat = nutritionView === "total" ? n.total_fat : n.avg_fat;
                            return (
                              <tr key={i}>
                                <td>{n.label}</td>
                                <td className="text-end">{n.order_count}</td>
                                <td className="text-end">{kcal?.toFixed(0) ?? "—"}</td>
                                <td className="text-end">{prot?.toFixed(1) ?? "—"}g</td>
                                <td className="text-end">{carb?.toFixed(1) ?? "—"}g</td>
                                <td className="text-end">{fat?.toFixed(1) ?? "—"}g</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </div>
                  </Col>
                </Row>
              )}
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        {/* ── Aanbevelingen ── */}
        <Tab eventKey="recommendations" title="Aanbevelingen">
        <Col xs={12}>
          <Card className="shadow-sm">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <span className="fw-semibold">Boodschappenlijst aanbevelingen</span>
                <div className="small text-muted">Gebaseerd op kooppatronen (exponentieel gewogen intervalanalyse)</div>
              </div>
              <ButtonGroup size="sm">
                {[4, 7, 14].map(d => (
                  <Button key={d} variant={daysAhead === d ? "primary" : "outline-secondary"} onClick={() => setDaysAhead(d)}>
                    {d} dgn
                  </Button>
                ))}
              </ButtonGroup>
            </Card.Header>
            <Card.Body>
              {recsLoading && <Spinner size="sm" />}
              {!recsLoading && recs && (recs.needed.length === 0 && recs.soon.length === 0) && (
                <Alert variant="info" className="mb-0">
                  Geen aanbevelingen — te weinig herhalingsaankopen gevonden ({recs.items_analyzed} producten geanalyseerd).
                </Alert>
              )}
              {recs && (recs.needed.length > 0 || recs.soon.length > 0) && (
                <>
                  {recs.needed.length > 0 && (
                    <div className="mb-3">
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <Badge bg="danger">Nu nodig</Badge>
                        <span className="small text-muted">Binnen {recs.planning_horizon_days} dagen op</span>
                        <span className="ms-auto small fw-medium">Geschat: {euro(recs.estimated_total)}</span>
                      </div>
                      <Table size="sm" hover className="mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>Product</th>
                            <th className="text-end">Aantal</th>
                            <th className="text-end">Prijs</th>
                            <th className="text-end">Laast gekocht</th>
                            <th className="text-end">Elke ~</th>
                            <th className="text-end">Zekerheid</th>
                          </tr>
                        </thead>
                        <tbody style={{ fontSize: "0.82rem" }}>
                          {recs.needed.map((item, i) => (
                            <tr key={i}>
                              <td>{item.name}</td>
                              <td className="text-end">{item.suggested_qty}×</td>
                              <td className="text-end">{item.median_price > 0 ? euro(item.estimated_cost) : "—"}</td>
                              <td className="text-end text-muted">{Math.round(item.last_bought_days_ago)} dgn geleden</td>
                              <td className="text-end text-muted">{item.avg_interval_days} dgn</td>
                              <td className="text-end"><ConfidenceBadge v={item.confidence} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                  {recs.soon.length > 0 && (
                    <div>
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <Badge bg="warning" text="dark">Bijna op</Badge>
                        <span className="small text-muted">Binnen {recs.planning_horizon_days * 2} dagen</span>
                      </div>
                      <Table size="sm" hover className="mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>Product</th>
                            <th className="text-end">Over ~</th>
                            <th className="text-end">Elke ~</th>
                            <th className="text-end">Zekerheid</th>
                          </tr>
                        </thead>
                        <tbody style={{ fontSize: "0.82rem" }}>
                          {recs.soon.map((item, i) => (
                            <tr key={i}>
                              <td>{item.name}</td>
                              <td className="text-end text-muted">{item.days_until_needed} dgn</td>
                              <td className="text-end text-muted">{item.avg_interval_days} dgn</td>
                              <td className="text-end"><ConfidenceBadge v={item.confidence} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                  <div className="small text-muted mt-3">{recs.items_analyzed} producten geanalyseerd</div>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        {/* ── Categorie & Top producten ── */}
        <Tab eventKey="categories" title="Categorieën">
        <Col xs={12}>
          <Card className="shadow-sm h-100">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">Uitgaven per categorie</span>
            </Card.Header>
            <Card.Body>
              {categoriesLoading && <Spinner size="sm" />}
              {!categoriesLoading && categories.length === 0 && (
                <Alert variant="info" className="mb-0">Geen categoriedata beschikbaar.</Alert>
              )}
              {categories.length > 0 && <CategoryChart data={categories} />}
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        {/* ── CSV export ── */}
        <Tab eventKey="export" title="Exporteren">
        <Col xs={12}>
          <Card className="shadow-sm">
            <Card.Header className="bg-white">
              <span className="fw-semibold">Exporteren</span>
            </Card.Header>
            <Card.Body>
              <div className="d-flex align-items-center flex-wrap gap-3">
                <div className="form-check">
                  <input
                    id="specific-export-month"
                    className="form-check-input"
                    type="checkbox"
                    checked={exportSpecificMonth}
                    onChange={e => setExportSpecificMonth(e.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="specific-export-month">Specifieke maand</label>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <label className="small fw-medium mb-0">Jaar</label>
                  <select
                    className="form-select form-select-sm"
                    style={{ width: "auto" }}
                    value={exportYear}
                    onChange={e => setExportYear(Number(e.target.value))}
                    disabled={!exportSpecificMonth}
                  >
                    {(yearsData.data?.years ?? [exportYear]).map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <label className="small fw-medium mb-0">Maand</label>
                  <select
                    className="form-select form-select-sm"
                    style={{ width: "auto" }}
                    value={exportMonth}
                    onChange={e => setExportMonth(Number(e.target.value))}
                    disabled={!exportSpecificMonth}
                  >
                    {["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"].map((m, i) => (
                      <option key={i} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <Button size="sm" variant="outline-primary" onClick={downloadCsv} disabled={exportLoading}>
                  {exportLoading ? <Spinner size="sm" className="me-1" /> : null}
                  Download CSV
                </Button>
                <span className="small text-muted">
                  {exportSpecificMonth ? `Alle producten uit ${["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"][exportMonth - 1]} ${exportYear}` : `Alle producten uit ${RANGE_LABELS[range].toLowerCase()}`}
                </span>
              </div>
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        {/* ── Health scorecard ── */}
        <Tab eventKey="advice" title="Voedselgroepen & advies">
        <Col xs={12}>
          <Card className="shadow-sm">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <span className="fw-semibold">Voedselgroepen scorecard</span>
                <div className="small text-muted">
                  Analyse voor {RANGE_LABELS[range].toLowerCase()}
                </div>
              </div>
            </Card.Header>
            <Card.Body>
              <HealthScorecard start={analyticsStart} end={analyticsEnd} />
            </Card.Body>
          </Card>
        </Col>

        {/* ── Ollama chat ── */}
        <Col xs={12} className="mt-4">
          <Card className="shadow-sm">
            <Card.Header className="bg-white">
              <div>
                <span className="fw-semibold">Voedingsadvies assistent</span>
                <div className="small text-muted">
                  Stel vragen over jouw boodschappen van {RANGE_LABELS[range].toLowerCase()} — aangedreven door Ollama (lokaal)
                </div>
              </div>
            </Card.Header>
            <Card.Body>
              <ChatWidget
                start={analyticsStart}
                end={analyticsEnd}
              />
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        <Tab eventKey="products" title="Topproducten">
        <Col xs={12}>
          <Card className="shadow-sm h-100">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">Meest gekochte producten</span>
            </Card.Header>
            <Card.Body className="p-0">
              {productsLoading && <div className="p-3"><Spinner size="sm" /></div>}
              {!productsLoading && products.length === 0 && (
                <Alert variant="info" className="m-3 mb-0">Geen producten gevonden voor deze periode.</Alert>
              )}
              {products.length > 0 && (
                <Table size="sm" hover className="mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">#</th>
                      <th>Product</th>
                      <th className="text-end">Stuks</th>
                      <th className="text-end">Orders</th>
                      <th className="text-end">Bespaard</th>
                      <th className="text-end pe-3">Totaal</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontSize: "0.82rem" }}>
                    {products.slice(0, 20).map((p, i) => (
                      <tr key={i}>
                        <td className="ps-3 text-muted">{i + 1}</td>
                        <td>{p.name}</td>
                        <td className="text-end"><Badge bg="primary">{Math.round(p.total_qty)}×</Badge></td>
                        <td className="text-end"><Badge bg="light" text="dark">{p.order_count}×</Badge></td>
                        <td className="text-end text-success">{p.total_savings > 0 ? `−${euro(p.total_savings)}` : "—"}</td>
                        <td className="text-end pe-3">{euro(p.total_spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
        </Tab>
      </Tabs>
    </>
  );
}
