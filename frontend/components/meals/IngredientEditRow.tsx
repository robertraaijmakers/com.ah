"use client";
import { useState } from "react";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Spinner from "react-bootstrap/Spinner";
import { api, type MealIngredient } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { UNIT_OPTIONS } from "@/lib/meals";
import { ProductSearchDropdown } from "@/components/meals/ProductSearchDropdown";
import { EditMealModal } from "@/components/meals/EditMealModal";


export function IngredientEditRow({ ing, mealId, onUpdated, onDeleted }: {
  ing: MealIngredient;
  mealId: number;
  onUpdated: (updated: MealIngredient) => void;
  onDeleted: () => void;
}) {
  const { showToast } = useToast();
  const [qty, setQty] = useState(ing.quantity != null ? String(ing.quantity) : "");
  const [unit, setUnit] = useState(ing.unit ?? "");
  const [name, setName] = useState(ing.ingredient_name);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  async function save(overrides?: { qty?: string; unit?: string; name?: string }) {
    if (saving) return;
    const qVal = overrides?.qty ?? qty;
    const uVal = overrides?.unit ?? unit;
    const nVal = overrides?.name ?? name;
    setSaving(true);
    try {
      const updated = await api.patch<MealIngredient>(`/meals/${mealId}/ingredients/${ing.id}`, {
        ingredient_name: nVal.trim(),
        quantity: qVal ? parseFloat(qVal) : null,
        unit: uVal || null,
      });
      setDirty(false);
      onUpdated(updated);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function linkProduct(productId: number | null, skipLinking = false) {
    try {
      const updated = await api.patch<MealIngredient>(`/meals/${mealId}/ingredients/${ing.id}/link`, {
        product_id: productId,
        skip_linking: skipLinking,
      });
      onUpdated(updated);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Koppelen mislukt");
    }
  }

  async function deleteIng() {
    try {
      await api.delete(`/meals/${mealId}/ingredients/${ing.id}`);
      onDeleted();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  const linkStatus = ing.skip_linking
    ? <Badge bg="secondary" className="fw-normal" style={{ fontSize: "0.65rem" }}>N/A</Badge>
    : ing.linked_product
    ? <Badge bg="success" className="fw-normal" style={{ fontSize: "0.65rem", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        🔗 {ing.linked_product.name}
      </Badge>
    : <Badge bg="warning" text="dark" className="fw-normal" style={{ fontSize: "0.65rem" }}>geen product</Badge>;

  return (
    <div className="border rounded p-2 mb-2" style={{ fontSize: "0.85rem" }}>
      <div className="d-flex gap-1 align-items-center mb-2">
        <Form.Control size="sm" style={{ maxWidth: 60 }} placeholder="Qty" value={qty}
          onChange={(e) => markDirty(setQty)(e.target.value)}
          onBlur={() => { if (dirty && !saving) save(); }} />
        <Form.Select size="sm" style={{ maxWidth: 80 }} value={unit}
          onChange={(e) => { const v = e.target.value; setUnit(v); setDirty(true); save({ unit: v }); }}>
          <option value="">—</option>
          {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
        </Form.Select>
        <Form.Control size="sm" placeholder="Naam" value={name}
          onChange={(e) => markDirty(setName)(e.target.value)}
          onBlur={() => { if (dirty && !saving) save(); }}
          className="flex-grow-1" />
        {dirty && (
          <Button size="sm" variant="outline-primary" className="p-0 px-2 lh-1" onClick={() => save()} disabled={saving}>
            {saving ? <Spinner size="sm" /> : "✓"}
          </Button>
        )}
        <Button size="sm" variant="outline-danger" className="p-0 px-1 lh-1" onClick={deleteIng}>✕</Button>
      </div>

      <div className="d-flex gap-1 align-items-center flex-wrap">
        <div className="flex-grow-1" style={{ minWidth: 160 }}>
          {ing.skip_linking ? (
            <div className="d-flex align-items-center gap-1">
              {linkStatus}
              <Button size="sm" variant="link" className="p-0 text-muted" style={{ fontSize: "0.7rem" }}
                onClick={() => linkProduct(null, false)}>Herstellen</Button>
            </div>
          ) : (
            <ProductSearchDropdown
              currentProduct={ing.linked_product}
              onSelect={(id) => linkProduct(id)}
              onClear={() => linkProduct(null)}
            />
          )}
        </div>
        {!ing.skip_linking && (
          <Button size="sm" variant="outline-secondary" className="p-0 px-2 lh-1 text-nowrap"
            style={{ fontSize: "0.7rem" }}
            onClick={() => linkProduct(null, true)}
            title="Markeer als niet nodig (bijv. water, zout)">
            N/A
          </Button>
        )}
        {linkStatus}
      </div>
    </div>
  );
}

// ─── EditMealModal ──────────────────────────────────────────────────────────────

