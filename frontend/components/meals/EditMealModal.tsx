"use client";
import { useState } from "react";
import Button from "react-bootstrap/Button";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import Tab from "react-bootstrap/Tab";
import Tabs from "react-bootstrap/Tabs";
import { api, type Meal, type MealIngredient } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { NutritionTable } from "@/components/meals/NutritionTable";
import { Stars } from "@/components/meals/Stars";
import { IngredientEditRow } from "@/components/meals/IngredientEditRow";
import { MealCard } from "@/components/meals/MealCard";


export function EditMealModal({ meal, onClose, onSaved, onMealChanged }: {
  meal: Meal;
  onClose: () => void;
  onSaved: (updated: Meal) => void;
  onMealChanged?: (updated: Meal) => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState(meal.name);
  const [category, setCategory] = useState(meal.category ?? "");
  const [instructions, setInstructions] = useState(meal.instructions ?? "");
  const [portions, setPortions] = useState(String(meal.portions_default));
  const [tags, setTags] = useState(meal.tags.join(", "));
  const [nutritionScore, setNutritionScore] = useState(meal.nutrition_score ?? 3);
  const [makesLeftovers, setMakesLeftovers] = useState(meal.makes_leftovers);
  const [ingredients, setIngredients] = useState<MealIngredient[]>(meal.ingredients);
  const [savingMeta, setSavingMeta] = useState(false);

  async function saveMeta() {
    setSavingMeta(true);
    try {
      const updated = await api.patch<Meal>(`/meals/${meal.id}`, {
        name: name.trim(),
        category: category.trim() || null,
        instructions: instructions.trim() || null,
        portions_default: parseInt(portions) || 4,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        nutrition_score: nutritionScore,
        makes_leftovers: makesLeftovers,
      });
      onSaved(updated);
      showToast("Recept opgeslagen", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSavingMeta(false);
    }
  }

  async function addIngredient() {
    try {
      const newIng = await api.post<MealIngredient>(`/meals/${meal.id}/ingredients`, {
        ingredient_name: "Nieuw ingrediënt",
        quantity: null,
        unit: null,
      });
      const newIngredients = [...ingredients, newIng];
      setIngredients(newIngredients);
      onMealChanged?.({ ...meal, ingredients: newIngredients });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Toevoegen mislukt");
    }
  }

  function updateIngredient(id: number, updated: MealIngredient) {
    const newIngredients = ingredients.map((i) => i.id === id ? updated : i);
    setIngredients(newIngredients);
    onMealChanged?.({ ...meal, ingredients: newIngredients });
  }

  function removeIngredient(id: number) {
    const newIngredients = ingredients.filter((i) => i.id !== id);
    setIngredients(newIngredients);
    onMealChanged?.({ ...meal, ingredients: newIngredients });
  }

  const unlinked = ingredients.filter((i) => !i.linked_product && !i.skip_linking).length;

  return (
    <Modal fullscreen="sm-down" show onHide={onClose} size="xl" scrollable>
      <Modal.Header closeButton>
        <div className="w-100 me-3">
          <Form.Control
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="fw-semibold h5 border-0 border-bottom rounded-0 px-0"
            style={{ fontSize: "1.1rem", boxShadow: "none" }}
          />
        </div>
      </Modal.Header>
      <Modal.Body className="p-0">
        <Tabs defaultActiveKey="meta" className="px-3 pt-2 border-bottom">
          <Tab eventKey="meta" title="Basis">
            <div className="p-3">
              <Row className="g-3 mb-3">
                <Col md={4}>
                  <Form.Label className="small fw-semibold">Categorie</Form.Label>
                  <Form.Control size="sm" value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Soep, Pasta, Vlees…" />
                  {meal.is_starter && (
                    <Form.Text className="text-info">Wordt als voorgerecht gezien (geen volledig diner)</Form.Text>
                  )}
                </Col>
                <Col md={2}>
                  <Form.Label className="small fw-semibold">Porties</Form.Label>
                  <Form.Control size="sm" type="number" min={1} value={portions}
                    onChange={(e) => setPortions(e.target.value)} />
                </Col>
                <Col md={6}>
                  <Form.Label className="small fw-semibold">Tags</Form.Label>
                  <Form.Control size="sm" value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="vegetarisch, pasta, snel" />
                </Col>
                <Col md={6}>
                  <Form.Label className="small fw-semibold">Gezondheidscore</Form.Label>
                  <div><Stars value={nutritionScore} onChange={setNutritionScore} /></div>
                </Col>
                <Col md={6} className="d-flex align-items-end">
                  <Form.Check label="Maakt restjes" checked={makesLeftovers}
                    onChange={(e) => setMakesLeftovers(e.target.checked)} />
                </Col>
              </Row>
              {meal.nutrition && (
                <div className="border-top pt-3 mt-1">
                  <NutritionTable nutrition={meal.nutrition} portions={meal.portions_default} />
                </div>
              )}
            </div>
          </Tab>

          <Tab eventKey="instructions" title="Bereiding">
            <div className="p-3">
              <Form.Control
                as="textarea"
                rows={14}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                style={{ fontFamily: "inherit", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}
                placeholder="Stap 1. …"
              />
            </div>
          </Tab>

          <Tab eventKey="ingredients" title={`Ingrediënten ${unlinked > 0 ? `(${unlinked} ongekoppeld)` : ""}`}>
            <div className="p-3">
              {ingredients.map((ing) => (
                <IngredientEditRow
                  key={ing.id}
                  ing={ing}
                  mealId={meal.id}
                  onUpdated={(updated) => updateIngredient(ing.id, updated)}
                  onDeleted={() => removeIngredient(ing.id)}
                />
              ))}
              <Button variant="outline-secondary" size="sm" onClick={addIngredient}>
                + Ingrediënt toevoegen
              </Button>
            </div>
          </Tab>
        </Tabs>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" size="sm" onClick={onClose}>Sluiten</Button>
        <Button className="btn-ah" size="sm" onClick={saveMeta} disabled={savingMeta}>
          {savingMeta && <Spinner size="sm" className="me-1" />}Opslaan
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// ─── MealCard ───────────────────────────────────────────────────────────────────

