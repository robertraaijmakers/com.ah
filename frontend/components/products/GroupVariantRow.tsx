"use client";
import Link from "next/link";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ListGroup from "react-bootstrap/ListGroup";
import { type Product } from "@/lib/api";
import { effPrice, unitPrice } from "@/lib/products";


export function GroupVariantRow({
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

