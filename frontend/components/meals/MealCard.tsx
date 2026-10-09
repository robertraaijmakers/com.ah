"use client";
import { useState } from "react";
import { mutate } from "swr";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import { MealCostModal } from "@/components/meals/MealCostModal";
import { api, fmtEur, type MealCost, type Meal, type FamilyMember } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { MEALS_KEY, fmt, formatQty } from "@/lib/meals";
import { Stars } from "@/components/meals/Stars";
import { EditMealModal } from "@/components/meals/EditMealModal";
import { ImportMealModal } from "@/components/meals/ImportMealModal";


export function MealCard({ meal, members, cost, onUpdated, onDeleted }: {
  meal: Meal;
  cost?: MealCost;
  members: FamilyMember[];
  onUpdated: (updated: Meal) => void;
  onDeleted: () => void;
}) {
  const { showToast } = useToast();
  const [showEdit, setShowEdit] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [showRate, setShowRate] = useState(false);
  const [ratingMember, setRatingMember] = useState(members[0]?.id ?? 0);
  const [rating, setRating] = useState(3);

  const avg = meal.ratings.length
    ? meal.ratings.reduce((s, r) => s + r.rating, 0) / meal.ratings.length
    : null;

  async function submitRating() {
    try {
      await api.post(`/meals/${meal.id}/rate`, { family_member_id: ratingMember, rating });
      mutate(MEALS_KEY);
      setShowRate(false);
      showToast("Beoordeling opgeslagen", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    }
  }

  async function deleteMeal() {
    if (!confirm(`Recept "${meal.name}" verwijderen?`)) return;
    try {
      await api.delete(`/meals/${meal.id}`);
      onDeleted();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  const unlinked = meal.ingredients.filter((i) => !i.linked_product && !i.skip_linking).length;

  return (
    <>
      {showCost && <MealCostModal mealId={meal.id} mealName={meal.name} onClose={() => setShowCost(false)} />}
      <Card className="h-100 shadow-sm" style={{ cursor: "default" }}>
        <Card.Body className="d-flex flex-column p-3">
          <div className="d-flex justify-content-between align-items-start mb-1">
            <button
              className="btn btn-link p-0 text-start fw-semibold text-dark text-decoration-none lh-sm"
              style={{ fontSize: "0.95rem" }}
              onClick={() => setShowEdit(true)}
            >
              {meal.name}
            </button>
            <Button variant="outline-danger" size="sm" className="p-0 px-1 lh-1 ms-2 flex-shrink-0"
              onClick={deleteMeal} style={{ fontSize: "0.7rem" }}>✕</Button>
          </div>

          <div className="d-flex flex-wrap gap-1 mb-2">
            {meal.category && (
              <Badge bg={meal.is_starter ? "info" : "primary"} className="fw-normal" style={{ fontSize: "0.65rem" }}>
                {meal.is_starter ? "↑ " : ""}{meal.category}
              </Badge>
            )}
            {meal.makes_leftovers && (
              <Badge bg="light" text="dark" className="border fw-normal" style={{ fontSize: "0.62rem" }}>restjes</Badge>
            )}
            {meal.tags.map((t) => (
              <Badge key={t} bg="light" text="dark" className="border fw-normal" style={{ fontSize: "0.62rem" }}>{t}</Badge>
            ))}
          </div>

          <div className="small text-muted mb-2">
            {meal.ingredients.length} ingrediënten
            {meal.portions_default > 1 && ` · ${meal.portions_default} personen`}
            {meal.nutrition?.energy_kcal != null && ` · ${fmt(meal.nutrition.energy_kcal / Math.max(1, meal.portions_default))} kcal/p`}
          </div>

          {cost && cost.priced > 0 && (
            <button
              className="btn btn-link p-0 text-start small mb-2 text-decoration-none"
              onClick={() => setShowCost(true)}
              title="Bekijk kostenspecificatie"
            >
              ≈ {fmtEur(cost.total)} <span className="text-muted">({cost.per_portion != null ? `${fmtEur(cost.per_portion)} p.p.` : ""}{cost.unpriced > 0 ? ` · ${cost.unpriced} onbekend` : ""})</span>
            </button>
          )}

          {meal.ingredients.length > 0 && (
            <ul className="list-unstyled mb-2" style={{ fontSize: "0.8rem" }}>
              {meal.ingredients.slice(0, 4).map((ing) => (
                <li key={ing.id} className="text-muted d-flex align-items-center gap-1">
                  <span>{formatQty(ing.quantity, ing.unit)} {ing.ingredient_name}</span>
                  {ing.skip_linking && <Badge bg="secondary" className="fw-normal" style={{ fontSize: "0.55rem" }}>N/A</Badge>}
                  {!ing.skip_linking && !ing.linked_product && <Badge bg="warning" text="dark" className="fw-normal" style={{ fontSize: "0.55rem" }}>!</Badge>}
                </li>
              ))}
              {meal.ingredients.length > 4 && (
                <li className="text-muted" style={{ fontSize: "0.75rem" }}>+{meal.ingredients.length - 4} meer…</li>
              )}
            </ul>
          )}

          <div className="mt-auto d-flex flex-wrap align-items-center gap-2">
            {avg !== null && <Stars value={Math.round(avg)} />}
            {unlinked > 0 && (
              <Badge bg="warning" text="dark" className="fw-normal" style={{ fontSize: "0.65rem" }}>
                {unlinked} ongekoppeld
              </Badge>
            )}
            <Button variant="outline-secondary" size="sm" className="ms-auto"
              style={{ fontSize: "0.75rem" }} onClick={() => setShowEdit(true)}>
              Bewerken
            </Button>
            <Button variant="outline-secondary" size="sm"
              style={{ fontSize: "0.75rem" }} onClick={() => setShowRate(!showRate)}>
              ★
            </Button>
          </div>

          {showRate && (
            <div className="border-top pt-2 mt-2">
              <Form.Select size="sm" className="mb-2" value={ratingMember}
                onChange={(e) => setRatingMember(Number(e.target.value))}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Form.Select>
              <Stars value={rating} onChange={setRating} />
              <Button size="sm" className="btn-ah mt-2" onClick={submitRating}>Opslaan</Button>
            </div>
          )}
        </Card.Body>
      </Card>

      {showEdit && (
        <EditMealModal
          meal={meal}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { onUpdated(updated); setShowEdit(false); }}
          onMealChanged={onUpdated}
        />
      )}
    </>
  );
}

// ─── ImportMealModal ────────────────────────────────────────────────────────────

