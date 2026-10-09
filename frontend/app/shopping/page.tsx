"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import ListGroup from "react-bootstrap/ListGroup";
import Spinner from "react-bootstrap/Spinner";
import { api, fmtEur, fmtQty, type BuyAdvice, type ShoppingList, type ShoppingListItem } from "@/lib/api";
import { useToast } from "@/lib/toast";

const NO_CATEGORY = "Overig";

function ShoppingContent() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const listId = searchParams.get("list");
  const key = listId ? `/shopping/${listId}` : "/shopping/latest";

  const { data: list, isLoading, error } = useSWR(key, () => api.get<ShoppingList>(key), { shouldRetryOnError: false });
  const { data: advice } = useSWR("/advice/", () => api.get<BuyAdvice[]>("/advice/"));

  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newUnit, setNewUnit] = useState("stuks");
  const [adding, setAdding] = useState(false);

  const alertByProduct = useMemo(() => {
    const m = new Map<number, BuyAdvice>();
    (advice ?? []).forEach((a) => m.set(a.product_id, a));
    return m;
  }, [advice]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ShoppingListItem[]>();
    (list?.items ?? []).filter((i) => !i.is_checked).forEach((i) => {
      const cat = i.category || NO_CATEGORY;
      groups.set(cat, [...(groups.get(cat) ?? []), i]);
    });
    return [...groups.entries()].sort(([a], [b]) =>
      a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b, "nl"));
  }, [list]);

  async function toggle(item: ShoppingListItem) {
    if (!list) return;
    try {
      if (item.is_checked) {
        await api.post(`/shopping/${list.id}/items/${item.id}/unbought`);
      } else {
        const r = await api.post<{ ok: boolean; added_to_pantry: boolean }>(`/shopping/${list.id}/items/${item.id}/bought`);
        if (r.added_to_pantry) showToast("Toegevoegd aan voorraad", "success");
      }
      mutate(key);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    }
  }

  async function removeItem(item: ShoppingListItem) {
    if (!list) return;
    try {
      await api.delete(`/shopping/${list.id}/items/${item.id}`);
      mutate(key);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!list || !newName.trim()) return;
    setAdding(true);
    try {
      await api.post(`/shopping/${list.id}/items`, {
        ingredient_name: newName.trim(),
        quantity: Number(newQty.replace(",", ".")) || 1,
        unit: newUnit.trim() || "stuks",
      });
      setNewName(""); setNewQty("1");
      mutate(key);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      setAdding(false);
    }
  }

  if (isLoading) return <div className="text-center py-5"><Spinner /></div>;

  if (error || !list) {
    const empty = !listId && error && /nog geen/i.test(error.message);
    return (
      <Alert variant={empty ? "info" : "danger"} className="mt-4">
        <Alert.Heading>{empty ? "Nog geen boodschappenlijst" : "Lijst niet beschikbaar"}</Alert.Heading>
        <p className="mb-0">
          {empty
            ? <>Ga naar <Link href="/plans">Plannen</Link> en klik &apos;Boodschappenlijst genereren&apos;.</>
            : error?.message ?? "Lijst niet gevonden"}
        </p>
      </Alert>
    );
  }

  const checked = list.items.filter((i) => i.is_checked);
  const open = list.items.length - checked.length;
  const bonusCount = list.items.filter((i) => i.is_bonus && !i.is_checked).length;
  const alertsOnList = list.items.filter((i) => !i.is_checked && i.product_id && alertByProduct.has(i.product_id));
  const pct = list.items.length ? Math.round((checked.length / list.items.length) * 100) : 0;

  return (
    <>
      <div className="d-flex justify-content-between align-items-start mb-3 gap-2 flex-wrap">
        <div>
          <h1 className="h3 mb-0">Boodschappenlijst</h1>
          <small className="text-muted">
            {open} {open === 1 ? "item" : "items"} over
            {list.total_estimated ? ` · ≈ ${fmtEur(list.total_estimated)}` : ""}
            {bonusCount > 0 && ` · ${bonusCount} in de bonus`}
          </small>
        </div>
        <Button variant="outline-secondary" size="sm" className="d-print-none" onClick={() => window.print()}>
          Print / bewaar als PDF
        </Button>
      </div>

      {list.items.length > 0 && (
        <div className="progress mb-3 d-print-none" style={{ height: 6 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Voortgang boodschappen">
          <div className="progress-bar bg-success" style={{ width: `${pct}%` }} />
        </div>
      )}

      {alertsOnList.length > 0 && (
        <Alert variant="success" className="py-2 small">
          <strong>Prijsalert:</strong> {alertsOnList.map((i) => {
            const a = alertByProduct.get(i.product_id!)!;
            return `${i.ingredient_name} (${a.savings_pct ? `-${Math.round(Number(a.savings_pct))}%` : "bonus"}, nu ${fmtEur(a.current_price)})`;
          }).join(", ")}
        </Alert>
      )}

      <Form onSubmit={addItem} className="d-flex gap-2 mb-3 d-print-none" aria-label="Item toevoegen">
        <Form.Control aria-label="Naam" placeholder="Extra item toevoegen (bijv. melk)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Form.Control aria-label="Hoeveelheid" style={{ maxWidth: 80 }} inputMode="decimal" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
        <Form.Control aria-label="Eenheid" style={{ maxWidth: 100 }} value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
        <Button type="submit" className="btn-ah" disabled={adding || !newName.trim()}>Toevoegen</Button>
      </Form>

      {open === 0 && list.items.length > 0 && (
        <Alert variant="success">Alles gekocht! 🎉</Alert>
      )}

      {grouped.map(([cat, items]) => (
        <Card key={cat} className="shadow-sm mb-3">
          <Card.Header className="bg-white small fw-semibold text-uppercase text-muted">{cat}</Card.Header>
          <ListGroup variant="flush">
            {items.map((item) => {
              const alertInfo = item.product_id ? alertByProduct.get(item.product_id) : undefined;
              return (
                <ListGroup.Item key={item.id} className="d-flex align-items-center gap-3 py-3">
                  <input
                    type="checkbox"
                    className="form-check-input mt-0"
                    style={{ width: 22, height: 22 }}
                    checked={false}
                    onChange={() => toggle(item)}
                    aria-label={`${item.ingredient_name} als gekocht markeren`}
                  />
                  <div className="flex-grow-1">
                    <span className="fw-medium">
                      {item.ingredient_name}
                      {item.is_bonus && <Badge bg="danger" className="ms-2">BONUS</Badge>}
                      {alertInfo && !item.is_bonus && <Badge bg="success" className="ms-2">Prijsalert</Badge>}
                    </span>
                    <div className="text-muted small">
                      {fmtQty(item.quantity)} {item.unit}
                      {item.from_pantry_quantity > 0 && ` · ${fmtQty(item.from_pantry_quantity)} uit voorraad`}
                      {!item.product_id && " · geen AH-product gekoppeld"}
                    </div>
                  </div>
                  {item.estimated_price != null && (
                    <span className="text-muted small">{fmtEur(item.estimated_price)}</span>
                  )}
                  <Button variant="link" size="sm" className="text-muted p-0 d-print-none" onClick={() => removeItem(item)} aria-label={`${item.ingredient_name} verwijderen`}>✕</Button>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        </Card>
      ))}

      {checked.length > 0 && (
        <div className="d-print-none">
          <p className="text-muted small mb-1">Gekocht ({checked.length})</p>
          <Card className="shadow-sm opacity-75">
            <ListGroup variant="flush">
              {checked.map((item) => (
                <ListGroup.Item key={item.id} className="d-flex align-items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    className="form-check-input mt-0"
                    checked
                    onChange={() => toggle(item)}
                    aria-label={`${item.ingredient_name} terugzetten op de lijst`}
                  />
                  <span className="text-decoration-line-through text-muted flex-grow-1 small">{item.ingredient_name}</span>
                  <span className="text-muted small">{fmtQty(item.quantity)} {item.unit}</span>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </Card>
        </div>
      )}
    </>
  );
}

export default function ShoppingPage() {
  return (
    <Suspense fallback={<div className="text-center py-5"><Spinner /></div>}>
      <ShoppingContent />
    </Suspense>
  );
}
