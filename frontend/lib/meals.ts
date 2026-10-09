import { type Meal } from "@/lib/api";
import { NutritionTable } from "@/components/meals/NutritionTable";


export const MEALS_KEY = "/meals/";

export const FAMILY_KEY = "/family/";

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function formatQty(qty: number | null, unit: string | null): string {
  if (!qty && qty !== 0) return unit ?? "";
  const clean = qty % 1 === 0 ? String(Math.round(qty)) : String(qty);
  return unit ? `${clean} ${unit}` : clean;
}

export const UNIT_OPTIONS = ["g", "kg", "ml", "l", "stuks", "el", "tl", "snufje", "teen", "bos", "plak", "blokje"];

// ─── NutritionTable ────────────────────────────────────────────────────────────

export function fmt(v: number | null | undefined): string {
  if (v == null) return "–";
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
}

export interface Suggestion { id: number; name: string; brand: string | null; }

export interface ImportMatchNote {
  ingredient_name: string;
  matched: boolean;
  product_name: string | null;
  product_id: number | null;
}

export interface ImportResult {
  meal: Meal;
  match_notes: ImportMatchNote[];
}

