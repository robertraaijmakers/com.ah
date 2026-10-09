

export type Period = "week" | "month" | "year" | "season";

export type Range = "1m" | "3m" | "6m" | "ytd" | "last-year" | "all";

export const PERIOD_LABELS: Record<Period, string> = {
  week: "Week",
  month: "Maand",
  year: "Jaar",
  season: "Seizoen",
};

export const RANGE_LABELS: Record<Range, string> = {
  "1m": "1 maand",
  "3m": "3 maanden",
  "6m": "6 mnd",
  ytd: "Dit jaar",
  "last-year": "Vorig jaar",
  all: "Alles",
};

export interface SpendingPoint {
  label: string;
  period_start?: string;
  order_count: number;
  total_spent: number;
  avg_per_order: number;
}

export interface NutritionPoint {
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

export interface TopProduct {
  name: string;
  order_count: number;
  total_qty: number;
  total_spent: number;
  total_savings: number;
}

export interface CategorySpend {
  category: string;
  order_count: number;
  total_spent: number;
  total_savings: number;
  item_count: number;
}

export interface RecommendationItem {
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

export interface Recommendations {
  needed: RecommendationItem[];
  soon: RecommendationItem[];
  estimated_total: number;
  items_analyzed: number;
  planning_horizon_days: number;
}

export function euro(v: number) {
  return `€${v.toFixed(2)}`;
}

export function rangeToParams(range: Range): { start?: string; end?: string } {
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

export function buildQuery(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ─── Charts ──────────────────────────────────────────────────────────────────

export interface HealthGroup {
  group: string;
  label: string;
  emoji: string;
  spent: number;
  savings: number;
  pct: number;
  rating: "green" | "yellow" | "red" | "neutral";
}

export interface HealthScore {
  groups: HealthGroup[];
  food_spend: number;
  total_spend: number;
  total_savings: number;
  start: string;
  end: string;
}

export const RATING_COLOR: Record<string, string> = {
  green: "#198754",
  yellow: "#fd7e14",
  red: "#dc3545",
  neutral: "#6c757d",
};

export const RATING_LABEL: Record<string, string> = {
  green: "Goed",
  yellow: "Let op",
  red: "Te veel / te weinig",
  neutral: "Neutraal",
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const STARTERS = [
  "Wat kan ik verbeteren in mijn eetpatroon?",
  "Welke gezonde producten koop ik te weinig?",
  "Hoeveel bewerkt voedsel koop ik?",
  "Geef me een weekmenu op basis van mijn aankopen.",
];

