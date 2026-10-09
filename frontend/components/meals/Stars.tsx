"use client";
import { IngredientEditRow } from "@/components/meals/IngredientEditRow";


export function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <span>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ cursor: onChange ? "pointer" : "default", color: n <= value ? "#f5a623" : "#ccc" }}
          onClick={() => onChange?.(n)}>★</span>
      ))}
    </span>
  );
}

// ─── IngredientEditRow ──────────────────────────────────────────────────────────

