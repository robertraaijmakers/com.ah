"use client";
import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import InputGroup from "react-bootstrap/InputGroup";
import ListGroup from "react-bootstrap/ListGroup";
import Modal from "react-bootstrap/Modal";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import Tab from "react-bootstrap/Tab";
import Tabs from "react-bootstrap/Tabs";
import { api, type Meal, type MealIngredient, type MealNutrition, type LinkedProduct, type FamilyMember } from "@/lib/api";
import { useToast } from "@/lib/toast";

const MEALS_KEY = "/meals/";
const FAMILY_KEY = "/family/";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatQty(qty: number | null, unit: string | null): string {
  if (!qty && qty !== 0) return unit ?? "";
  const clean = qty % 1 === 0 ? String(Math.round(qty)) : String(qty);
  return unit ? `${clean} ${unit}` : clean;
}

const UNIT_OPTIONS = ["g", "kg", "ml", "l", "stuks", "el", "tl", "snufje", "teen", "bos", "plak", "blokje"];

// ─── NutritionTable ────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined): string {
  if (v == null) return "–";
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
}

function NutritionTable({ nutrition, portions }: { nutrition: MealNutrition; portions: number }) {
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

interface Suggestion { id: number; name: string; brand: string | null; }

function ProductSearchDropdown({
  onSelect,
  onClear,
  currentProduct,
}: {
  onSelect: (id: number) => void;
  onClear: () => void;
  currentProduct: LinkedProduct | null;
}) {
  const [input, setInput] = useState(currentProduct?.name ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [show, setShow] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInput = useCallback((val: string) => {
    setInput(val);
    if (debounce.current) clearTimeout(debounce.current);
    if (val.length < 2) { setSuggestions([]); setShow(false); return; }
    debounce.current = setTimeout(() => {
      api.get<Suggestion[]>(`/products/suggest?q=${encodeURIComponent(val)}&limit=8`)
        .then((s) => { setSuggestions(s); setShow(true); })
        .catch(() => {});
    }, 200);
  }, []);

  return (
    <div className="position-relative">
      <InputGroup size="sm">
        <Form.Control
          placeholder="Zoek product..."
          value={input}
          onChange={(e) => handleInput(e.target.value)}
          onBlur={() => setTimeout(() => setShow(false), 150)}
          style={{ fontSize: "0.8rem" }}
        />
        {currentProduct && (
          <Button variant="outline-secondary" size="sm" onClick={() => { setInput(""); onClear(); }}>✕</Button>
        )}
      </InputGroup>
      {show && suggestions.length > 0 && (
        <ListGroup className="position-absolute w-100 shadow-sm" style={{ zIndex: 9999, top: "100%", maxHeight: 200, overflowY: "auto" }}>
          {suggestions.map((s) => (
            <ListGroup.Item key={s.id} action onMouseDown={() => { setInput(s.name); setShow(false); onSelect(s.id); }}
              className="py-1 px-2" style={{ fontSize: "0.78rem" }}>
              {s.name}{s.brand && <span className="text-muted ms-1">({s.brand})</span>}
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </div>
  );
}

// ─── Stars ─────────────────────────────────────────────────────────────────────

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
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

function IngredientEditRow({ ing, mealId, onUpdated, onDeleted }: {
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

function EditMealModal({ meal, onClose, onSaved, onMealChanged }: {
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
    <Modal show onHide={onClose} size="xl" scrollable>
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

function MealCard({ meal, members, onUpdated, onDeleted }: {
  meal: Meal;
  members: FamilyMember[];
  onUpdated: (updated: Meal) => void;
  onDeleted: () => void;
}) {
  const { showToast } = useToast();
  const [showEdit, setShowEdit] = useState(false);
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
            {meal.estimated_price && ` · ≈ €${Number(meal.estimated_price).toFixed(2)}`}
            {meal.nutrition?.energy_kcal != null && ` · ${fmt(meal.nutrition.energy_kcal / Math.max(1, meal.portions_default))} kcal/p`}
          </div>

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

interface ImportMatchNote {
  ingredient_name: string;
  matched: boolean;
  product_name: string | null;
  product_id: number | null;
}

interface ImportResult {
  meal: Meal;
  match_notes: ImportMatchNote[];
}

function ImportMealModal({ onClose, onImported }: { onClose: () => void; onImported: (m: Meal) => void }) {
  const { showToast } = useToast();
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function doImport() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await api.post<ImportResult>("/meals/import-text", {
        text: text.trim(),
        category: category.trim() || null,
      });
      setResult(res);
      onImported(res.meal);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Import mislukt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal show onHide={onClose} size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="h5">Recept importeren</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!result ? (
          <>
            <p className="text-muted small mb-3">
              Plak de tekst van een recept (bijv. vanuit OneNote). De AI parseert ingrediënten,
              hoeveelheden en bereiding, en koppelt automatisch producten.
            </p>
            <Form.Group className="mb-3">
              <Form.Label className="small fw-semibold">Categorie (optioneel override)</Form.Label>
              <Form.Control size="sm" placeholder="bijv. Soep, Pasta, Vlees…"
                value={category} onChange={(e) => setCategory(e.target.value)} />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small fw-semibold">Recepttekst</Form.Label>
              <Form.Control as="textarea" rows={12} value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"Naam van het recept\n\nIngrediënten:\n- 500g …\n\nBereiding:\n…"}
                style={{ fontFamily: "monospace", fontSize: "0.82rem" }} />
            </Form.Group>
          </>
        ) : (
          <>
            <Alert variant="success" className="mb-3">
              <strong>{result.meal.name}</strong> aangemaakt!
              {result.meal.category && <span className="ms-2 text-muted">({result.meal.category})</span>}
            </Alert>
            <p className="small fw-semibold mb-2">
              Productkoppelingen ({result.match_notes.filter(n => n.matched).length}/{result.match_notes.length} gevonden):
            </p>
            <ListGroup variant="flush" className="small mb-0">
              {result.match_notes.map((n, i) => (
                <ListGroup.Item key={i} className="px-0 py-1 d-flex align-items-center gap-2">
                  <span style={{ width: 16 }}>{n.matched ? "✅" : "⚠️"}</span>
                  <span className="fw-semibold" style={{ minWidth: 160 }}>{n.ingredient_name}</span>
                  {n.matched
                    ? <span className="text-muted">{n.product_name}</span>
                    : <span className="text-danger">niet gevonden</span>}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" size="sm" onClick={onClose}>{result ? "Sluiten" : "Annuleer"}</Button>
        {!result && (
          <Button className="btn-ah" size="sm" onClick={doImport} disabled={loading || !text.trim()}>
            {loading ? <><Spinner size="sm" className="me-1" />AI aan het werk…</> : "Importeren"}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────────

export default function MealsPage() {
  const { data: allMeals, isLoading, error, mutate: mutateMeals } = useSWR(
    MEALS_KEY, () => api.get<Meal[]>(MEALS_KEY)
  );
  const { data: members } = useSWR(FAMILY_KEY, () => api.get<FamilyMember[]>(FAMILY_KEY));
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
