"use client";
import Badge from "react-bootstrap/Badge";
import { fmtEur, type PlanCost } from "@/lib/api";

export function PlanCostSummary({ cost }: { cost: PlanCost | undefined }) {
  if (!cost) return null;
  const budgetPct = cost.budget_eur ? Math.min(100, Math.round((cost.total / cost.budget_eur) * 100)) : null;

  return (
    <div className="px-3 py-3 border-bottom bg-light">
      <div className="d-flex flex-wrap gap-4 align-items-end">
        <div>
          <div className="small text-muted">Ingrediëntkosten</div>
          <div className="h4 mb-0">{fmtEur(cost.total)}</div>
        </div>
        {cost.per_portion != null && (
          <div>
            <div className="small text-muted">Per portie</div>
            <div className="h5 mb-0">{fmtEur(cost.per_portion)}</div>
          </div>
        )}
        {cost.shopping_total != null && (
          <div>
            <div className="small text-muted">Boodschappenlijst (hele verpakkingen)</div>
            <div className="h5 mb-0">{fmtEur(cost.shopping_total)}</div>
          </div>
        )}
        {cost.budget_eur != null && (
          <div className="flex-grow-1" style={{ minWidth: 160 }}>
            <div className="small text-muted d-flex justify-content-between">
              <span>Budget {fmtEur(cost.budget_eur)}</span>
              <Badge bg={cost.over_budget ? "danger" : "success"} className="fw-normal">
                {cost.over_budget ? `${fmtEur(cost.total - cost.budget_eur)} over` : `${fmtEur(cost.budget_eur - cost.total)} onder`}
              </Badge>
            </div>
            <div className="progress" style={{ height: 6 }} role="progressbar" aria-label="Budget" aria-valuenow={budgetPct ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div className={`progress-bar ${cost.over_budget ? "bg-danger" : "bg-success"}`} style={{ width: `${budgetPct}%` }} />
            </div>
          </div>
        )}
      </div>
      {cost.unpriced > 0 && (
        <div className="small text-muted mt-2">
          {cost.unpriced} ingrediënt{cost.unpriced === 1 ? "" : "en"} niet meegerekend (niet gekoppeld of geen prijs bekend).
        </div>
      )}
    </div>
  );
}
