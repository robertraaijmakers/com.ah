"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import ListGroup from "react-bootstrap/ListGroup";
import Spinner from "react-bootstrap/Spinner";
import { api, type ShoppingList } from "@/lib/api";
import { useToast } from "@/lib/toast";

function ShoppingContent() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const listId = searchParams.get("list");
  const key = listId ? `/shopping/${listId}` : null;

  const { data: list, isLoading, error } = useSWR(key, () => api.get<ShoppingList>(key!));

  async function checkItem(id: number, checked: boolean) {
    try {
      await api.patch(`/shopping/${listId}/items/${id}/check?checked=${checked}`);
      mutate(key);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    }
  }

  async function markBought(id: number) {
    try {
      await api.post<{ ok: boolean; added_to_pantry: boolean }>(`/shopping/${listId}/items/${id}/bought`);
      mutate(key);
      showToast("Toegevoegd aan voorraad", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    }
  }

  if (!listId) {
    return (
      <Alert variant="info" className="mt-4">
        <Alert.Heading>Geen boodschappenlijst geselecteerd</Alert.Heading>
        <p className="mb-0">Ga naar <a href="/plans">Plannen</a> en klik &apos;Boodschappenlijst genereren&apos;.</p>
      </Alert>
    );
  }

  if (isLoading) return <div className="text-center py-5"><Spinner /></div>;
  if (error) return <Alert variant="danger">Fout: {error.message}</Alert>;
  if (!list) return <Alert variant="warning">Lijst niet gevonden</Alert>;

  const unchecked = list.items.filter((i) => !i.is_checked);
  const checked = list.items.filter((i) => i.is_checked);
  const bonusCount = list.items.filter((i) => i.is_bonus).length;

  return (
    <>
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div>
          <h1 className="h3 mb-0">Boodschappenlijst</h1>
          <small className="text-muted">
            {unchecked.length} items over
            {list.total_estimated && ` · ≈ €${Number(list.total_estimated).toFixed(2)}`}
            {bonusCount > 0 && ` · ${bonusCount} bonus`}
          </small>
        </div>
      </div>

      <Card className="shadow-sm mb-3">
        <ListGroup variant="flush">
          {unchecked.map((item) => (
            <ListGroup.Item key={item.id} className="d-flex align-items-center gap-3 py-3">
              <input
                type="checkbox"
                className="form-check-input mt-0"
                checked={false}
                onChange={() => checkItem(item.id, true)}
              />
              <div className="flex-grow-1">
                <span className="fw-medium">
                  {item.ingredient_name}
                  {item.is_bonus && (
                    <Badge bg="danger" className="ms-2">BONUS</Badge>
                  )}
                </span>
                <div className="text-muted small">
                  {Number(item.quantity).toFixed(1)} {item.unit}
                  {item.from_pantry_quantity > 0 && ` · ${item.from_pantry_quantity} uit voorraad`}
                  {item.reasoning && ` · ${item.reasoning}`}
                </div>
              </div>
              {item.estimated_price && (
                <span className="text-muted small">€{Number(item.estimated_price).toFixed(2)}</span>
              )}
              <Button variant="outline-success" size="sm" onClick={() => markBought(item.id)}>
                Gekocht ✓
              </Button>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Card>

      {checked.length > 0 && (
        <>
          <p className="text-muted small mb-1">Gekocht ({checked.length})</p>
          <Card className="shadow-sm opacity-50">
            <ListGroup variant="flush">
              {checked.map((item) => (
                <ListGroup.Item key={item.id} className="d-flex align-items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    className="form-check-input mt-0"
                    checked
                    onChange={() => checkItem(item.id, false)}
                  />
                  <span className="text-decoration-line-through text-muted flex-grow-1 small">
                    {item.ingredient_name}
                  </span>
                  <span className="text-muted small">
                    {Number(item.quantity).toFixed(1)} {item.unit}
                  </span>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </Card>
        </>
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
