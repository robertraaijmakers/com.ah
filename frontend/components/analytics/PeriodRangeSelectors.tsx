"use client";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import { PERIOD_LABELS, Period, RANGE_LABELS, Range } from "@/lib/analytics";


export function ConfidenceBadge({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  const bg = pct >= 70 ? "success" : pct >= 40 ? "warning" : "secondary";
  return <Badge bg={bg} className="fw-normal">{pct}%</Badge>;
}

// ─── Selectors ───────────────────────────────────────────────────────────────

export function PeriodRangeSelectors({
  period, range,
  onPeriod, onRange,
}: {
  period: Period; range: Range;
  onPeriod: (p: Period) => void; onRange: (r: Range) => void;
}) {
  return (
    <div className="d-flex flex-wrap gap-2 align-items-center">
      <ButtonGroup size="sm">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <Button key={p} variant={period === p ? "secondary" : "outline-secondary"} onClick={() => onPeriod(p)}>
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </ButtonGroup>
      <ButtonGroup size="sm">
        {(Object.keys(RANGE_LABELS) as Range[]).map(r => (
          <Button key={r} variant={range === r ? "primary" : "outline-secondary"} onClick={() => onRange(r)}>
            {RANGE_LABELS[r]}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}

// ─── Health scorecard ────────────────────────────────────────────────────────

