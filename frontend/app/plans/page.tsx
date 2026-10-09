"use client";
import { useState, useEffect } from "react";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import ListGroup from "react-bootstrap/ListGroup";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api, type MealPlan, type MealPlanDay, type FamilyMember, type Meal } from "@/lib/api";
import { useToast } from "@/lib/toast";

const PLANS_KEY = "/plans/";

// Order Monday, delivery Tuesday night → cycle Wed–Tue.
// If today is Sun or Mon, planning is for the NEXT cycle (next Wednesday).
// Otherwise plan from this (most recent) Wednesday.
function defaultStartDate(): string {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun,1=Mon,...,6=Sat
  let offset: number;
  if (dow === 0) offset = 3;          // Sun → +3 (next Wed)
  else if (dow === 1) offset = 2;     // Mon → +2 (next Wed)
  else if (dow === 2) offset = -6;    // Tue → last Wed (current cycle end)
  else offset = 3 - dow;             // Wed=0, Thu=-1, Fri=-2, Sat=-3
  const d = new Date(today);
  d.setDate(today.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function defaultPlanName(startIso: string): string {
  const start = new Date(startIso + "T12:00:00");
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmtShort = (d: Date) =>
    d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  return `Week ${fmtShort(start)} – ${fmtShort(end)}`;
}

const WEEKDAYS_NL = ["zo", "ma", "di", "wo", "do", "vr", "za"];

const TYPE_COLOR: Record<FamilyMember["member_type"], string> = {
  member: "primary",
  regular_guest: "info",
  generic_guest: "secondary",
};

const TYPE_ORDER: Record<FamilyMember["member_type"], number> = {
  member: 0,
  regular_guest: 1,
  generic_guest: 2,
};

function sortMembers(members: FamilyMember[]): FamilyMember[] {
  return [...members].sort((a, b) => TYPE_ORDER[a.member_type] - TYPE_ORDER[b.member_type] || a.name.localeCompare(b.name));
}

function MemberChip({
  member,
  active,
  onClick,
}: {
  member: FamilyMember;
  active: boolean;
  onClick: () => void;
}) {
  const color = TYPE_COLOR[member.member_type];
  return (
    <Badge
      bg={active ? color : "light"}
      text={active ? "white" : "muted"}
      className="border fw-normal"
      style={{ fontSize: "0.65rem", cursor: "pointer", userSelect: "none" }}
      onClick={onClick}
      title={member.member_type === "generic_guest" ? "Anonieme gast" : member.member_type === "regular_guest" ? "Vaste gast" : ""}
    >
      {member.name}
    </Badge>
  );
}

export default function PlansPage() {
  const { showToast } = useToast();
  const { data: plans, isLoading, error } = useSWR(PLANS_KEY, () => api.get<MealPlan[]>(PLANS_KEY));
  const { data: members } = useSWR("/family/", () => api.get<FamilyMember[]>("/family/"));
  const { data: meals } = useSWR("/meals/", () => api.get<Meal[]>("/meals/"));

  const [showForm, setShowForm] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
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

  // Edit mode state for existing plans
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [editMeatDays, setEditMeatDays] = useState(3);
  const [editPerDayPersons, setEditPerDayPersons] = useState<number[][]>([]);
  const [saving, setSaving] = useState(false);

  function startEdit(plan: MealPlan) {
    setEditingPlanId(plan.id);
    setEditName(plan.name ?? "");
    setEditBudget(plan.budget_eur != null ? String(plan.budget_eur) : "");
    setEditMeatDays(plan.meat_days ?? 3);
    setEditPerDayPersons(plan.plan_days.map((d) => [...(d.persons ?? [])]));
  }

  function cancelEdit() {
    setEditingPlanId(null);
  }

  function toggleEditPersonOnDay(dayIdx: number, memberId: number) {
    setEditPerDayPersons((prev) => {
      const next = [...prev];
      const cur = next[dayIdx] ?? [];
      next[dayIdx] = cur.includes(memberId) ? cur.filter((id) => id !== memberId) : [...cur, memberId];
      return next;
    });
  }

  function toggleEditPersonAllDays(memberId: number) {
    setEditPerDayPersons((prev) =>
      prev.map((dayIds) => {
        const on = !dayIds.includes(memberId);
        return on ? [...new Set([...dayIds, memberId])] : dayIds.filter((id) => id !== memberId);
      })
    );
  }

  async function savePlan(plan: MealPlan) {
    setSaving(true);
    try {
      await api.patch(`/plans/${plan.id}`, {
        name: editName || null,
        budget_eur: editBudget ? parseFloat(editBudget) : null,
        meat_days: editMeatDays,
      });
      // Update persons per day
      await Promise.all(
        plan.plan_days.map((day, i) => {
          const newPersons = editPerDayPersons[i] ?? day.persons ?? [];
          const changed = JSON.stringify([...newPersons].sort()) !== JSON.stringify([...(day.persons ?? [])].sort());
          return changed ? api.patch(`/plans/${plan.id}/days/${day.id}`, { persons: newPersons }) : Promise.resolve();
        })
      );
      await mutate(PLANS_KEY);
      setEditingPlanId(null);
      showToast("Plan opgeslagen", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  // Update plan name when start date changes
  useEffect(() => {
    setPlanName(defaultPlanName(startDate));
  }, [startDate]);

  const activePlan = plans?.find((p) => p.id === (selectedPlanId ?? plans[0]?.id));

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
      setSelectedPlanId(plan.id);
      setShowForm(false);
      showToast("Plan aangemaakt", "success");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Genereren mislukt");
    } finally {
      setGenerating(false);
    }
  }

  async function generateShoppingList(planId: number) {
    try {
      const list = await api.post<{ id: number }>(`/shopping/generate/${planId}`);
      window.location.href = `/shopping?list=${list.id}`;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Boodschappenlijst maken mislukt");
    }
  }

  async function updateDay(
    planId: number,
    day: MealPlanDay,
    patch: { meal_id?: number | null; clear_meal?: boolean; persons?: number[] }
  ) {
    try {
      const updated = await api.patch<MealPlanDay>(`/plans/${planId}/days/${day.id}`, patch);
      // Optimistically update local plan
      mutate(
        PLANS_KEY,
        (current: MealPlan[] | undefined) =>
          current?.map((p) =>
            p.id !== planId
              ? p
              : {
                  ...p,
                  plan_days: p.plan_days.map((d) => (d.id === day.id ? updated : d)),
                }
          ),
        false
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
      mutate(PLANS_KEY);
    }
  }

  function toggleMemberOnDay(planId: number, day: MealPlanDay, memberId: number) {
    const current = day.persons ?? [];
    const next = current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId];
    updateDay(planId, day, { persons: next });
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Weekplannen</h1>
        <Button className="btn-ah" onClick={() => setShowForm(true)}>+ Nieuw plan</Button>
      </div>

      {error && <Alert variant="danger">Kon plannen niet laden: {error.message}</Alert>}

      {showForm && (
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
              <Button variant="outline-secondary" onClick={() => setShowForm(false)}>Annuleer</Button>
            </div>
          </Card.Body>
        </Card>
      )}

      <Row className="g-3">
        <Col xs={12} md={3}>
          {isLoading && <Spinner size="sm" />}
          <ListGroup>
            {plans?.map((p) => (
              <ListGroup.Item
                key={p.id}
                action
                active={activePlan?.id === p.id}
                onClick={() => { setSelectedPlanId(p.id); setEditingPlanId(null); }}
                className="border-0"
              >
                <div className="fw-medium">{p.name || `Plan ${p.id}`}</div>
                <small className={activePlan?.id === p.id ? "text-white-50" : "text-muted"}>
                  {new Date(p.start_date + "T12:00:00").toLocaleDateString("nl-NL")} · {p.days} dagen
                </small>
              </ListGroup.Item>
            ))}
          </ListGroup>
        </Col>

        {activePlan && (
          <Col xs={12} md={9}>
            <Card className="shadow-sm">
              <Card.Header className="d-flex justify-content-between align-items-center bg-white">
                <span className="fw-semibold">{activePlan.name || `Plan ${activePlan.id}`}</span>
                <div className="d-flex gap-2">
                  {editingPlanId === activePlan.id ? (
                    <>
                      <Button variant="outline-secondary" size="sm" onClick={cancelEdit} disabled={saving}>Annuleer</Button>
                      <Button className="btn-ah" size="sm" onClick={() => savePlan(activePlan)} disabled={saving}>
                        {saving && <Spinner size="sm" className="me-1" />}Opslaan
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline-secondary" size="sm" onClick={() => startEdit(activePlan)}>Bewerken</Button>
                      <Button variant="success" size="sm" onClick={() => generateShoppingList(activePlan.id)}>
                        Boodschappenlijst genereren
                      </Button>
                    </>
                  )}
                </div>
              </Card.Header>

              {/* Edit mode panel */}
              {editingPlanId === activePlan.id && members && (
                <div className="p-3 border-bottom bg-light">
                  <Row className="g-2 mb-3">
                    <Col xs={12} sm={5}>
                      <Form.Label className="small">Naam</Form.Label>
                      <Form.Control size="sm" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Plan naam" />
                    </Col>
                    <Col xs={6} sm={3}>
                      <Form.Label className="small">Vleesdagen</Form.Label>
                      <Form.Control type="number" size="sm" min={0} max={activePlan.days} value={editMeatDays} onChange={(e) => setEditMeatDays(Number(e.target.value))} />
                    </Col>
                    <Col xs={6} sm={4}>
                      <Form.Label className="small">Budget (€)</Form.Label>
                      <Form.Control type="number" size="sm" placeholder="100" value={editBudget} onChange={(e) => setEditBudget(e.target.value)} />
                    </Col>
                  </Row>
                  <Form.Label className="small">Aanwezigen per dag</Form.Label>
                  <div style={{ overflowX: "auto" }}>
                    <table className="table table-sm table-bordered mb-0" style={{ fontSize: "0.78rem" }}>
                      <thead>
                        <tr>
                          <th className="fw-normal text-muted" style={{ width: 90 }}>Dag</th>
                          {sortMembers(members).map((m) => {
                            const allOn = editPerDayPersons.every((dp) => dp.includes(m.id));
                            return (
                              <th
                                key={m.id}
                                className="text-center fw-normal"
                                style={{ minWidth: 56, cursor: "pointer", userSelect: "none" }}
                                onClick={() => toggleEditPersonAllDays(m.id)}
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
                        {activePlan.plan_days.map((day, i) => {
                          const dateObj = new Date(day.date + "T12:00:00");
                          const dayPersons = editPerDayPersons[i] ?? [];
                          return (
                            <tr key={day.id}>
                              <td className="text-capitalize fw-medium" style={{ whiteSpace: "nowrap" }}>
                                {WEEKDAYS_NL[dateObj.getDay()]} {dateObj.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                              </td>
                              {sortMembers(members).map((m) => {
                                const active = dayPersons.includes(m.id);
                                return (
                                  <td
                                    key={m.id}
                                    className="text-center"
                                    style={{ cursor: "pointer", background: active ? "#e8f5e9" : undefined }}
                                    onClick={() => toggleEditPersonOnDay(i, m.id)}
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
                </div>
              )}

              <ListGroup variant="flush">
                {activePlan.plan_days.map((day) => {
                  const dateObj = new Date(day.date + "T12:00:00");
                  const dayLabel = WEEKDAYS_NL[dateObj.getDay()];
                  const dateLabel = dateObj.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
                  const presentMembers = members?.filter((m) => (day.persons ?? []).includes(m.id)) ?? [];
                  const absentMembers = members?.filter((m) => !(day.persons ?? []).includes(m.id)) ?? [];

                  return (
                    <ListGroup.Item key={day.id} className="py-2 px-3">
                      <div className="d-flex align-items-center gap-3 flex-wrap">
                        {/* Date */}
                        <span className="fw-semibold small text-capitalize" style={{ minWidth: 90 }}>
                          {dayLabel} {dateLabel}
                        </span>

                        {/* Member chips */}
                        {members && members.length > 0 && (
                          <div className="d-flex gap-1 flex-wrap">
                            {sortMembers(members).map((m) => (
                              <MemberChip
                                key={m.id}
                                member={m}
                                active={(day.persons ?? []).includes(m.id)}
                                onClick={() => toggleMemberOnDay(activePlan.id, day, m.id)}
                              />
                            ))}
                          </div>
                        )}

                        {/* Meal name + leftovers badge */}
                        <span className="small fw-medium flex-grow-1 text-truncate">
                          {day.meal_name || <em className="text-muted fw-normal">Geen maaltijd</em>}
                          {day.is_leftovers && (
                            <Badge bg="secondary" className="ms-1 fw-normal" style={{ fontSize: "0.6rem" }}>restjes</Badge>
                          )}
                        </span>

                        {/* Meal dropdown */}
                        <Form.Select
                          size="sm"
                          style={{ maxWidth: 200 }}
                          value={day.meal_id ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateDay(
                              activePlan.id,
                              day,
                              val ? { meal_id: Number(val) } : { clear_meal: true }
                            );
                          }}
                        >
                          <option value="">— geen —</option>
                          {meals?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </Form.Select>
                      </div>

                      {/* Absent members hint */}
                      {absentMembers.length > 0 && (
                        <div className="text-muted mt-1" style={{ fontSize: "0.68rem", paddingLeft: 2 }}>
                          Niet aanwezig: {absentMembers.map((m) => m.name).join(", ")}
                        </div>
                      )}
                    </ListGroup.Item>
                  );
                })}
              </ListGroup>
            </Card>
          </Col>
        )}
      </Row>
    </>
  );
}
