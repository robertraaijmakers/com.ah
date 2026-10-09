"use client";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import InputGroup from "react-bootstrap/InputGroup";
import ListGroup from "react-bootstrap/ListGroup";
import Modal from "react-bootstrap/Modal";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api, type Product, type ProductSnapshot, type BundleInfo, type OrderBought } from "@/lib/api";
import { useToast } from "@/lib/toast";

const PAGE_SIZE = 48;
const GROUP_PAGE_SIZE = 20;

interface ProductsPage {
  total: number;
  items: Product[];
}

interface ProductGroupOut {
  group_name: string;
  variant_count: number;
  products: Product[];
}

interface ProductGroupsPage {
  total_groups: number;
  groups: ProductGroupOut[];
}

interface TypeGroupOut {
  type_group: string;
  product_count: number;
  brands: string[];
  min_price: number | null;
  max_price: number | null;
}

interface TypeGroupsPage {
  total_groups: number;
  groups: TypeGroupOut[];
}

interface Suggestion {
  id: number;
  name: string;
  name_en: string | null;
  brand: string | null;
}

type Snap = NonNullable<Product["latest_snapshot"]>;

function unitPrice(s: Snap): { label: string; value: string } | null {
  if (s.price_per_kg) return { label: "/kg", value: `€${Number(s.price_per_kg).toFixed(2)}` };
  if (s.price_per_litre) return { label: "/l", value: `€${Number(s.price_per_litre).toFixed(2)}` };
  if (s.price_per_piece) return { label: "/st", value: `€${Number(s.price_per_piece).toFixed(2)}` };
  if (s.price_per_100g) return { label: "/100g", value: `€${Number(s.price_per_100g).toFixed(2)}` };
  if (s.price_per_100ml) return { label: "/100ml", value: `€${Number(s.price_per_100ml).toFixed(2)}` };
  return null;
}

function effPrice(s: Snap): number {
  return Number(s.is_bonus && s.bonus_price ? s.bonus_price : s.price);
}

function orderMinUnitPrice(ob: OrderBought): string | null {
  if (ob.min_per_kg != null) return `€${Number(ob.min_per_kg).toFixed(2)}/kg`;
  if (ob.min_per_litre != null) return `€${Number(ob.min_per_litre).toFixed(2)}/l`;
  if (ob.min_per_piece != null) return `€${Number(ob.min_per_piece).toFixed(2)}/st`;
  if (ob.min_price_paid != null) return `€${Number(ob.min_price_paid).toFixed(2)}`;
  return null;
}

function bundleUnitPrice(b: BundleInfo): string | null {
  if (b.price_per_kg) return `€${Number(b.price_per_kg).toFixed(2)}/kg`;
  if (b.price_per_litre) return `€${Number(b.price_per_litre).toFixed(2)}/l`;
  if (b.price_per_piece) return `€${Number(b.price_per_piece).toFixed(2)}/st`;
  return null;
}

function isBundleCheaperPerUnit(s: ProductSnapshot | null, b: BundleInfo): boolean {
  if (!s) return false;
  const singlePpu = s.price_per_kg ?? s.price_per_litre ?? s.price_per_piece ?? null;
  const bundlePpu = b.price_per_kg ?? b.price_per_litre ?? b.price_per_piece ?? null;
  if (singlePpu == null || bundlePpu == null) return false;
  return Number(bundlePpu) < Number(singlePpu);
}

