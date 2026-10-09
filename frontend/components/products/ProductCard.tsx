"use client";
import Link from "next/link";
import Badge from "react-bootstrap/Badge";
import Card from "react-bootstrap/Card";
import { type Product } from "@/lib/api";
import { bundleUnitPrice, effPrice, isBundleCheaperPerUnit, orderMinUnitPrice, unitPrice } from "@/lib/products";


export function ProductCard({ p, onGroupChanged }: { p: Product; onGroupChanged?: () => void }) {
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

