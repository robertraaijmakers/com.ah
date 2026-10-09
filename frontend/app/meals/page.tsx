"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api, type Meal, type FamilyMember, type MealCost } from "@/lib/api";
import { FAMILY_KEY, MEALS_KEY } from "@/lib/meals";
import { MealCard } from "@/components/meals/MealCard";
import { ImportMealModal } from "@/components/meals/ImportMealModal";


export default function MealsPage() {
  const { data: allMeals, isLoading, error, mutate: mutateMeals } = useSWR(
    MEALS_KEY, () => api.get<Meal[]>(MEALS_KEY)
  );
  const { data: members } = useSWR(FAMILY_KEY, () => api.get<FamilyMember[]>(FAMILY_KEY));
  const { data: costs } = useSWR("/meals/costs", (u: string) => api.get<Record<number, MealCost>>(u));
  const [showImport, setShowImport] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = Array.from(new Set((allMeals ?? []).map((m) => m.category).filter(Boolean) as string[])).sort();

  const meals = activeCategory
    ? (allMeals ?? []).filter((m) => m.category === activeCategory)
    : (allMeals ?? []);

  function updateMeal(updated: Meal) {
    mutateMeals((prev) => prev ? prev.map((m) => m.id === updated.id ? updated : m) : prev, false);
  }

  function removeMeal(id: number) {
    mutateMeals((prev) => prev ? prev.filter((m) => m.id !== id) : prev, false);
  }

  function addMeal(meal: Meal) {
    mutateMeals((prev) => prev ? [...prev, meal] : [meal], false);
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Recepten</h1>
        <Button variant="outline-secondary" size="sm" onClick={() => setShowImport(true)}>
          📋 Importeren
        </Button>
      </div>

      {/* Category filter */}
      {categories.length > 0 && (
        <div className="d-flex flex-wrap gap-1 mb-3">
          <Button
            size="sm"
            variant={activeCategory === null ? "secondary" : "outline-secondary"}
            onClick={() => setActiveCategory(null)}
            style={{ fontSize: "0.78rem" }}
          >
            Alles ({allMeals?.length ?? 0})
          </Button>
          {categories.map((cat) => {
            const count = (allMeals ?? []).filter((m) => m.category === cat).length;
            const isStarter = (allMeals ?? []).find((m) => m.category === cat)?.is_starter;
            return (
              <Button
                key={cat}
                size="sm"
                variant={activeCategory === cat ? (isStarter ? "info" : "primary") : "outline-secondary"}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                style={{ fontSize: "0.78rem" }}
              >
                {isStarter ? "↑ " : ""}{cat} ({count})
              </Button>
            );
          })}
        </div>
      )}

      {error && <Alert variant="danger">Kon recepten niet laden: {error.message}</Alert>}
      {isLoading && <div className="text-center py-5"><Spinner /></div>}

      <Row xs={1} md={2} lg={3} className="g-3">
        {meals.map((m) => (
          <Col key={m.id}>
            <MealCard
              meal={m}
              members={members || []}
              cost={costs?.[m.id]}
              onUpdated={updateMeal}
              onDeleted={() => removeMeal(m.id)}
            />
          </Col>
        ))}
      </Row>

      {showImport && (
        <ImportMealModal
          onClose={() => setShowImport(false)}
          onImported={(meal) => { addMeal(meal); setShowImport(false); }}
        />
      )}
    </>
  );
}
