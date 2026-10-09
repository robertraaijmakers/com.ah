"use client";
import useSWR from "swr";
import Badge from "react-bootstrap/Badge";
import Modal from "react-bootstrap/Modal";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import { api, fmtEur, fmtQty, type MealCost } from "@/lib/api";

export function MealCostModal({ mealId, mealName, onClose }: { mealId: number; mealName: string; onClose: () => void }) {
  const { data, error } = useSWR(`/meals/${mealId}/cost`, (u: string) => api.get<MealCost>(u));

  return (
    <Modal show onHide={onClose} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="h6">Kosten: {mealName}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!data && !error && <div className="text-center py-3"><Spinner /></div>}
        {error && <p className="text-danger mb-0">{error.message}</p>}
        {data && (
          <>
            <p className="mb-3">
              <span className="h5">{fmtEur(data.total)}</span>
              <span className="text-muted"> voor {data.portions} personen</span>
              {data.per_portion != null && <span className="text-muted"> · {fmtEur(data.per_portion)} p.p.</span>}
            </p>
            <div className="table-responsive">
              <Table size="sm" className="align-middle mb-2">
                <thead>
                  <tr><th>Ingrediënt</th><th className="text-end">Hoeveelheid</th><th className="text-end">Kosten</th></tr>
                </thead>
                <tbody>
                  {data.lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        {l.ingredient_name}
                        {l.is_bonus && <Badge bg="danger" className="ms-2 fw-normal">BONUS</Badge>}
                        {l.note && l.cost == null && <div className="small text-muted">{l.note}</div>}
                      </td>
                      <td className="text-end text-nowrap">{l.quantity != null ? `${fmtQty(l.quantity)} ${l.unit ?? ""}` : "–"}</td>
                      <td className="text-end text-nowrap">{l.cost != null ? fmtEur(l.cost) : <span className="text-muted">onbekend</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <p className="small text-muted mb-0">
              Berekend naar het deel van de verpakking dat je gebruikt, op basis van de laatste AH-prijzen.
              {data.unpriced > 0 && ` ${data.unpriced} ingrediënt${data.unpriced === 1 ? "" : "en"} niet meegerekend (niet gekoppeld of geen prijs).`}
            </p>
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}
