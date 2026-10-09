"use client";
import { type MealNutrition } from "@/lib/api";
import { fmt } from "@/lib/meals";
import { ProductSearchDropdown } from "@/components/meals/ProductSearchDropdown";


export function NutritionTable({ nutrition, portions }: { nutrition: MealNutrition; portions: number }) {
  const hasValues = nutrition.energy_kcal != null || nutrition.fat != null;
  const perPortion = (v: number | null | undefined) => v == null ? null : v / Math.max(1, portions);
  const rows: [string, string, number | null | undefined, number | null | undefined][] = [
    ["Energie", "kcal", nutrition.energy_kcal, perPortion(nutrition.energy_kcal)],
    ["Vet", "g", nutrition.fat, perPortion(nutrition.fat)],
    ["— waarvan verzadigd", "g", nutrition.saturated_fat, perPortion(nutrition.saturated_fat)],
    ["Koolhydraten", "g", nutrition.carbohydrates, perPortion(nutrition.carbohydrates)],
    ["— waarvan suikers", "g", nutrition.sugars, perPortion(nutrition.sugars)],
    ["Voedingsvezel", "g", nutrition.fiber, perPortion(nutrition.fiber)],
    ["Eiwitten", "g", nutrition.protein, perPortion(nutrition.protein)],
    ["Zout", "g", nutrition.salt, perPortion(nutrition.salt)],
  ];

  const coverage = nutrition.ingredients_total > 0
    ? `${nutrition.ingredients_with_data}/${nutrition.ingredients_total} ingrediënten met voedingswaarden`
    : null;

  return (
    <div>
      {hasValues ? (
        <table className="table table-sm table-borderless mb-1" style={{ fontSize: "0.82rem" }}>
          <thead>
            <tr className="border-bottom text-muted">
              <th className="fw-normal ps-0">Voedingswaarden</th>
              <th className="text-end fw-normal">Totaal</th>
              <th className="text-end fw-normal pe-0">Per portie ({portions}p)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, unit, total, per]) => (
              <tr key={label}>
                <td className="ps-0 text-muted">{label}</td>
                <td className="text-end">{fmt(total)} {unit}</td>
                <td className="text-end pe-0">{fmt(per)} {unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted small mb-1">Nog geen voedingswaarden beschikbaar.</p>
      )}
      {coverage && (
        <p className="text-muted mb-0" style={{ fontSize: "0.75rem" }}>{coverage}</p>
      )}
    </div>
  );
}

// ─── ProductSearchDropdown ──────────────────────────────────────────────────────

