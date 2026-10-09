"use client";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import ListGroup from "react-bootstrap/ListGroup";
import Spinner from "react-bootstrap/Spinner";
import { api, type PantryItem } from "@/lib/api";
import { useToast } from "@/lib/toast";

const KEY = "/pantry/";

export default function PantryPage() {
  const { showToast } = useToast();
  const { data: items, isLoading, error } = useSWR(KEY, () => api.get<PantryItem[]>(KEY));

  async function remove(id: number) {
    try {
      await api.delete(`/pantry/${id}`);
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

  const today = new Date();
  const expiring = items?.filter((p) => {
    if (!p.expires_at) return false;
    return (new Date(p.expires_at).getTime() - today.getTime()) / 86400000 <= 3;
  });

  return (
    <>
      <h1 className="h3 mb-1">Voorraad</h1>
      <p className="text-muted small mb-4">
        Items worden automatisch toegevoegd als je &apos;Gekocht&apos; klikt op de boodschappenlijst.
      </p>

      {error && <Alert variant="danger">Kon voorraad niet laden: {error.message}</Alert>}
      {isLoading && <div className="text-center py-5"><Spinner /></div>}

      {expiring && expiring.length > 0 && (
        <Alert variant="warning" className="mb-3">
          <Alert.Heading className="h6">Bijna verlopen</Alert.Heading>
          {expiring.map((p) => (
            <div key={p.id} className="d-flex justify-content-between small">
              <span>{p.product.name}</span>
              <span className="fw-semibold">{p.expires_at}</span>
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
            <ListGroup.Item key={item.id} className="d-flex align-items-center gap-3 py-3">
              {item.product.image_url && (
                <img
                  src={item.product.image_url}
                  alt=""
                  width={40}
                  height={40}
                  style={{ objectFit: "contain", borderRadius: 4 }}
                />
              )}
              <div className="flex-grow-1">
                <div className="fw-medium small">{item.product.name}</div>
                <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                  {Number(item.quantity).toFixed(1)} {item.unit}
                  {item.expires_at && ` · verloopt ${item.expires_at}`}
                </div>
              </div>
              <Button variant="outline-secondary" size="sm" onClick={() => consume(item.id)}>
                Gebruik 1
              </Button>
              <Button variant="outline-danger" size="sm" onClick={() => remove(item.id)}>
                Verwijder
              </Button>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Card>
    </>
  );
}
