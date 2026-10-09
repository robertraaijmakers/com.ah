"use client";
import Link from "next/link";
import useSWR from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api, daysUntil, fmtDate, fmtEur, type MealPlan, type PantryItem, type BuyAdvice } from "@/lib/api";

export default function Dashboard() {
  const { data: plans, error: plansErr } = useSWR("/plans/", () => api.get<MealPlan[]>("/plans/"));
  const { data: pantry } = useSWR("/pantry/", () => api.get<PantryItem[]>("/pantry/"));
  const { data: advice } = useSWR("/advice/", () => api.get<BuyAdvice[]>("/advice/"));

  const latestPlan = plans?.[0] ?? null;

  const expiringSoon = (pantry ?? []).filter((p) => p.expires_at && daysUntil(p.expires_at) <= 3);

  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const today = latestPlan?.plan_days.find((d) => d.date === todayIso) ?? null;

  return (
    <>
      <h1 className="h3 mb-3">Dashboard</h1>

      {plansErr && <Alert variant="warning">Kon plannen niet laden: {plansErr.message}</Alert>}

      <Card className="shadow-sm mb-4 border-0" style={{ background: "var(--bs-light)" }}>
        <Card.Body className="d-flex flex-wrap gap-3 align-items-center justify-content-between">
          <div>
            <div className="small text-muted">Vandaag op het menu</div>
            <div className="h5 mb-0">
              {!plans && <Spinner size="sm" />}
              {plans && today?.meal_name}
              {plans && today && !today.meal_name && <em className="text-muted">Geen maaltijd gepland</em>}
              {plans && !today && <em className="text-muted">Niets gepland voor vandaag</em>}
              {today?.is_leftovers && <span className="ms-2 small text-muted">(restjes)</span>}
            </div>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <Link href="/shopping" className="btn btn-success btn-sm">Boodschappenlijst</Link>
            <Link href="/plans" className="btn btn-outline-secondary btn-sm">Nieuw plan</Link>
            <Link href="/pantry" className="btn btn-outline-secondary btn-sm">Voorraad</Link>
          </div>
        </Card.Body>
      </Card>

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
                    <li key={day.id} className={`d-flex justify-content-between py-1 border-bottom ${day.date === todayIso ? "fw-bold" : ""}`}>
                      <span className="text-muted small">
                        {fmtDate(day.date)}
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
                      <span className={`fw-semibold ${daysUntil(p.expires_at!) < 0 ? "text-danger" : "text-warning"}`}>{daysUntil(p.expires_at!) < 0 ? "verlopen" : fmtDate(p.expires_at!)}</span>
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
                <Card.Header className="bg-white fw-semibold">Prijsalerts</Card.Header>
                <Card.Body>
                  {!advice && <div className="text-center"><Spinner size="sm" /></div>}
                  {advice && advice.length === 0 && (
                    <p className="text-muted small mb-0">Geen prijsalerts op dit moment</p>
                  )}
                  {(advice ?? []).slice(0, 3).map((a) => (
                    <div key={a.id} className="d-flex justify-content-between small py-1">
                      <span>
                        {a.product.name}
                        {a.times_ordered > 0 && <span className="text-muted"> · {a.times_ordered}× gekocht</span>}
                      </span>
                      <span>
                        <span className="me-2">{fmtEur(a.current_price)}</span>
                        {a.savings_pct && (
                          <Badge bg="success">-{Math.round(Number(a.savings_pct))}%</Badge>
                        )}
                      </span>
                    </div>
                  ))}
                  <Link href="/advice" className="small d-block mt-2 text-decoration-none">
                    Alle prijsalerts →
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
