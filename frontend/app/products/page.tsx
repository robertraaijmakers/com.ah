"use client";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import InputGroup from "react-bootstrap/InputGroup";
import ListGroup from "react-bootstrap/ListGroup";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api, type Product } from "@/lib/api";
import { GROUP_PAGE_SIZE, PAGE_SIZE, ProductGroupOut, ProductGroupsPage, ProductsPageData, Suggestion, TypeGroupOut, TypeGroupsPage } from "@/lib/products";
import { ProductCard } from "@/components/products/ProductCard";
import { GroupCard } from "@/components/products/GroupCard";
import { TypeGroupCard } from "@/components/products/TypeGroupCard";


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
    (url: string) => api.get<ProductsPageData>(url),
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
