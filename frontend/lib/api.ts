const BASE = "/api";

const STATUS_MESSAGES: Record<number, string> = {
  404: "Niet gevonden",
  422: "Ongeldige invoer",
  500: "Serverfout, probeer het later opnieuw",
  502: "De server is tijdelijk niet bereikbaar",
  503: "Dienst niet beschikbaar",
};

/** Quantity without pointless decimals: 2 -> "2", 0.5 -> "0,5", 1.25 -> "1,25" */
export function fmtQty(v: number | string): string {
  return Number(Number(v).toFixed(2)).toLocaleString("nl-NL", { maximumFractionDigits: 2 });
}

export function fmtEur(v: number | string): string {
  return Number(v).toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
}

/** "2026-10-09" -> "vr 9 okt" (parsed at noon to avoid timezone shifts) */
export function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

/** Whole days from today until the given ISO date (negative = already past) */
export function daysUntil(iso: string): number {
  const d = new Date(iso + "T12:00:00");
  const t = new Date(); t.setHours(12, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("Kan de server niet bereiken. Draait de applicatie nog?");
  }
  if (!resp.ok) {
    const text = await resp.text();
    let message = STATUS_MESSAGES[resp.status] ?? `Er ging iets mis (HTTP ${resp.status})`;
    try {
      const json = JSON.parse(text);
      if (typeof json.detail === "string") message = json.detail;
      else if (Array.isArray(json.detail)) message = json.detail.map((e: { msg: string }) => e.msg).join(", ");
      else if (json.message) message = json.message;
      else message = text || message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  return resp.json();
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

// Types
export interface OrderBought {
  times: number;
  min_price_paid: number | null;
  min_per_kg: number | null;
  min_per_litre: number | null;
  min_per_piece: number | null;
}

export interface BundleInfo {
  id: number;
  name: string;
  price_per_kg: number | null;
  price_per_litre: number | null;
  price_per_piece: number | null;
}

export interface ProductSnapshot {
  id: number;
  scraped_at: string;
  price: number;
  is_bonus: boolean;
  bonus_price: number | null;
  bonus_until: string | null;
  price_per_100g: number | null;
  price_per_100ml: number | null;
  price_per_kg: number | null;
  price_per_litre: number | null;
  price_per_piece: number | null;
  weight_g: number | null;
  volume_ml: number | null;
  pieces: number | null;
  nutrition: Record<string, unknown> | null;
}

export interface Product {
  id: number;
  external_id: string;
  name: string;
  name_en: string | null;
  brand: string | null;
  category: string | null;
  sub_category: string | null;
  image_url: string | null;
  unit_type: string;
  shelf_life_days: number | null;
  product_group_name: string | null;
  group_override: boolean;
  product_type_group: string | null;
  type_group_override: boolean;
  hq_id: number | null;
  barcode: string | null;
  gln: string | null;
  shop_type: string | null;
  available_online: boolean;
  available_in_store: boolean | null;
  nutriscore_letter: string | null;
  nix18: boolean;
  dietary_flags: Record<string, boolean> | null;
  is_active: boolean;
  latest_snapshot: ProductSnapshot | null;
  bundle: BundleInfo | null;
  order_bought: OrderBought | null;
}

export interface FamilyMember {
  id: number;
  name: string;
  birth_date: string | null;
  dietary_restrictions: Record<string, boolean>;
  member_type: "member" | "regular_guest" | "generic_guest";
}

export interface MealNutrition {
  energy_kcal: number | null;
  fat: number | null;
  saturated_fat: number | null;
  carbohydrates: number | null;
  sugars: number | null;
  fiber: number | null;
  protein: number | null;
  salt: number | null;
  ingredients_with_data: number;
  ingredients_total: number;
}

export interface Meal {
  id: number;
  name: string;
  category: string | null;
  is_starter: boolean;
  description: string | null;
  instructions: string | null;
  source_url: string | null;
  portions_default: number;
  prep_minutes: number | null;
  cook_minutes: number | null;
  tags: string[];
  nutrition_score: number | null;
  makes_leftovers: boolean;
  estimated_price: number | null;
  ingredients: MealIngredient[];
  ratings: MealRating[];
  nutrition: MealNutrition | null;
}

export interface LinkedProduct {
  id: number;
  name: string;
  brand: string | null;
  image_url: string | null;
  product_group_name: string | null;
  current_price: number | null;
  current_bonus_price: number | null;
  is_bonus: boolean;
  price_per_kg: number | null;
  price_per_litre: number | null;
  price_per_piece: number | null;
}

export interface MealIngredient {
  id: number;
  ingredient_name: string;
  product_id: number | null;
  quantity: number | null;
  unit: string | null;
  optional: boolean;
  skip_linking: boolean;
  substitute_notes: string | null;
  linked_product: LinkedProduct | null;
}

export interface MealRating {
  id: number;
  family_member_id: number;
  rating: number;
  cooked_at: string;
  notes: string | null;
}

export interface PantryItem {
  id: number;
  product_id: number;
  quantity: number;
  unit: string;
  added_at: string;
  expires_at: string | null;
  product: { id: number; name: string; image_url: string | null; category: string | null };
}

export interface MealPlan {
  id: number;
  name: string | null;
  created_at: string;
  start_date: string;
  days: number;
  budget_eur: number | null;
  meat_days: number | null;
  plan_days: MealPlanDay[];
}

export interface MealPlanDay {
  id: number;
  date: string;
  meal_id: number | null;
  meal_name: string | null;
  persons: number[];
  portions: number;
  is_leftovers: boolean;
  notes: string | null;
}

export interface ShoppingList {
  id: number;
  plan_id: number;
  generated_at: string;
  total_estimated: number | null;
  items: ShoppingListItem[];
}

export interface ShoppingListItem {
  id: number;
  product_id: number | null;
  ingredient_name: string;
  quantity: number;
  unit: string;
  estimated_price: number | null;
  from_pantry_quantity: number;
  is_bonus: boolean;
  is_checked: boolean;
  reasoning: string | null;
  category: string | null;
}

export interface CostLine {
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  product_name: string | null;
  cost: number | null;
  is_bonus: boolean;
  note: string | null;
}

export interface MealCost {
  meal_id: number;
  meal_name: string;
  portions: number;
  total: number;
  per_portion: number | null;
  priced: number;
  unpriced: number;
  lines: CostLine[];
}

export interface PlanDayCost {
  day_id: number;
  date: string;
  meal_name: string | null;
  portions: number;
  cost: number;
  unpriced: number;
  is_leftovers: boolean;
}

export interface PlanCost {
  plan_id: number;
  total: number;
  per_portion: number | null;
  per_day: PlanDayCost[];
  unpriced: number;
  budget_eur: number | null;
  over_budget: boolean | null;
  shopping_total: number | null;
}

export interface BuyAdvice {
  id: number;
  product_id: number;
  product: { id: number; name: string; image_url: string | null; category: string | null };
  advice_type: string;
  current_price: number;
  avg_price_90d: number | null;
  savings_pct: number | null;
  message: string | null;
  generated_at: string;
  expires_at: string | null;
  times_ordered: number;
}
