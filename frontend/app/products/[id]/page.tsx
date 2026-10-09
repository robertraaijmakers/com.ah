"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import { api, type Product } from "@/lib/api";
import { useToast } from "@/lib/toast";

function EditNameEnModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: (updated: Product) => void;
}) {
  const { showToast } = useToast();
  const [nameEn, setNameEn] = useState(product.name_en ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const updated = await api.patch<Product>(`/products/${product.id}/name-en`, {
        name_en: nameEn.trim() || null,
      });
      showToast("Engelse naam bijgewerkt", "success");
      onSaved(updated);
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal show onHide={onClose} size="sm">
      <Modal.Header closeButton>
        <Modal.Title className="h6">Engelse naam</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="small text-muted mb-2">{product.name}</p>
        <Form.Control
          size="sm"
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          placeholder="English name (bijv. Black Beans)"
        />
        <Form.Text className="text-muted">
          Leeg = geen Engelse naam. Handmatig ingesteld overschrijft Open Food Facts verrijking.
        </Form.Text>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" size="sm" onClick={onClose}>Annuleer</Button>
        <Button className="btn-ah" size="sm" onClick={save} disabled={saving}>
          {saving && <Spinner size="sm" className="me-1" />}Opslaan
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

interface OrderStats {
  times_ordered: number;
  total_qty: number;
  last_ordered_at: string | null;
  min_price_paid: number | null;
  avg_price_paid: number | null;
  min_per_kg: number | null;
  avg_per_kg: number | null;
  min_per_litre: number | null;
  avg_per_litre: number | null;
  min_per_piece: number | null;
  avg_per_piece: number | null;
  unit_type: string;
}

interface PeriodStats {
  count: number;
  min_price: number | null;
  avg_price: number | null;
  max_price: number | null;
  min_per_unit: number | null;
  avg_per_unit: number | null;
  max_per_unit: number | null;
  unit_label: string | null;
}

interface HistoryEntry {
  scraped_at: string;
  price: number;
  effective_price: number;
  is_bonus: boolean;
  bonus_until: string | null;
  price_per_kg: number | null;
  price_per_litre: number | null;
  price_per_100g: number | null;
  price_per_100ml: number | null;
  price_per_piece: number | null;
  product_id: number | null;
  product_name: string | null;
}

interface GroupProductRef {
  id: number;
  name: string;
}

interface PriceStats {
  product_id: number;
  unit_type: string;
  periods: Record<string, PeriodStats>;
  history: HistoryEntry[];
  group_name: string | null;
  group_products: GroupProductRef[];
  filter_product_id: number | null;
}

const PERIOD_LABELS: Record<string, string> = {
  "3m": "3 maanden",
  "6m": "6 maanden",
  "1y": "1 jaar",
  "all": "Alles",
};

const CHART_PERIODS = [
  { key: "1m",  label: "1M",    days: 30,  bucketDays: 1  },
  { key: "3m",  label: "3M",    days: 90,  bucketDays: 7  },
  { key: "6m",  label: "6M",    days: 180, bucketDays: 14 },
  { key: "1y",  label: "1J",    days: 365, bucketDays: 30 },
  { key: "all", label: "Alles", days: null, bucketDays: null },
] as const;
type ChartPeriodKey = typeof CHART_PERIODS[number]["key"];

interface BucketPoint { date: Date; min: number; avg: number; max: number; hasBonus: boolean }

function getMetricValue(h: HistoryEntry, unitType: string): number | null {
  if (unitType === "weight"  && h.price_per_kg)    return Number(h.price_per_kg);
  if (unitType === "volume"  && h.price_per_litre) return Number(h.price_per_litre);
  if (unitType === "pieces"  && h.price_per_piece) return Number(h.price_per_piece);
  return Number(h.effective_price) || null;
}

function buildBuckets(
  history: HistoryEntry[],
  unitType: string,
  periodDays: number | null,
  bucketDays: number | null,
): BucketPoint[] {
  const now = Date.now();
  const cutoff = periodDays ? now - periodDays * 86_400_000 : null;
  const relevant = history.filter(h => cutoff === null || new Date(h.scraped_at).getTime() >= cutoff);
  if (relevant.length === 0) return [];

  const firstT = new Date(relevant[0].scraped_at).getTime();
  const lastT  = new Date(relevant[relevant.length - 1].scraped_at).getTime();
  const totalDays = Math.max(1, (lastT - firstT) / 86_400_000);
  const bd = bucketDays ?? (totalDays <= 30 ? 1 : totalDays <= 90 ? 7 : totalDays <= 365 ? 14 : 30);

  const map = new Map<number, { vals: number[]; hasBonus: boolean }>();
  for (const h of relevant) {
    const v = getMetricValue(h, unitType);
    if (!v || v <= 0) continue;
    const idx = Math.floor((new Date(h.scraped_at).getTime() - firstT) / (bd * 86_400_000));
    if (!map.has(idx)) map.set(idx, { vals: [], hasBonus: false });
    const b = map.get(idx)!;
    b.vals.push(v);
    if (h.is_bonus) b.hasBonus = true;
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([idx, { vals, hasBonus }]) => ({
      date: new Date(firstT + idx * bd * 86_400_000),
      min:  Math.min(...vals),
      avg:  vals.reduce((s, v) => s + v, 0) / vals.length,
      max:  Math.max(...vals),
      hasBonus,
    }));
}

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return `€${Number(v).toFixed(2)}`;
}

function unitPrice(p: Product): { label: string; value: number } | null {
  const s = p.latest_snapshot;
  if (!s) return null;
  if (s.price_per_kg)    return { label: "/kg", value: Number(s.price_per_kg) };
  if (s.price_per_litre) return { label: "/l",  value: Number(s.price_per_litre) };
  if (s.price_per_piece) return { label: "/st", value: Number(s.price_per_piece) };
  return null;
}

function effPrice(p: Product): number | null {
  const s = p.latest_snapshot;
  if (!s || s.price === 0) return null;
  return Number(s.is_bonus && s.bonus_price ? s.bonus_price : s.price);
}

function PriceChart({
  history,
  unitType,
  unitLabel,
}: {
  history: HistoryEntry[];
  unitType: string;
  unitLabel: string | null;
}) {
  const [period, setPeriod] = useState<ChartPeriodKey>("3m");
  const cfg = CHART_PERIODS.find(p => p.key === period)!;
  const pts = buildBuckets(history, unitType, cfg.days, cfg.bucketDays);

  if (pts.length < 2) {
    return (
      <div className="d-flex justify-content-end gap-1 mb-3">
        {CHART_PERIODS.map(c => (
          <button key={c.key} onClick={() => setPeriod(c.key)}
            className={`btn btn-sm ${period === c.key ? "btn-secondary" : "btn-outline-secondary"}`}
            style={{ fontSize: "0.72rem", padding: "2px 8px" }}>
            {c.label}
          </button>
        ))}
      </div>
    );
  }

  const W = 600, H = 140;
  const PAD = { top: 14, right: 8, bottom: 22, left: 44 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;

  const allVals = pts.flatMap(p => [p.min, p.avg, p.max]);
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);
  const vRange = hi - lo || 1;
  const padding = vRange * 0.08;
  const loP = lo - padding;
  const hiP = hi + padding;
  const vRangeP = hiP - loP;

  const toX = (i: number) => PAD.left + (i / Math.max(pts.length - 1, 1)) * iW;
  const toY = (v: number) => PAD.top + ((hiP - v) / vRangeP) * iH;
  const line = (fn: (p: BucketPoint) => number) => pts.map((p, i) => `${toX(i)},${toY(fn(p))}`).join(" ");

  const areaPath =
    `M ${pts.map((p, i) => `${toX(i)},${toY(p.max)}`).join(" L ")} ` +
    `L ${[...pts].reverse().map((p, i) => `${toX(pts.length - 1 - i)},${toY(p.min)}`).join(" L ")} Z`;

  const yTicks = [loP + vRangeP * 0.05, loP + vRangeP * 0.5, loP + vRangeP * 0.95];
  const labelStep = Math.max(1, Math.ceil(pts.length / 5));
  const xLabels = pts
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i === 0 || i === pts.length - 1 || i % labelStep === 0)
    .map(({ p, i }) => ({
      x: toX(i),
      label: p.date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }),
    }));

  return (
    <div className="mb-3">
      <div className="d-flex justify-content-end gap-1 mb-2">
        {CHART_PERIODS.map(c => (
          <button key={c.key} onClick={() => setPeriod(c.key)}
            className={`btn btn-sm ${period === c.key ? "btn-secondary" : "btn-outline-secondary"}`}
            style={{ fontSize: "0.72rem", padding: "2px 8px" }}>
            {c.label}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxHeight: 160, display: "block" }}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)} stroke="#dee2e6" strokeWidth={0.5} />
            <text x={PAD.left - 3} y={toY(v) + 3} fontSize={8} fill="#adb5bd" textAnchor="end">€{v.toFixed(2)}</text>
          </g>
        ))}
        <path d={areaPath} fill="rgba(0,100,200,0.07)" />
        <polyline points={line(p => p.max)} fill="none" stroke="#dc3545" strokeWidth={1} strokeDasharray="3,2" opacity={0.7} />
        <polyline points={line(p => p.min)} fill="none" stroke="#198754" strokeWidth={1} strokeDasharray="3,2" opacity={0.7} />
        <polyline points={line(p => p.avg)} fill="none" stroke="#003d9b" strokeWidth={2} />
        {pts.map((p, i) => p.hasBonus
          ? <circle key={i} cx={toX(i)} cy={toY(p.avg)} r={3} fill="#fd7e14" />
          : null
        )}
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={H - 4} fontSize={8} fill="#adb5bd" textAnchor="middle">{l.label}</text>
        ))}
      </svg>
      <div className="d-flex gap-3 justify-content-center" style={{ fontSize: "0.7rem" }}>
        <span className="text-muted"><span style={{ color: "#198754" }}>– –</span> Min</span>
        <span className="text-muted"><span style={{ color: "#003d9b", fontWeight: 700 }}>—</span> Gem{unitLabel ?? ""}</span>
        <span className="text-muted"><span style={{ color: "#dc3545" }}>– –</span> Max</span>
        <span className="text-muted"><span style={{ color: "#fd7e14" }}>●</span> Bonus</span>
      </div>
    </div>
  );
}