function ProductCard({ p, onGroupChanged }: { p: Product; onGroupChanged?: () => void }) {
  const s = p.latest_snapshot;
  const up = s ? unitPrice(s) : null;
  const ep = s ? effPrice(s) : null;
  const bundleCheaper = p.bundle ? isBundleCheaperPerUnit(s, p.bundle) : false;
  const bundlePpu = p.bundle ? bundleUnitPrice(p.bundle) : null;
  return (
    <Card
      as={Link}
      href={`/products/${p.id}`}
      className="h-100 shadow-sm text-decoration-none text-reset"
      style={{ cursor: "pointer" }}
    >
      {p.image_url && (
        <Card.Img
          variant="top"
          src={p.image_url}
          alt={p.name}
          style={{ height: 120, objectFit: "contain", padding: "0.5rem" }}
        />
      )}
      <Card.Body className="d-flex flex-column p-2">
        <Card.Text
          className="small fw-medium mb-1"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {p.name}
        </Card.Text>
        {p.brand && (
          <div className="text-muted" style={{ fontSize: "0.7rem" }}>{p.brand}</div>
        )}
        {s && ep !== null && ep > 0 && (
          <div className="mt-auto pt-2">
            <div className="d-flex align-items-baseline gap-1 flex-wrap">
              <span className={`fw-bold ${s.is_bonus ? "text-danger" : ""}`}>
                €{ep.toFixed(2)}
              </span>
              {s.is_bonus && s.bonus_price && (
                <span className="text-muted text-decoration-line-through small">
                  €{Number(s.price).toFixed(2)}
                </span>
              )}
              {s.is_bonus && (
                <Badge bg="danger" className="fw-normal" style={{ fontSize: "0.6rem" }}>
                  BONUS
                </Badge>
              )}
            </div>
            {up && (
              <div className="fw-semibold text-muted" style={{ fontSize: "0.75rem" }}>
                {up.value}
                <span className="fw-normal">{up.label}</span>
              </div>
            )}
          </div>
        )}
        {p.bundle && bundlePpu && (
          <div className="mt-1">
            <Badge
              bg={bundleCheaper ? "success" : "secondary"}
              className="fw-normal"
              style={{ fontSize: "0.6rem" }}
              title={p.bundle.name}
            >
              bundel {bundlePpu}
            </Badge>
          </div>
        )}
        {p.order_bought && (() => {
          const minPpu = orderMinUnitPrice(p.order_bought!);
          return minPpu ? (
            <div className="mt-1">
              <Badge
                bg="light"
                text="dark"
                className="fw-normal border"
                style={{ fontSize: "0.6rem" }}
                title={`${p.order_bought!.times}× gekocht`}
              >
                gekocht v.a. {minPpu}
              </Badge>
            </div>
          ) : null;
        })()}
      </Card.Body>
    </Card>
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
        <Form.Label className="small">Groepsnaam</Form.Label>
        <Form.Control
          size="sm"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Leeg = automatisch (wordt overschreven bij scrape)"
        />
        <Form.Text className="text-muted">
          Leeg laten = scraper bepaalt groep opnieuw. Handmatig invullen = blijft vastzetten.
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

function GroupVariantRow({
  p,
  isFirst,
  onEditGroup,
}: {
  p: Product;
  isFirst: boolean;
  onEditGroup: (p: Product) => void;
}) {
  const s = p.latest_snapshot;
  const up = s ? unitPrice(s) : null;
  const ep = s ? effPrice(s) : null;

  return (
    <ListGroup.Item className="py-2 px-3 d-flex align-items-center gap-2">
      {p.image_url && (
        <img
          src={p.image_url}
          alt=""
          style={{ width: 36, height: 36, objectFit: "contain", flexShrink: 0 }}
        />
      )}
      <div className="flex-grow-1 min-w-0">
        <div className="d-flex align-items-center gap-1 flex-wrap">
          {isFirst && <Badge bg="success" style={{ fontSize: "0.6rem" }} className="fw-normal">goedkoopst</Badge>}
          <Link
            href={`/products/${p.id}`}
            className="text-decoration-none text-dark fw-medium small"
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {p.name}
          </Link>
        </div>
        {p.brand && <div className="text-muted" style={{ fontSize: "0.7rem" }}>{p.brand}</div>}
      </div>
      <div className="text-end text-nowrap ms-2">
        {s && ep !== null && ep > 0 ? (
          <>
            <div className={`fw-bold small ${s.is_bonus ? "text-danger" : ""}`}>
              €{ep.toFixed(2)}
              {s.is_bonus && <Badge bg="danger" className="ms-1 fw-normal" style={{ fontSize: "0.55rem" }}>BONUS</Badge>}
            </div>
            {s.price_per_piece != null && (
              <div className="fw-semibold" style={{ fontSize: "0.72rem" }}>
                €{Number(s.price_per_piece).toFixed(2)}<span className="fw-normal text-muted">/st</span>
              </div>
            )}
            {(s.price_per_kg || s.price_per_litre) && (
              <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                {s.price_per_kg
                  ? `€${Number(s.price_per_kg).toFixed(2)}/kg`
                  : `€${Number(s.price_per_litre).toFixed(2)}/l`}
              </div>
            )}
          </>
        ) : (
          <span className="text-muted small">Prijs onbekend</span>
        )}
      </div>
      <Button
        variant="outline-secondary"
        size="sm"
        className="p-0 px-1 lh-1 flex-shrink-0"
        style={{ fontSize: "0.7rem" }}
        onClick={(e) => { e.preventDefault(); onEditGroup(p); }}
        title="Groep aanpassen"
      >
        ✎
      </Button>
    </ListGroup.Item>
  );
}

function GroupCard({
  group,
  onGroupChanged,
}: {
  group: ProductGroupOut;
  onGroupChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const cheapest = group.products[0];
  const cs = cheapest?.latest_snapshot;
  const cep = cs ? effPrice(cs) : null;
  const cup = cs ? unitPrice(cs) : null;

  const priceRange = group.products.reduce(
    (acc, p) => {
      const ep = p.latest_snapshot ? effPrice(p.latest_snapshot) : 0;
      if (ep <= 0) return acc;
      return { min: Math.min(acc.min, ep), max: Math.max(acc.max, ep) };
    },
    { min: Infinity, max: -Infinity }
  );
  const hasRange = priceRange.min !== Infinity && priceRange.min !== priceRange.max;

  return (
    <>
      <Card className="shadow-sm mb-3">
        <Card.Header
          className="d-flex align-items-center gap-2 py-2 px-3"
          style={{ cursor: "pointer", userSelect: "none" }}
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex-grow-1 min-w-0">
            <span className="fw-semibold small">{group.group_name}</span>
          </div>
          <div className="d-flex align-items-center gap-2 text-nowrap ms-2">
            {cep !== null && cep > 0 && (
              <span className="small">
                <span className={`fw-bold ${cs?.is_bonus ? "text-danger" : ""}`}>€{cep.toFixed(2)}</span>
                {hasRange && (
                  <span className="text-muted ms-1">– €{priceRange.max.toFixed(2)}</span>
                )}
                {cup && <span className="text-muted ms-1" style={{ fontSize: "0.72rem" }}>{cup.value}{cup.label}</span>}
              </span>
            )}
            <Badge bg={group.variant_count > 1 ? "primary" : "secondary"} className="fw-normal" style={{ fontSize: "0.65rem" }}>
              {group.variant_count} {group.variant_count === 1 ? "variant" : "varianten"}
            </Badge>
            <span className="text-muted small">{expanded ? "▲" : "▼"}</span>
          </div>
        </Card.Header>

        {expanded && (
          <ListGroup variant="flush">
            {group.products.map((p, i) => (
              <GroupVariantRow
                key={p.id}
                p={p}
                isFirst={i === 0}
                onEditGroup={setEditingProduct}
              />
            ))}
          </ListGroup>
        )}
      </Card>

      {editingProduct && (
        <EditGroupModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => { setEditingProduct(null); onGroupChanged(); }}
        />
      )}
    </>
  );
}

function TypeGroupCard({ group }: { group: TypeGroupOut }) {
  const [expanded, setExpanded] = useState(false);
  const hasRange = group.min_price !== null && group.max_price !== null && group.min_price !== group.max_price;

  const { data: products, isLoading } = useSWR(
    expanded ? `/products/?type_group=${encodeURIComponent(group.type_group)}&limit=50` : null,
    (url: string) => api.get<ProductsPage>(url),
    { dedupingInterval: 30000 }
  );

  return (
    <Card className="shadow-sm mb-3">
      <Card.Header
        className="py-2 px-3 d-flex align-items-center gap-2"
        style={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-grow-1 min-w-0">
          <span className="fw-semibold">{group.type_group}</span>
          {group.brands.length > 0 && (
            <div className="text-muted small mt-1">
              {group.brands.join(" · ")}
              {group.brands.length === 10 && " …"}
            </div>
          )}
        </div>
        <div className="d-flex align-items-center gap-2 text-nowrap">
          {group.min_price !== null && (
            <span className="small">
              <span className="fw-bold">€{group.min_price.toFixed(2)}</span>
              {hasRange && <span className="text-muted"> – €{group.max_price!.toFixed(2)}</span>}
            </span>
          )}
          <Badge bg="primary" className="fw-normal" style={{ fontSize: "0.65rem" }}>
            {group.product_count} {group.product_count === 1 ? "product" : "producten"}
          </Badge>
          <span className="text-muted small">{expanded ? "▲" : "▼"}</span>
        </div>
      </Card.Header>
      {expanded && (
        <Card.Body className="py-2 px-3">
          {isLoading && <Spinner size="sm" />}
          {products && (
            <Row xs={2} md={3} lg={4} className="g-2">
              {products.items.map((p) => (
                <Col key={p.id}>
                  <ProductCard p={p} />
                </Col>
              ))}
            </Row>
          )}
        </Card.Body>
      )}
    </Card>
  );
}

function ProductsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [inputValue, setInputValue] = useState(() => searchParams.get("q") ?? "");
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [bonusOnly, setBonusOnly] = useState(() => searchParams.get("bonus") === "true");
  const [viewMode, setViewMode] = useState<"list" | "groups" | "types">(() => {
    const v = searchParams.get("view");
    return v === "groups" || v === "types" ? v : "list";
  });
  const [offset, setOffset] = useState(0);
  const [groupOffset, setGroupOffset] = useState(0);
  const [allItems, setAllItems] = useState<Product[]>([]);
  const [allGroups, setAllGroups] = useState<ProductGroupOut[]>([]);
  const [allTypeGroups, setAllTypeGroups] = useState<TypeGroupOut[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [groupRefreshKey, setGroupRefreshKey] = useState(0);
  const [typeGroupOffset, setTypeGroupOffset] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Sync key state to URL so browser back/forward restores the search
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (bonusOnly) params.set("bonus", "true");
    if (viewMode !== "list") params.set("view", viewMode);
    const search = params.toString();
    router.replace(pathname + (search ? "?" + search : ""), { scroll: false });
  }, [query, bonusOnly, viewMode]);

  const handleInput = useCallback((value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(value);
      setOffset(0);
      setAllItems([]);
      setGroupOffset(0);
      setAllGroups([]);
    }, 350);

    if (value.length >= 2) {
      api.get<Suggestion[]>(`/products/suggest?q=${encodeURIComponent(value)}&limit=8`)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  // List view
  const listParams = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (query) listParams.set("q", query);
  if (bonusOnly) listParams.set("bonus_only", "true");

  const { data: page, isLoading: listLoading, error: listError } = useSWR(
    viewMode === "list" ? `/products/?${listParams}` : null,
    (url: string) => api.get<ProductsPage>(url),
    { dedupingInterval: 5000, keepPreviousData: true }
  );

  useEffect(() => {
    if (!page) return;
    if (offset === 0) setAllItems(page.items);
    else setAllItems((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      return [...prev, ...page.items.filter((p) => !ids.has(p.id))];
    });
  }, [page, offset]);

  // Groups view
  const groupParams = new URLSearchParams({ limit: String(GROUP_PAGE_SIZE), offset: String(groupOffset) });
  if (query) groupParams.set("q", query);
  if (bonusOnly) groupParams.set("bonus_only", "true");

  const { data: groupPage, isLoading: groupLoading, error: groupError, mutate: mutateGroups } = useSWR(
    viewMode === "groups" ? `/products/groups?${groupParams}&_r=${groupRefreshKey}` : null,
    (url: string) => api.get<ProductGroupsPage>(url),
    { dedupingInterval: 5000, keepPreviousData: true }
  );

  useEffect(() => {
    if (!groupPage) return;
    if (groupOffset === 0) setAllGroups(groupPage.groups);
    else setAllGroups((prev) => {
      const names = new Set(prev.map((g) => g.group_name));
      return [...prev, ...groupPage.groups.filter((g) => !names.has(g.group_name))];
    });
  }, [groupPage, groupOffset]);

  // Type-groups view
  const typeGroupParams = new URLSearchParams({ limit: String(GROUP_PAGE_SIZE), offset: String(typeGroupOffset) });
  if (query) typeGroupParams.set("q", query);

  const { data: typeGroupPage, isLoading: typeGroupLoading, error: typeGroupError } = useSWR(
    viewMode === "types" ? `/products/type-groups?${typeGroupParams}` : null,
    (url: string) => api.get<TypeGroupsPage>(url),
    { dedupingInterval: 5000, keepPreviousData: true }
  );

  useEffect(() => {
    if (!typeGroupPage) return;
    if (typeGroupOffset === 0) setAllTypeGroups(typeGroupPage.groups);
    else setAllTypeGroups((prev) => {
      const names = new Set(prev.map((g) => g.type_group));
      return [...prev, ...typeGroupPage.groups.filter((g) => !names.has(g.type_group))];
    });
  }, [typeGroupPage, typeGroupOffset]);

  // Reset on filter/view change
  useEffect(() => {
    setOffset(0);
    setAllItems([]);
    setGroupOffset(0);
    setAllGroups([]);
    setTypeGroupOffset(0);
    setAllTypeGroups([]);
  }, [bonusOnly, viewMode]);

  function selectSuggestion(s: Suggestion) {
    setInputValue(s.name);
    setQuery(s.name);
    setOffset(0);
    setAllItems([]);
    setGroupOffset(0);
    setAllGroups([]);
    setTypeGroupOffset(0);
    setAllTypeGroups([]);
    setShowSuggestions(false);
  }

  function handleGroupChanged() {
    setGroupRefreshKey((k) => k + 1);
    setGroupOffset(0);
    setAllGroups([]);
  }

  const isLoading = viewMode === "list" ? listLoading : viewMode === "groups" ? groupLoading : typeGroupLoading;
  const error = viewMode === "list" ? listError : viewMode === "groups" ? groupError : typeGroupError;

  // Infinite scroll: auto-load more when sentinel enters viewport
  const hasMore = viewMode === "list" ? (page ? allItems.length < page.total : false)
    : viewMode === "groups" ? (groupPage ? allGroups.length < groupPage.total_groups : false)
    : (typeGroupPage ? allTypeGroups.length < typeGroupPage.total_groups : false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          if (viewMode === "list") setOffset((o) => o + PAGE_SIZE);
          else if (viewMode === "groups") setGroupOffset((o) => o + GROUP_PAGE_SIZE);
          else setTypeGroupOffset((o) => o + GROUP_PAGE_SIZE);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, viewMode]);

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Producten</h1>
        <div className="d-flex align-items-center gap-3">
          {viewMode === "list" && page && (
            <span className="text-muted small">{page.total.toLocaleString("nl-NL")} producten</span>
          )}
          {viewMode === "groups" && groupPage && (
            <span className="text-muted small">{groupPage.total_groups.toLocaleString("nl-NL")} groepen</span>
          )}
          {viewMode === "types" && typeGroupPage && (
            <span className="text-muted small">{typeGroupPage.total_groups.toLocaleString("nl-NL")} typen</span>
          )}
          <ButtonGroup size="sm">
            <Button
              variant={viewMode === "list" ? "secondary" : "outline-secondary"}
              onClick={() => setViewMode("list")}
            >
              Lijst
            </Button>
            <Button
              variant={viewMode === "groups" ? "secondary" : "outline-secondary"}
              onClick={() => setViewMode("groups")}
            >
              Groepen
            </Button>
            <Button
              variant={viewMode === "types" ? "secondary" : "outline-secondary"}
              onClick={() => setViewMode("types")}
            >
              Typen
            </Button>
          </ButtonGroup>
        </div>
      </div>

      <div className="d-flex gap-3 align-items-start mb-4">
        <div className="position-relative flex-grow-1">
          <InputGroup>
            <Form.Control
              placeholder="Zoek producten..."
              value={inputValue}
              onChange={(e) => handleInput(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              autoComplete="off"
            />
            {inputValue && (
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setInputValue(""); setQuery(""); setOffset(0); setAllItems([]);
                  setGroupOffset(0); setAllGroups([]);
                  setTypeGroupOffset(0); setAllTypeGroups([]);
                  setSuggestions([]); setShowSuggestions(false);
                }}
              >
                ✕
              </Button>
            )}
          </InputGroup>
          {showSuggestions && suggestions.length > 0 && (
            <ListGroup
              className="position-absolute w-100 shadow-sm"
              style={{ zIndex: 1000, top: "100%", maxHeight: 280, overflowY: "auto" }}
            >
              {suggestions.map((s) => (
                <ListGroup.Item
                  key={s.id}
                  action
                  onMouseDown={() => selectSuggestion(s)}
                  className="py-1 px-3"
                  style={{ fontSize: "0.875rem" }}
                >
                  <span className="fw-medium">{s.name}</span>
                  {s.name_en && s.name_en !== s.name && (
                    <span className="text-muted ms-2 small">({s.name_en})</span>
                  )}
                  {s.brand && <span className="text-muted ms-2 small">{s.brand}</span>}
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </div>
        <Form.Check
          type="checkbox"
          label="Alleen bonus"
          checked={bonusOnly}
          onChange={(e) => setBonusOnly(e.target.checked)}
          className="text-nowrap pt-2"
        />
      </div>

      {error && <Alert variant="danger">Kon producten niet laden: {error.message}</Alert>}
      {isLoading && allItems.length === 0 && allGroups.length === 0 && (
        <div className="text-center py-5"><Spinner /></div>
      )}

      {/* List view */}
      {viewMode === "list" && (
        <>
          <Row xs={2} md={3} lg={4} className="g-3">
            {allItems.map((p) => (
              <Col key={p.id}>
                <ProductCard p={p} />
              </Col>
            ))}
          </Row>
          {!hasMore && allItems.length > 0 && (
            <p className="text-center text-muted small mt-4">Alle {allItems.length} producten geladen.</p>
          )}
        </>
      )}

      {/* Groups view */}
      {viewMode === "groups" && (
        <>
          {allGroups.map((g) => (
            <GroupCard key={g.group_name} group={g} onGroupChanged={handleGroupChanged} />
          ))}
          {allGroups.length === 0 && !groupLoading && (
            <p className="text-center text-muted py-5">Geen groepen gevonden{query ? ` voor "${query}"` : ""}.</p>
          )}
        </>
      )}

      {/* Types view */}
      {viewMode === "types" && (
        <>
          {allTypeGroups.map((g) => (
            <TypeGroupCard key={g.type_group} group={g} />
          ))}
          {allTypeGroups.length === 0 && !typeGroupLoading && (
            <p className="text-center text-muted py-5">Geen typen gevonden{query ? ` voor "${query}"` : ""}.</p>
          )}
        </>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="py-2 text-center">
        {isLoading && (allItems.length > 0 || allGroups.length > 0 || allTypeGroups.length > 0) && (
          <Spinner size="sm" />
        )}
      </div>
    </>
  );
}

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsPageInner />
    </Suspense>
  );
}
