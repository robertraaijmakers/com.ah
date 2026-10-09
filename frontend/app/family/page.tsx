"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api, type FamilyMember } from "@/lib/api";
import { useToast } from "@/lib/toast";

const KEY = "/family/";

const RESTRICTIONS: Record<string, string> = {
  vegetarian: "Vegetarisch",
  vegan: "Veganistisch",
  no_nuts: "Geen noten",
  lactose_free: "Lactosevrij",
  gluten_free: "Glutenvrij",
  no_fish: "Geen vis",
  no_pork: "Geen varkensvlees",
};

const TYPE_LABELS: Record<FamilyMember["member_type"], string> = {
  member: "Gezin",
  regular_guest: "Vaste gast",
  generic_guest: "Anonieme gast",
};

const TYPE_BADGE: Record<FamilyMember["member_type"], string> = {
  member: "primary",
  regular_guest: "info",
  generic_guest: "secondary",
};

function MemberCard({ member }: { member: FamilyMember }) {
  const { showToast } = useToast();
  const [deleting, setDeleting] = useState(false);

  const tags = Object.entries(member.dietary_restrictions)
    .filter(([, v]) => v)
    .map(([k]) => RESTRICTIONS[k] || k);

  async function handleDelete() {
    if (!confirm(`${member.name} verwijderen?`)) return;
    setDeleting(true);
    try {
      await api.delete(`/family/${member.id}`);
      mutate(KEY);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Verwijderen mislukt");
      setDeleting(false);
    }
  }

  return (
    <Card className="h-100 shadow-sm">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <div className="d-flex align-items-center gap-2 mb-1">
              <Card.Title className="h6 mb-0">{member.name}</Card.Title>
              {member.member_type !== "member" && (
                <Badge bg={TYPE_BADGE[member.member_type]} className="fw-normal" style={{ fontSize: "0.6rem" }}>
                  {TYPE_LABELS[member.member_type]}
                </Badge>
              )}
            </div>
            {member.birth_date && (
              <small className="text-muted">
                {new Date(member.birth_date + "T12:00:00").toLocaleDateString("nl-NL")}
              </small>
            )}
          </div>
          <Button
            variant="outline-danger"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="ms-2 p-0 px-1 lh-1"
          >
            ✕
          </Button>
        </div>
        {tags.length > 0 && (
          <div className="mt-2 d-flex flex-wrap gap-1">
            {tags.map((t) => (
              <Badge key={t} bg="warning" text="dark" className="fw-normal" style={{ fontSize: "0.75rem" }}>
                {t}
              </Badge>
            ))}
          </div>
        )}
        {member.member_type === "generic_guest" && tags.length === 0 && (
          <div className="mt-2 text-muted" style={{ fontSize: "0.78rem" }}>
            Geen dieetwensen — anonieme gast
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

function AddMemberForm({
  type,
  onAdded,
}: {
  type: FamilyMember["member_type"];
  onAdded: () => void;
}) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [restrictions, setRestrictions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeholders: Record<FamilyMember["member_type"], string> = {
    member: "Naam familielid",
    regular_guest: "Naam vaste gast",
    generic_guest: "Gast",
  };

  const labels: Record<FamilyMember["member_type"], string> = {
    member: "+ Nieuw familielid",
    regular_guest: "+ Vaste gast toevoegen",
    generic_guest: "+ Anonieme gast toevoegen",
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/family/", {
        name: name || "Gast",
        birth_date: birthDate || null,
        dietary_restrictions: restrictions,
        member_type: type,
      });
      setName("");
      setBirthDate("");
      setRestrictions({});
      setOpen(false);
      showToast(`${name || "Gast"} toegevoegd`, "success");
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  // Generic guest: just a quick-add button, no form needed
  if (type === "generic_guest" && !open) {
    return (
      <Button variant="outline-secondary" onClick={() => setOpen(true)}>
        {labels[type]}
      </Button>
    );
  }

  if (!open) {
    return (
      <Card className="h-100 shadow-sm" style={{ borderStyle: "dashed", cursor: "pointer" }} onClick={() => setOpen(true)}>
        <Card.Body className="d-flex align-items-center justify-content-center text-primary">
          <span className="fw-medium">{labels[type]}</span>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <Card.Body>
        <Card.Title className="h6">{labels[type].replace("+ ", "").replace(" toevoegen", "")}</Card.Title>
        {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
        <Form onSubmit={submit}>
          <Form.Group className="mb-2">
            <Form.Control
              required={type !== "generic_guest"}
              size="sm"
              placeholder={placeholders[type]}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Form.Group>
          {type === "member" && (
            <Form.Group className="mb-2">
              <Form.Label className="small">Geboortedatum (optioneel)</Form.Label>
              <Form.Control
                type="date"
                size="sm"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </Form.Group>
          )}
          {type !== "generic_guest" && (
            <Form.Group className="mb-3">
              <Form.Label className="small">Dieetwensen</Form.Label>
              <Row xs={1} sm={2}>
                {Object.entries(RESTRICTIONS).map(([key, label]) => (
                  <Col key={key}>
                    <Form.Check
                      type="checkbox"
                      label={label}
                      checked={!!restrictions[key]}
                      onChange={(e) => setRestrictions((r) => ({ ...r, [key]: e.target.checked }))}
                    />
                  </Col>
                ))}
              </Row>
            </Form.Group>
          )}
          <div className="d-flex gap-2">
            <Button type="submit" className="btn-ah" size="sm" disabled={saving}>
              {saving && <Spinner size="sm" className="me-1" />}Toevoegen
            </Button>
            <Button variant="outline-secondary" size="sm" onClick={() => setOpen(false)}>Annuleer</Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
}

function Section({
  title,
  description,
  members,
  type,
  onChanged,
}: {
  title: string;
  description: string;
  members: FamilyMember[];
  type: FamilyMember["member_type"];
  onChanged: () => void;
}) {
  return (
    <section className="mb-5">
      <h2 className="h5 mb-1">{title}</h2>
      <p className="text-muted small mb-3">{description}</p>
      <Row xs={1} md={type === "generic_guest" ? 2 : 2} className="g-3">
        {members.map((m) => (
          <Col key={m.id}>
            <MemberCard member={m} />
          </Col>
        ))}
        <Col className={type === "generic_guest" ? "d-flex align-items-start" : ""}>
          <AddMemberForm type={type} onAdded={onChanged} />
        </Col>
      </Row>
    </section>
  );
}

export default function FamilyPage() {
  const { data: members, isLoading, error } = useSWR(KEY, () => api.get<FamilyMember[]>(KEY));

  const byType = (type: FamilyMember["member_type"]) =>
    (members ?? []).filter((m) => m.member_type === type);

  return (
    <>
      <h1 className="h3 mb-4">Familie & Gasten</h1>

      {error && <Alert variant="danger">Kon familieleden niet laden: {error.message}</Alert>}
      {isLoading && <div className="text-center py-5"><Spinner /></div>}

      {!isLoading && (
        <>
          <Section
            title="Gezin"
            description="Vaste bewoners — verschijnen standaard op elke dag in het weekplan."
            members={byType("member")}
            type="member"
            onChanged={() => mutate(KEY)}
          />
          <Section
            title="Vaste gasten"
            description="Mensen die regelmatig komen eten — makkelijk aan/uit te zetten per dag in het weekplan."
            members={byType("regular_guest")}
            type="regular_guest"
            onChanged={() => mutate(KEY)}
          />
          <Section
            title="Anonieme gasten"
            description="Onbekende gasten zonder specifieke wensen — handig als teller voor onverwachte bezoekers."
            members={byType("generic_guest")}
            type="generic_guest"
            onChanged={() => mutate(KEY)}
          />
        </>
      )}
    </>
  );
}