function StatsTable({ periods }: { periods: Record<string, PeriodStats> }) {
  const unitLabel = Object.values(periods)[0]?.unit_label;
  return (
    <Table size="sm" bordered responsive className="mb-0">
      <thead className="table-light">
        <tr>
          <th>Periode</th>
          <th>Min prijs</th>
          <th>Gem. prijs</th>
          <th>Max prijs</th>
          {unitLabel && <th>Min{unitLabel}</th>}
          {unitLabel && <th>Gem.{unitLabel}</th>}
          {unitLabel && <th>Max{unitLabel}</th>}
          <th className="text-end">Meting</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(PERIOD_LABELS).map(([key, label]) => {
          const s = periods[key];
          if (!s || s.count === 0) return null;
          return (
            <tr key={key}>
              <td className="fw-semibold">{label}</td>
              <td className="text-success fw-semibold">{fmt(s.min_price)}</td>
              <td>{fmt(s.avg_price)}</td>
              <td className="text-danger">{fmt(s.max_price)}</td>
              {unitLabel && <td className="text-success fw-semibold">{fmt(s.min_per_unit)}</td>}
              {unitLabel && <td>{fmt(s.avg_per_unit)}</td>}
              {unitLabel && <td className="text-danger">{fmt(s.max_per_unit)}</td>}
              <td className="text-end text-muted">{s.count}×</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function EditGroupModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [groupName, setGroupName] = useState(product.product_group_name ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/products/${product.id}/group`, {
        group_name: groupName.trim() || null,
      });
      showToast("Groep bijgewerkt", "success");
      onSaved();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal show onHide={onClose} size="sm">
      <Modal.Header closeButton>
        <Modal.Title className="h6">Groep aanpassen</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="small text-muted mb-2">{product.name}</p>
        <Form.Label className="small fw-semibold">Groepsnaam</Form.Label>
        <Form.Control
          size="sm"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Leeg = automatisch bepaald bij volgende scrape"
        />
        <Form.Text className="text-muted">
          Handmatig invullen = vastgezet (scraper overschrijft niet).
          Leeg laten = scraper bepaalt opnieuw op basis van productnaam.
        </Form.Text>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" size="sm" onClick={onClose}>Annuleer</Button>
        <Button className="btn-ah" size="sm" onClick={save} disabled={saving}>
          {saving && <Spinner size="sm" className="me-1" />}Opslaan
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function VariantsSection({ currentId, variants }: { currentId: number; variants: Product[] }) {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const withPrice = variants.filter((p) => effPrice(p) !== null);
  const cheapestUnitPrice = withPrice.reduce<number | null>((min, p) => {
    const up = unitPrice(p);
    if (!up) return min;
    return min === null ? up.value : Math.min(min, up.value);
  }, null);

  function handleSaved(p: Product) {
    mutate(`/products/${p.id}`);
    mutate(`/products/${currentId}/variants`);
  }

  return (
    <>
      <Card className="shadow-sm mb-3">
        <Card.Header className="bg-white d-flex justify-content-between align-items-center">
          <span className="fw-semibold">Verpakkingsvarianten ({variants.length})</span>
          <span className="text-muted small">gesorteerd op prijs per eenheid</span>
        </Card.Header>
        <div style={{ overflowX: "auto" }}>
          <Table size="sm" className="mb-0" hover>
            <thead className="table-light">
              <tr>
                <th></th>
                <th>Product</th>
                <th>Prijs</th>
                <th>Per eenheid</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {variants.map((p) => {
                const s = p.latest_snapshot;
                const ep = effPrice(p);
                const up = unitPrice(p);
                const isCurrent = p.id === currentId;
                const isCheapestUnit = up !== null && cheapestUnitPrice !== null && up.value === cheapestUnitPrice;

                return (
                  <tr
                    key={p.id}
                    className={isCurrent ? "table-active" : ""}
                    style={{ fontSize: "0.85rem" }}
                  >
                    <td style={{ width: 44 }}>
                      {p.image_url && (
                        <img
                          src={p.image_url}
                          alt=""
                          style={{ width: 32, height: 32, objectFit: "contain" }}
                        />
                      )}
                    </td>
                    <td>
                      {isCurrent ? (
                        <span className="fw-semibold">{p.name}</span>
                      ) : (
                        <Link href={`/products/${p.id}`} className="text-decoration-none text-dark">
                          {p.name}
                        </Link>
                      )}
                      {p.group_override && (
                        <Badge bg="warning" text="dark" className="ms-1 fw-normal" style={{ fontSize: "0.6rem" }}>
                          handmatig
                        </Badge>
                      )}
                    </td>
                    <td className="text-nowrap">
                      {ep !== null && ep > 0 ? (
                        <>
                          <span className={`fw-semibold ${s?.is_bonus ? "text-danger" : ""}`}>
                            €{ep.toFixed(2)}
                          </span>
                          {s?.is_bonus && s.bonus_price && (
                            <span className="text-muted text-decoration-line-through ms-1" style={{ fontSize: "0.78rem" }}>
                              €{Number(s.price).toFixed(2)}
                            </span>
                          )}
                          {s?.is_bonus && (
                            <Badge bg="danger" className="ms-1 fw-normal" style={{ fontSize: "0.55rem" }}>BONUS</Badge>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">onbekend</span>
                      )}
                    </td>
                    <td className="text-nowrap">
                      {up ? (
                        <span className={isCheapestUnit ? "text-success fw-semibold" : ""}>
                          {isCheapestUnit && "⭐ "}
                          €{up.value.toFixed(2)}{up.label}
                        </span>
                      ) : "—"}
                    </td>
                    <td>
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        className="p-0 px-1 lh-1"
                        style={{ fontSize: "0.7rem" }}
                        onClick={() => setEditingProduct(p)}
                        title="Groep aanpassen"
                      >
                        ✎
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </Card>

      {editingProduct && (
        <EditGroupModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => handleSaved(editingProduct)}
        />
      )}
    </>
  );
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [showHistory, setShowHistory] = useState(false);
  const [editingNameEn, setEditingNameEn] = useState(false);
  const [filterProductId, setFilterProductId] = useState<number | null>(null);

  const { data: product, isLoading: loadingProduct, mutate: mutateProduct } = useSWR(
    `/products/${id}`,
    (url: string) => api.get<Product>(url)
  );

  const statsKey = filterProductId
    ? `/products/${id}/price-stats?filter_product_id=${filterProductId}`
    : `/products/${id}/price-stats`;

  const { data: stats, isLoading: loadingStats } = useSWR(
    statsKey,
    (url: string) => api.get<PriceStats>(url)
  );

  const { data: variants } = useSWR(
    product?.product_group_name ? `/products/${id}/variants` : null,
    (url: string) => api.get<Product[]>(url)
  );

  const { data: orderStats } = useSWR(
    `/products/${id}/order-stats`,
    (url: string) => api.get<OrderStats | null>(url).catch(() => null)
  );

  const s = product?.latest_snapshot;

  return (
    <div style={{ maxWidth: 800 }}>
      <button
        className="btn btn-link text-muted small p-0 mb-3 d-inline-block"
        onClick={() => router.back()}
      >
        ← Terug naar producten
      </button>

      {loadingProduct && <div className="text-center py-5"><Spinner /></div>}

      {product && (
        <Card className="shadow-sm mb-4">
          <Card.Body>
            <Row className="g-3 align-items-start">
              {product.image_url && (
                <Col xs="auto">
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="rounded"
                    style={{ width: 110, height: 110, objectFit: "contain" }}
                  />
                </Col>
              )}
              <Col>
                {/* Name */}
                <h1 className="h4 mb-1">{product.name}</h1>

                {/* English name */}
                <div className="mb-2">
                  {product.name_en ? (
                    <span className="text-muted small">
                      {product.name_en}{" "}
                      <Button variant="link" size="sm" className="p-0 lh-1 text-muted"
                        style={{ fontSize: "0.75rem" }} onClick={() => setEditingNameEn(true)}>✎</Button>
                    </span>
                  ) : (
                    <Button variant="link" size="sm" className="p-0 text-muted"
                      style={{ fontSize: "0.75rem" }} onClick={() => setEditingNameEn(true)}>
                      + Engelse naam toevoegen
                    </Button>
                  )}
                </div>

                {/* Brand · category */}
                <div className="text-muted small mb-3 d-flex flex-wrap align-items-center gap-1">
                  {product.brand && <span>{product.brand}</span>}
                  {product.brand && product.category && <span>·</span>}
                  {product.category && (
                    <Link
                      href={`/products?q=${encodeURIComponent(product.sub_category ?? product.category)}`}
                      className="text-muted text-decoration-underline"
                    >
                      {product.category}
                      {product.sub_category && ` › ${product.sub_category}`}
                    </Link>
                  )}
                </div>

                {/* Price */}
                {s && (
                  <div className="mb-3">
                    <div className="d-flex align-items-baseline gap-2 flex-wrap mb-2">
                      <span className={`fs-4 fw-bold ${s.is_bonus ? "text-danger" : ""}`}>
                        €{Number(s.is_bonus && s.bonus_price ? s.bonus_price : s.price).toFixed(2)}
                      </span>
                      {s.is_bonus && s.bonus_price && (
                        <span className="text-muted text-decoration-line-through fs-6">
                          €{Number(s.price).toFixed(2)}
                        </span>
                      )}
                      {s.is_bonus && <Badge bg="danger">BONUS</Badge>}
                      {s.bonus_until && (
                        <span className="text-muted small">
                          t/m {new Date(s.bonus_until).toLocaleDateString("nl-NL")}
                        </span>
                      )}
                    </div>

                    {/* Unit prices as badges */}
                    <div className="d-flex flex-wrap gap-2">
                      {s.price_per_kg && (
                        <Badge bg="light" text="dark" className="border fw-normal">
                          €{Number(s.price_per_kg).toFixed(2)}/kg
                        </Badge>
                      )}
                      {s.price_per_100g && (
                        <Badge bg="light" text="dark" className="border fw-normal">
                          €{Number(s.price_per_100g).toFixed(2)}/100g
                        </Badge>
                      )}
                      {s.price_per_litre && (
                        <Badge bg="light" text="dark" className="border fw-normal">
                          €{Number(s.price_per_litre).toFixed(2)}/l
                        </Badge>
                      )}
                      {s.price_per_100ml && (
                        <Badge bg="light" text="dark" className="border fw-normal">
                          €{Number(s.price_per_100ml).toFixed(2)}/100ml
                        </Badge>
                      )}
                      {s.price_per_piece && (
                        <Badge bg="light" text="dark" className="border fw-normal">
                          €{Number(s.price_per_piece).toFixed(2)}/st
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {/* Group + type */}
                {(product.product_group_name || product.product_type_group) && (
                  <div className="border-top pt-2 d-flex flex-wrap gap-3">
                    {product.product_group_name && (
                      <div className="d-flex align-items-center gap-1">
                        <span className="text-muted small">Groep:</span>
                        <Link
                          href={`/products?view=groups&q=${encodeURIComponent(product.product_group_name)}`}
                          className="text-decoration-none"
                        >
                          <Badge bg="light" text="dark" className="border fw-normal" style={{ fontSize: "0.72rem", cursor: "pointer" }}>
                            {product.product_group_name}
                          </Badge>
                        </Link>
                        {product.group_override && (
                          <Badge bg="warning" text="dark" className="fw-normal" style={{ fontSize: "0.65rem" }}>handmatig</Badge>
                        )}
                      </div>
                    )}
                    {product.product_type_group && (
                      <div className="d-flex align-items-center gap-1">
                        <span className="text-muted small">Type:</span>
                        <Link
                          href={`/products?view=types&q=${encodeURIComponent(product.product_type_group)}`}
                          className="text-decoration-none"
                        >
                          <Badge bg="light" text="dark" className="border fw-normal" style={{ fontSize: "0.72rem", cursor: "pointer" }}>
                            {product.product_type_group}
                          </Badge>
                        </Link>
                        {product.type_group_override && (
                          <Badge bg="warning" text="dark" className="fw-normal" style={{ fontSize: "0.65rem" }}>handmatig</Badge>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Col>
            </Row>

            {/* Order history stats */}
            {orderStats && (
              <div className="mt-3 pt-3 border-top">
                <div className="small fw-medium mb-2 text-muted">Aankoopgeschiedenis</div>
                <div className="d-flex flex-wrap gap-3 small">
                  <div>
                    <span className="text-muted">Gekocht:</span>{" "}
                    <strong>{orderStats.times_ordered}×</strong>
                    {orderStats.last_ordered_at && (
                      <span className="text-muted ms-1">
                        (laatste: {new Date(orderStats.last_ordered_at).toLocaleDateString("nl-NL")})
                      </span>
                    )}
                  </div>
                  {orderStats.min_per_kg != null && (
                    <div>
                      <span className="text-muted">Goedkoopste:</span>{" "}
                      <strong className="text-success">€{orderStats.min_per_kg.toFixed(2)}/kg</strong>
                      {orderStats.avg_per_kg != null && (
                        <span className="text-muted ms-1">(gem. €{orderStats.avg_per_kg.toFixed(2)}/kg)</span>
                      )}
                    </div>
                  )}
                  {orderStats.min_per_litre != null && (
                    <div>
                      <span className="text-muted">Goedkoopste:</span>{" "}
                      <strong className="text-success">€{orderStats.min_per_litre.toFixed(2)}/l</strong>
                      {orderStats.avg_per_litre != null && (
                        <span className="text-muted ms-1">(gem. €{orderStats.avg_per_litre.toFixed(2)}/l)</span>
                      )}
                    </div>
                  )}
                  {orderStats.min_per_piece != null && (
                    <div>
                      <span className="text-muted">Goedkoopste:</span>{" "}
                      <strong className="text-success">€{orderStats.min_per_piece.toFixed(2)}/st</strong>
                      {orderStats.avg_per_piece != null && (
                        <span className="text-muted ms-1">(gem. €{orderStats.avg_per_piece.toFixed(2)}/st)</span>
                      )}
                    </div>
                  )}
                  {orderStats.min_per_kg == null && orderStats.min_per_litre == null && orderStats.min_per_piece == null && orderStats.min_price_paid != null && (
                    <div>
                      <span className="text-muted">Goedkoopste:</span>{" "}
                      <strong className="text-success">€{orderStats.min_price_paid.toFixed(2)}</strong>
                      {orderStats.avg_price_paid != null && (
                        <span className="text-muted ms-1">(gem. €{orderStats.avg_price_paid.toFixed(2)})</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      {editingNameEn && product && (
        <EditNameEnModal
          product={product}
          onClose={() => setEditingNameEn(false)}
          onSaved={(updated) => { mutateProduct(updated, false); setEditingNameEn(false); }}
        />
      )}

      {/* Package variants */}
      {variants && variants.length > 1 && (
        <VariantsSection currentId={Number(id)} variants={variants} />
      )}

      {/* Price history stats */}
      <Card className="shadow-sm mb-3">
        <Card.Header className="bg-white d-flex align-items-center justify-content-between flex-wrap gap-2">
          <span className="fw-semibold">Prijsgeschiedenis</span>
          {stats && stats.group_products.length > 1 && (
            <div className="d-flex align-items-center gap-1 flex-wrap">
              <span className="text-muted" style={{ fontSize: "0.75rem" }}>Filter:</span>
              <Button
                size="sm"
                variant={filterProductId === null ? "secondary" : "outline-secondary"}
                style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                onClick={() => setFilterProductId(null)}
              >
                Gehele groep ({stats.group_products.length})
              </Button>
              {stats.group_products.map((gp) => (
                <Button
                  key={gp.id}
                  size="sm"
                  variant={filterProductId === gp.id ? "secondary" : "outline-secondary"}
                  style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                  onClick={() => setFilterProductId(gp.id)}
                  title={gp.name}
                >
                  {gp.name.length > 28 ? gp.name.slice(0, 26) + "…" : gp.name}
                </Button>
              ))}
            </div>
          )}
        </Card.Header>
        <Card.Body>
          {loadingStats && <Spinner size="sm" />}
          {stats && (
            <>
              {stats.group_products.length > 1 && filterProductId === null && (
                <div className="mb-2 text-muted" style={{ fontSize: "0.78rem" }}>
                  Statistieken over alle {stats.group_products.length} varianten in groep <strong>{stats.group_name}</strong>.
                  Min prijs = goedkoopste deal (incl. bonus) van alle varianten.
                </div>
              )}
              <PriceChart
                history={stats.history}
                unitType={stats.unit_type}
                unitLabel={Object.values(stats.periods)[0]?.unit_label ?? null}
              />
              <StatsTable periods={stats.periods} />
              <div className="mt-2 text-muted" style={{ fontSize: "0.72rem" }}>
                Min prijs = laagste effectieve prijs (incl. bonus). Bonus korting per eenheid is opgenomen in /kg · /l · /st kolommen.
              </div>
            </>
          )}
        </Card.Body>
      </Card>

      {/* Raw history toggle */}
      {stats && stats.history.length > 0 && (
        <div className="mb-3">
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Verberg" : "Toon"} alle meetpunten ({stats.history.length})
          </Button>
          {showHistory && (
            <Table size="sm" bordered responsive className="mt-2">
              <thead className="table-light">
                <tr>
                  {stats.group_products.length > 1 && filterProductId === null && <th>Product</th>}
                  <th>Datum</th>
                  <th>Prijs</th>
                  <th>Effectief</th>
                  <th>Bonus</th>
                  <th>/kg</th>
                  <th>/l</th>
                  <th>/st</th>
                </tr>
              </thead>
              <tbody style={{ fontSize: "0.78rem" }}>
                {[...stats.history].reverse().map((h, i) => (
                  <tr key={i} className={h.is_bonus ? "table-warning" : ""}>
                    {stats.group_products.length > 1 && filterProductId === null && (
                      <td className="text-muted" style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {h.product_name ?? "—"}
                      </td>
                    )}
                    <td>{new Date(h.scraped_at).toLocaleDateString("nl-NL")}</td>
                    <td>€{Number(h.price).toFixed(2)}</td>
                    <td className={h.is_bonus ? "text-danger fw-semibold" : ""}>
                      €{Number(h.effective_price).toFixed(2)}
                    </td>
                    <td>{h.is_bonus ? "✓" : ""}</td>
                    <td>{h.price_per_kg ? `€${Number(h.price_per_kg).toFixed(2)}` : ""}</td>
                    <td>{h.price_per_litre ? `€${Number(h.price_per_litre).toFixed(2)}` : ""}</td>
                    <td>{h.price_per_piece ? `€${Number(h.price_per_piece).toFixed(2)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
