"use client";
import { useState } from "react";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import ListGroup from "react-bootstrap/ListGroup";
import Modal from "react-bootstrap/Modal";
import Spinner from "react-bootstrap/Spinner";
import { api, type Meal } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { ImportResult } from "@/lib/meals";


export function ImportMealModal({ onClose, onImported }: { onClose: () => void; onImported: (m: Meal) => void }) {
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

