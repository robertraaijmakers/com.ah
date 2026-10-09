"use client";
import { useState } from "react";
import useSWR from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Card from "react-bootstrap/Card";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import { api } from "@/lib/api";
import { buildQuery, euro, type Recommendations } from "@/lib/analytics";
import { ConfidenceBadge } from "@/components/analytics/PeriodRangeSelectors";



export function RecommendationsCard({ rangeParams }: { rangeParams: { start?: string; end?: string } }) {
  const [daysAhead, setDaysAhead] = useState(7);

  const { data: recsData, isLoading: recsLoading } = useSWR(
    `/analytics/recommendations${buildQuery({ days_ahead: String(daysAhead), ...rangeParams })}`,
    (url: string) => api.get<Recommendations>(url)
  );
  const recs = recsData ?? null;

  return (
          <Card className="shadow-sm">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <span className="fw-semibold">Boodschappenlijst aanbevelingen</span>
                <div className="small text-muted">Gebaseerd op kooppatronen (exponentieel gewogen intervalanalyse)</div>
              </div>
              <ButtonGroup size="sm">
                {[4, 7, 14].map(d => (
                  <Button key={d} variant={daysAhead === d ? "primary" : "outline-secondary"} onClick={() => setDaysAhead(d)}>
                    {d} dgn
                  </Button>
                ))}
              </ButtonGroup>
            </Card.Header>
            <Card.Body>
              {recsLoading && <Spinner size="sm" />}
              {!recsLoading && recs && (recs.needed.length === 0 && recs.soon.length === 0) && (
                <Alert variant="info" className="mb-0">
                  Geen aanbevelingen — te weinig herhalingsaankopen gevonden ({recs.items_analyzed} producten geanalyseerd).
                </Alert>
              )}
              {recs && (recs.needed.length > 0 || recs.soon.length > 0) && (
                <>
                  {recs.needed.length > 0 && (
                    <div className="mb-3">
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <Badge bg="danger">Nu nodig</Badge>
                        <span className="small text-muted">Binnen {recs.planning_horizon_days} dagen op</span>
                        <span className="ms-auto small fw-medium">Geschat: {euro(recs.estimated_total)}</span>
                      </div>
                      <Table responsive size="sm" hover className="mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>Product</th>
                            <th className="text-end">Aantal</th>
                            <th className="text-end">Prijs</th>
                            <th className="text-end">Laast gekocht</th>
                            <th className="text-end">Elke ~</th>
                            <th className="text-end">Zekerheid</th>
                          </tr>
                        </thead>
                        <tbody style={{ fontSize: "0.82rem" }}>
                          {recs.needed.map((item, i) => (
                            <tr key={i}>
                              <td>{item.name}</td>
                              <td className="text-end">{item.suggested_qty}×</td>
                              <td className="text-end">{item.median_price > 0 ? euro(item.estimated_cost) : "—"}</td>
                              <td className="text-end text-muted">{Math.round(item.last_bought_days_ago)} dgn geleden</td>
                              <td className="text-end text-muted">{item.avg_interval_days} dgn</td>
                              <td className="text-end"><ConfidenceBadge v={item.confidence} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                  {recs.soon.length > 0 && (
                    <div>
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <Badge bg="warning" text="dark">Bijna op</Badge>
                        <span className="small text-muted">Binnen {recs.planning_horizon_days * 2} dagen</span>
                      </div>
                      <Table responsive size="sm" hover className="mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>Product</th>
                            <th className="text-end">Over ~</th>
                            <th className="text-end">Elke ~</th>
                            <th className="text-end">Zekerheid</th>
                          </tr>
                        </thead>
                        <tbody style={{ fontSize: "0.82rem" }}>
                          {recs.soon.map((item, i) => (
                            <tr key={i}>
                              <td>{item.name}</td>
                              <td className="text-end text-muted">{item.days_until_needed} dgn</td>
                              <td className="text-end text-muted">{item.avg_interval_days} dgn</td>
                              <td className="text-end"><ConfidenceBadge v={item.confidence} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                  <div className="small text-muted mt-3">{recs.items_analyzed} producten geanalyseerd</div>
                </>
              )}
            </Card.Body>
          </Card>
        
  );
}
