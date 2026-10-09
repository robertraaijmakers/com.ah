"use client";
import { useEffect, useState } from "react";
import { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api, type FamilyMember, type MealPlan } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { PLANS_KEY, WEEKDAYS_NL, TYPE_COLOR, defaultPlanName, defaultStartDate, sortMembers } from "@/lib/plans";



export function NewPlanForm({ members, onCancel, onCreated }: {
  members: FamilyMember[];
  onCancel: () => void;
  onCreated: (planId: number) => void;
}) {
  const { showToast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const startDefault = defaultStartDate();
  const [startDate, setStartDate] = useState(startDefault);
  const [days, setDays] = useState(7);
  // perDayPersons: array of sets (one per day). Initialized lazily when members load.
  const [perDayPersons, setPerDayPersons] = useState<number[][]>([]);
  const [meatDays, setMeatDays] = useState(3);
  const [budget, setBudget] = useState("");
  const [planName, setPlanName] = useState(defaultPlanName(startDefault));

  // Initialize perDayPersons only when members first load (not on every days/startDate change)
  useEffect(() => {
    if (!members) return;
    const defaultIds = members.filter((m) => m.member_type === "member").map((m) => m.id);
    setPerDayPersons((prev) => {
      if (prev.length === 0) return Array.from({ length: days }, () => [...defaultIds]);
      // Resize: add new days with defaults, trim extra
      if (prev.length === days) return prev;
      const resized = [...prev];
      while (resized.length < days) resized.push([...defaultIds]);
      return resized.slice(0, days);
    });
  }, [members, days]);

  // Update plan name when start date changes
  useEffect(() => {
    setPlanName(defaultPlanName(startDate));
  }, [startDate]);

  function togglePersonOnFormDay(dayIdx: number, memberId: number) {
    setPerDayPersons((prev) => {
      const next = [...prev];
      const cur = next[dayIdx] ?? [];
      next[dayIdx] = cur.includes(memberId) ? cur.filter((id) => id !== memberId) : [...cur, memberId];
      return next;
    });
  }

  function togglePersonAllDays(memberId: number, forceOn?: boolean) {
    setPerDayPersons((prev) =>
      prev.map((dayIds) => {
        const on = forceOn ?? !dayIds.includes(memberId);
        return on ? [...new Set([...dayIds, memberId])] : dayIds.filter((id) => id !== memberId);
      })
    );
  }

  function setAllDays(memberIds: number[]) {
    setPerDayPersons(Array.from({ length: days }, () => [...memberIds]));
  }


  async function generate() {
    setGenerating(true);
    setFormError(null);
    try {
      const allPersonIds = [...new Set(perDayPersons.flat())];
      const plan = await api.post<MealPlan>("/plans/generate", {
        start_date: startDate,
        days,
        person_ids: allPersonIds,
        per_day_persons: perDayPersons,
        meat_days: meatDays,
        budget_eur: budget ? parseFloat(budget) : null,
        name: planName || null,
      });
      await mutate(PLANS_KEY);
      onCreated(plan.id);
      showToast("Plan aangemaakt", "success");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Genereren mislukt");
    } finally {
      setGenerating(false);
    }
  }


  return (
        <Card className="shadow-sm mb-4">
          <Card.Body>
            <Card.Title className="h6">Plan genereren</Card.Title>
            {formError && <Alert variant="danger" onClose={() => setFormError(null)} dismissible>{formError}</Alert>}
            <Row className="g-2 mb-3">
              <Col xs={12} sm={6}>
                <Form.Label className="small">Naam</Form.Label>
                <Form.Control size="sm" placeholder="Week …" value={planName} onChange={(e) => setPlanName(e.target.value)} />
              </Col>
              <Col xs={12} sm={6}>
                <Form.Label className="small">Startdatum (woensdag)</Form.Label>
                <Form.Control
                  type="date"
                  size="sm"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Col>
              <Col xs={6} sm={4}>
                <Form.Label className="small">Aantal dagen</Form.Label>
                <Form.Control type="number" size="sm" min={1} max={14} value={days} onChange={(e) => setDays(Number(e.target.value))} />
              </Col>
              <Col xs={6} sm={4}>
                <Form.Label className="small">Vleesdagen</Form.Label>
                <Form.Control type="number" size="sm" min={0} max={days} value={meatDays} onChange={(e) => setMeatDays(Number(e.target.value))} />
              </Col>
              <Col xs={12} sm={4}>
                <Form.Label className="small">Budget (€)</Form.Label>
                <Form.Control type="number" size="sm" placeholder="100" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </Col>
            </Row>
            {members && members.length > 0 && perDayPersons.length === days && (
              <Form.Group className="mb-3">
                <div className="d-flex align-items-center gap-3 mb-2">
                  <Form.Label className="small mb-0">Aanwezigen per dag</Form.Label>
                  <div className="d-flex gap-1">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                      onClick={() => setAllDays(members.filter((m) => m.member_type === "member").map((m) => m.id))}
                    >
                      Gezin alle dagen
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                      onClick={() => setAllDays(members.map((m) => m.id))}
                    >
                      Iedereen alle dagen
                    </Button>
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="table table-sm table-bordered mb-0" style={{ fontSize: "0.78rem", minWidth: 320 }}>
                    <thead>
                      <tr>
                        <th className="fw-normal text-muted" style={{ width: 90 }}>Dag</th>
                        {sortMembers(members).map((m) => {
                          const allOn = perDayPersons.every((dp) => dp.includes(m.id));
                          return (
                            <th
                              key={m.id}
                              className="text-center fw-normal"
                              style={{ minWidth: 56, cursor: "pointer", userSelect: "none" }}
                              onClick={() => togglePersonAllDays(m.id, !allOn)}
                              title={allOn ? `${m.name} alle dagen uitschakelen` : `${m.name} alle dagen inschakelen`}
                            >
                              <span className={`badge bg-${TYPE_COLOR[m.member_type]} fw-normal`} style={{ fontSize: "0.6rem" }}>
                                {m.name}
                              </span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: days }, (_, i) => {
                        const d = new Date(startDate + "T12:00:00");
                        d.setDate(d.getDate() + i);
                        const dayPersons = perDayPersons[i] ?? [];
                        return (
                          <tr key={i}>
                            <td className="text-capitalize fw-medium" style={{ whiteSpace: "nowrap" }}>
                              {WEEKDAYS_NL[d.getDay()]} {d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                            </td>
                            {sortMembers(members).map((m) => {
                              const active = dayPersons.includes(m.id);
                              return (
                                <td
                                  key={m.id}
                                  className="text-center"
                                  style={{ cursor: "pointer", background: active ? "#e8f5e9" : undefined }}
                                  onClick={() => togglePersonOnFormDay(i, m.id)}
                                  title={active ? `${m.name} verwijderen` : `${m.name} toevoegen`}
                                >
                                  {active ? "✓" : <span className="text-muted">–</span>}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Form.Group>
            )}
            <div className="d-flex gap-2">
              <Button className="btn-ah" onClick={generate} disabled={generating}>
                {generating && <Spinner size="sm" className="me-1" />}
                Genereer plan
              </Button>
              <Button variant="outline-secondary" onClick={() => onCancel()}>Annuleer</Button>
            </div>
          </Card.Body>
        </Card>
      
  );
}
