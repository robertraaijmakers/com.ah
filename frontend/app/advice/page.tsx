"use client";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api, type BuyAdvice } from "@/lib/api";
import { useToast } from "@/lib/toast";

const KEY = "/advice/";

export default function AdvicePage() {
  const { showToast } = useToast();
  const { data: advice, isLoading, error } = useSWR(KEY, () => api.get<BuyAdvice[]>(KEY));

  async function dismiss(id: number) {
    try {
      await api.post(`/advice/${id}/dismiss`);
      mutate(KEY);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Mislukt");
    }
  }

  async function runEngine() {
    try {
      const result = await api.post<{ created: number }>("/advice/run");
      showToast(`${result.created} nieuwe prijsalerts gevonden`, "success");
      mutate(KEY);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Engine mislukt");
    }
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Prijsalerts</h1>
        <Button className="btn-ah" onClick={runEngine}>Nu controleren</Button>
      </div>

      {error && <Alert variant="danger">Kon tips niet laden: {error.message}</Alert>}
      {isLoading && <div className="text-center py-5"><Spinner /></div>}

      {advice?.length === 0 && (
        <Alert variant="info">
          <Alert.Heading className="h6">Geen prijsalerts</Alert.Heading>
          <p className="mb-0 small">Meer prijsdata nodig (min. 5 snapshots per product over 90 dagen).</p>
        </Alert>
      )}

      <Row xs={1} md={2} className="g-3">
        {advice?.map((a) => (
          <Col key={a.id}>
            <Card className="shadow-sm h-100">
              <Card.Body className="d-flex gap-3">
                {a.product.image_url && (
                  <img
                    src={a.product.image_url}
                    alt={a.product.name}
                    width={64}
                    height={64}
                    style={{ objectFit: "contain", borderRadius: 4, flexShrink: 0 }}
                  />
                )}
                <div className="flex-grow-1">
                  <div className="d-flex justify-content-between align-items-start">
                    <span className="fw-semibold">{a.product.name}{a.times_ordered > 0 && <Badge bg="light" text="dark" className="ms-2 fw-normal border">{a.times_ordered}× gekocht</Badge>}</span>
                    <Button
                      variant="link"
                      size="sm"
                      className="text-muted p-0 ms-2 lh-1"
                      onClick={() => dismiss(a.id)}
                      aria-label="Alert verbergen"
                    >
                      ✕
                    </Button>
                  </div>
                  <div className="d-flex align-items-center gap-2 mt-1">
                    <span className="h5 text-success mb-0">€{Number(a.current_price).toFixed(2)}</span>
                    {a.avg_price_90d && (
                      <small className="text-muted">gem. €{Number(a.avg_price_90d).toFixed(2)}</small>
                    )}
                    {a.savings_pct && (
                      <Badge bg="success">-{Math.round(Number(a.savings_pct))}%</Badge>
                    )}
                  </div>
                  {a.message && <p className="small text-muted mb-0 mt-1">{a.message}</p>}
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}
