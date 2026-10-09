"use client";
import { useState } from "react";
import Badge from "react-bootstrap/Badge";
import Card from "react-bootstrap/Card";
import ListGroup from "react-bootstrap/ListGroup";
import { type Product } from "@/lib/api";
import { ProductGroupOut, effPrice, unitPrice } from "@/lib/products";
import { EditGroupModal } from "@/components/products/EditGroupModal";
import { GroupVariantRow } from "@/components/products/GroupVariantRow";


export function GroupCard({
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

