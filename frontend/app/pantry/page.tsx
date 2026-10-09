"use client";
import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import ListGroup from "react-bootstrap/ListGroup";
import Modal from "react-bootstrap/Modal";
import Spinner from "react-bootstrap/Spinner";
import { api, daysUntil, fmtDate, fmtQty, type PantryItem } from "@/lib/api";
import { useToast } from "@/lib/toast";

const KEY = "/pantry/";

interface Suggestion { id: number; name: string; brand: string | null }

function expiryBadge(iso: string | null) {
  if (!iso) return null;
  const d = daysUntil(iso);
  if (d < 0) return <Badge bg="danger" className="ms-2">verlopen</Badge>;
  if (d <= 3) return <Badge bg="warning" text="dark" className="ms-2">{d === 0 ? "vandaag" : `nog ${d} dag${d === 1 ? "" : "en"}`}</Badge>;
  return null;
}

export default function PantryPage() {
  const { showToast } = useToast();
  const { data: items, isLoading, error } = useSWR(KEY, () => api.get<PantryItem[]>(KEY));

  // add form
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("stuks");
  const [expiry, setExpiry] = useState("");

  // edit modal
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [eQty, setEQty] = useState("");
  const [eUnit, setEUnit] = useState("");
  const [eExpiry, setEExpiry] = useState("");

  useEffect(() => {
    if (picked || query.trim().length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      api.get<Suggestion[]>(`/products/suggest?q=${encodeURIComponent(query.trim())}`)
        .then(setSuggestions).catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, picked]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    try {
      await api.post(KEY, {
        product_id: picked.id,
        quantity: Number(qty.replace(",", ".")) || 1,
        unit: unit.trim() || "stuks",
        expires_at: expiry || null,
      });
      setPicked(null); setQuery(""); setQty("1"); setExpiry("");
      mutate(KEY);
      showToast(`${picked.name} toegevoegd`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Toevoegen mislukt");
    }
  }

  async function remove(item: PantryItem) {
    if (!confirm(`"${item.product.name}" uit de voorraad verwijderen?`)) return;
    try {
      await api.delete(`/pantry/${item.id}`);
      mutate(KEY);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  async function consume(id: number) {
    try {
      await api.patch(`/pantry/${id}/consume?quantity=1`);
      mutate(KEY);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    }
  }

  function startEdit(item: PantryItem) {
    setEditing(item);
    setEQty(String(Number(item.quantity)));
    setEUnit(item.unit);
    setEExpiry(item.expires_at ?? "");
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api.patch(`${KEY}${editing.id}`, {
        quantity: Number(eQty.replace(",", ".")),
        unit: eUnit.trim() || editing.unit,
        expires_at: eExpiry || null,
        clear_expiry: !eExpiry,
      });
      setEditing(null);
      mutate(KEY);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    }
  }

  const expiring = items?.filter((p) => p.expires_at && daysUntil(p.expires_at) <= 3);

  return (
    <>
      <h1 className="h3 mb-1">Voorraad</h1>
      <p className="text-muted small mb-3">
        Items komen automatisch bij je voorraad als je ze op de boodschappenlijst afvinkt. Zelf iets toevoegen kan hieronder.
      </p>

      <Card className="shadow-sm mb-3">
        <Card.Body>
          <Form onSubmit={add} className="d-flex gap-2 flex-wrap align-items-start">
            <div className="flex-grow-1 position-relative" style={{ minWidth: 220 }}>
              <Form.Control
                aria-label="Product zoeken"
                placeholder="Product toevoegen: zoek op naam…"
                value={picked ? picked.name : query}
                onChange={(e) => { setPicked(null); setQuery(e.target.value); }}
              />
              {suggestions.length > 0 && (
                <ListGroup className="position-absolute w-100 shadow" style={{ zIndex: 20 }}>
                  {suggestions.map((s) => (
                    <ListGroup.Item action key={s.id} onClick={() => { setPicked(s); setSuggestions([]); }}>
                      {s.name}{s.brand ? <span className="text-muted small"> · {s.brand}</span> : null}
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </div>
            <Form.Control aria-label="Hoeveelheid" style={{ maxWidth: 80 }} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            <Form.Control aria-label="Eenheid" style={{ maxWidth: 100 }} value={unit} onChange={(e) => setUnit(e.target.value)} />
            <Form.Control aria-label="Houdbaar tot" type="date" style={{ maxWidth: 160 }} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            <Button type="submit" className="btn-ah" disabled={!picked}>Toevoegen</Button>
          </Form>
        </Card.Body>
      </Card>

      {error && <Alert variant="danger">Kon voorraad niet laden: {error.message}</Alert>}
      {isLoading && <div className="text-center py-5"><Spinner /></div>}

      {expiring && expiring.length > 0 && (
        <Alert variant="warning" className="mb-3">
          <Alert.Heading className="h6">Bijna verlopen</Alert.Heading>
          {expiring.map((p) => (
            <div key={p.id} className="d-flex justify-content-between small">
              <span>{p.product.name}</span>
              <span className="fw-semibold">{fmtDate(p.expires_at!)}</span>
            </div>
          ))}
        </Alert>
      )}

      <Card className="shadow-sm">
        <ListGroup variant="flush">
          {items?.length === 0 && (
            <ListGroup.Item className="text-center text-muted py-5">Voorraad is leeg</ListGroup.Item>
          )}
          {items?.map((item) => (
            <ListGroup.Item key={item.id} className="d-flex align-items-center gap-3 py-3 flex-wrap">
              {item.product.image_url && (
                <img src={item.product.image_url} alt={item.product.name} width={40} height={40} style={{ objectFit: "contain", borderRadius: 4 }} />
              )}
              <div className="flex-grow-1">
                <div className="fw-medium small">{item.product.name}{expiryBadge(item.expires_at)}</div>
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                  {fmtQty(item.quantity)} {item.unit}
                  {item.expires_at && ` · houdbaar tot ${fmtDate(item.expires_at)}`}
                </div>
              </div>
              <Button variant="outline-secondary" size="sm" onClick={() => consume(item.id)}>Gebruik 1</Button>
              <Button variant="outline-secondary" size="sm" onClick={() => startEdit(item)}>Wijzig</Button>
              <Button variant="outline-danger" size="sm" onClick={() => remove(item)}>Verwijder</Button>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Card>

      <Modal fullscreen="sm-down" show={!!editing} onHide={() => setEditing(null)} centered>
        <Modal.Header closeButton><Modal.Title className="h6">{editing?.product.name}</Modal.Title></Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <div className="d-flex gap-2">
            <div>
              <Form.Label className="small">Hoeveelheid</Form.Label>
              <Form.Control inputMode="decimal" value={eQty} onChange={(e) => setEQty(e.target.value)} />
            </div>
            <div>
              <Form.Label className="small">Eenheid</Form.Label>
              <Form.Control value={eUnit} onChange={(e) => setEUnit(e.target.value)} />
            </div>
          </div>
          <div>
            <Form.Label className="small">Houdbaar tot (leeg = geen datum)</Form.Label>
            <Form.Control type="date" value={eExpiry} onChange={(e) => setEExpiry(e.target.value)} />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setEditing(null)}>Annuleer</Button>
          <Button className="btn-ah" onClick={saveEdit}>Opslaan</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
