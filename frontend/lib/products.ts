import { type Product, type ProductSnapshot, type BundleInfo, type OrderBought } from "@/lib/api";


export const PAGE_SIZE = 48;

export const GROUP_PAGE_SIZE = 20;

export interface ProductsPageData {
  total: number;
  items: Product[];
}

export interface ProductGroupOut {
  group_name: string;
  variant_count: number;
  products: Product[];
}

export interface ProductGroupsPage {
  total_groups: number;
  groups: ProductGroupOut[];
}

export interface TypeGroupOut {
  type_group: string;
  product_count: number;
  brands: string[];
  min_price: number | null;
  max_price: number | null;
}

export interface TypeGroupsPage {
  total_groups: number;
  groups: TypeGroupOut[];
}

export interface Suggestion {
  id: number;
  name: string;
  name_en: string | null;
  brand: string | null;
}

export type Snap = NonNullable<Product["latest_snapshot"]>;

export function unitPrice(s: Snap): { label: string; value: string } | null {
  if (s.price_per_kg) return { label: "/kg", value: `€${Number(s.price_per_kg).toFixed(2)}` };
  if (s.price_per_litre) return { label: "/l", value: `€${Number(s.price_per_litre).toFixed(2)}` };
  if (s.price_per_piece) return { label: "/st", value: `€${Number(s.price_per_piece).toFixed(2)}` };
  if (s.price_per_100g) return { label: "/100g", value: `€${Number(s.price_per_100g).toFixed(2)}` };
  if (s.price_per_100ml) return { label: "/100ml", value: `€${Number(s.price_per_100ml).toFixed(2)}` };
  return null;
}

export function effPrice(s: Snap): number {
  return Number(s.is_bonus && s.bonus_price ? s.bonus_price : s.price);
}

export function orderMinUnitPrice(ob: OrderBought): string | null {
  if (ob.min_per_kg != null) return `€${Number(ob.min_per_kg).toFixed(2)}/kg`;
  if (ob.min_per_litre != null) return `€${Number(ob.min_per_litre).toFixed(2)}/l`;
  if (ob.min_per_piece != null) return `€${Number(ob.min_per_piece).toFixed(2)}/st`;
  if (ob.min_price_paid != null) return `€${Number(ob.min_price_paid).toFixed(2)}`;
  return null;
}

export function bundleUnitPrice(b: BundleInfo): string | null {
  if (b.price_per_kg) return `€${Number(b.price_per_kg).toFixed(2)}/kg`;
  if (b.price_per_litre) return `€${Number(b.price_per_litre).toFixed(2)}/l`;
  if (b.price_per_piece) return `€${Number(b.price_per_piece).toFixed(2)}/st`;
  return null;
}

export function isBundleCheaperPerUnit(s: ProductSnapshot | null, b: BundleInfo): boolean {
  if (!s) return false;
  const singlePpu = s.price_per_kg ?? s.price_per_litre ?? s.price_per_piece ?? null;
  const bundlePpu = b.price_per_kg ?? b.price_per_litre ?? b.price_per_piece ?? null;
  if (singlePpu == null || bundlePpu == null) return false;
  return Number(bundlePpu) < Number(singlePpu);
}

