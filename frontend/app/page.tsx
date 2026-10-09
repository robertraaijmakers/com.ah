"use client";
import Link from "next/link";
import useSWR from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api, type MealPlan, type PantryItem, type BuyAdvice } from "@/lib/api";

export default function Dashboard() {
  const { data: plans, error: plansErr } = useSWR("/plans/", () => api.get<MealPlan[]>("/plans/"));
  const { data: pantry } = useSWR("/pantry/", () => api.get<PantryItem[]>("/pantry/"));
  const { data: advice } = useSWR("/advice/", () => api.get<BuyAdvice[]>("/advice/"));

  const latestPlan = plans?.[0] ?? null;

  const expiringSoon = (pantry ?? []).filter((p) => {
    if (!p.expires_at) return false;
    const days = Math.ceil((new Date(p.expires_at).getTime() - Date.now()) / 86400000);
    return days <= 3 && days >= 0;
  });

  return (
    <>
      <h1 className="h3 mb-4">Dashboard</h1>

      {plansErr && <Alert variant="warning">Kon plannen niet laden</Alert>}

      <Row className="g-4">
        <Col xs={12} lg={8}>
          <Card className="shadow-sm h-100">
            <Card.Header className="d-flex justify-content-between align-items-center bg-white">
              <span className="fw-semibold">Huidig weekmenu</span>
              <Link href="/plans" className="small text-decoration-none">Alle plannen →</Link>
            </Card.Header>
            <Card.Body>
              {!plans && (
                <div className="text-center py-3"><Spinner size="sm" /></div>
              )}
              {plans && !latestPlan && (
                <p className="text-muted small mb-0">
                  Geen actief plan.{" "}
                  <Link href="/plans">Maak een plan</Link>
                </p>
              )}
              {latestPlan && (
                <ul className="list-unstyled mb-0">
                  {latestPlan.plan_days.slice(0, 7).map((day) => (
                    <li key={day.id} className="d-flex justify-content-between py-1 border-bottom">
                      <span className="text-muted small">
                        {new Date(day.date).toLocaleDateString("nl-NL", {
                          weekday: "short", day: "numeric", month: "short",
                        })}
                      </span>
                      <span className="small fw-medium">
                        {day.meal_name ?? <em className="text-muted">Geen maaltijd</em>}
                        {day.is_leftovers && (
                          <span className="ms-1 text-muted">(restjes)</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} lg={4}>
          <Row className="g-3">
            <Col xs={12}>
              <Card className="shadow-sm">
                <Card.Header className="bg-white fw-semibold">Bijna verlopen</Card.Header>
                <Card.Body>
                  {!pantry && <div className="text-center"><Spinner size="sm" /></div>}
                  {pantry && expiringSoon.length === 0 && (
                    <p className="text-muted small mb-0">Niets verloopt binnenkort</p>
                  )}
                  {expiringSoon.map((p) => (
                    <div key={p.id} className="d-flex justify-content-between small py-1">
                      <span>{p.product.name}</span>
                      <span className="text-warning fw-semibold">{p.expires_at}</span>
                    </div>
                  ))}
                  <Link href="/pantry" className="small d-block mt-2 text-decoration-none">
                    Bekijk voorraad →
                  </Link>
                </Card.Body>
              </Card>
            </Col>

            <Col xs={12}>
              <Card className="shadow-sm">
                <Card.Header className="bg-white fw-semibold">Kooptips</Card.Header>
                <Card.Body>
                  {!advice && <div className="text-center"><Spinner size="sm" /></div>}
                  {advice && advice.length === 0 && (
                    <p className="text-muted small mb-0">Geen actieve tips</p>
                  )}
                  {(advice ?? []).slice(0, 3).map((a) => (
                    <div key={a.id} className="d-flex justify-content-between small py-1">
                      <span>{a.product.name}</span>
                      {a.savings_pct && (
                        <Badge bg="success">-{Math.round(Number(a.savings_pct))}%</Badge>
                      )}
                    </div>
                  ))}
                  <Link href="/advice" className="small d-block mt-2 text-decoration-none">
                    Alle tips →
                  </Link>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>
    </>
  );
}
