"use client";
import { useState } from "react";
import useSWR from "swr";
import Badge from "react-bootstrap/Badge";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api } from "@/lib/api";
import { ProductsPageData, TypeGroupOut } from "@/lib/products";
import { ProductCard } from "@/components/products/ProductCard";


export function TypeGroupCard({ group }: { group: TypeGroupOut }) {
  const [expanded, setExpanded] = useState(false);
  const hasRange = group.min_price !== null && group.max_price !== null && group.min_price !== group.max_price;

  const { data: products, isLoading } = useSWR(
    expanded ? `/products/?type_group=${encodeURIComponent(group.type_group)}&limit=50` : null,
    (url: string) => api.get<ProductsPageData>(url),
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

