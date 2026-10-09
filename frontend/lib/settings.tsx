import Badge from "react-bootstrap/Badge";


export interface AuthStatus {
  authenticated: boolean;
  expires_at: string | null;
  login_url: string;
}

export interface OllamaStatus {
  available: boolean;
  model: string;
  url: string;
}

export interface ScrapeStatus {
  running: boolean;
  phase: string | null;
  last_run_at: string | null;
  last_error: string | null;
  current_category: string | null;
  current_subcat: string | null;
  categories_done: number;
  categories_total: number;
  categories_skipped: number;
  categories_started: number;
  subcats_done: number;
  subcats_total: number;
  subcats_skipped: number;
  products_this_run: number;
}

export interface OrdersStatus {
  running: boolean;
  mode: "full" | "incremental" | null;
  last_run_at: string | null;
  last_error: string | null;
  last_result: { pos: number; online: number; skipped?: boolean } | null;
}

export interface EnrichStatus {
  running: boolean;
  last_result: { enriched: number; skipped: number; failed: number; total: number } | null;
  last_error: string | null;
}

export interface NutritionStatus {
  running: boolean;
  last_result: {
    updated: number;
    skipped: number;
    errors: number;
    total: number;
    products_with_error: number;
  } | null;
  last_error: string | null;
  batches_done: number;
  total_updated: number;
  total_skipped: number;
  total_errors: number;
}

export interface ProductStats {
  total_products: number;
  total_categories: number;
  total_groups: number;
}

export interface NutritionStats {
  total_active: number;
  with_nutrition: number;
  with_error: number;
  never_attempted: number;
  last_enriched_at: string | null;
}

export function statusBadge(running: boolean, error: string | null, doneAt: string | null) {
  if (running) return <Badge bg="warning" text="dark">Bezig</Badge>;
  if (error) return <Badge bg="danger">Fout</Badge>;
  if (doneAt) return <Badge bg="success">Klaar</Badge>;
  return <Badge bg="secondary">Inactief</Badge>;
}

