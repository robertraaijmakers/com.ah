"use client";
import useSWR from "swr";
import Spinner from "react-bootstrap/Spinner";
import { api } from "@/lib/api";
import { HealthScore, RATING_COLOR, RATING_LABEL } from "@/lib/analytics";


export function HealthScorecard({ start, end }: { start?: string; end?: string }) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  const { data, isLoading } = useSWR(
    `/analytics/health-score${qs ? `?${qs}` : ""}`,
    (url: string) => api.get<HealthScore>(url),
  );

  if (isLoading) return <Spinner size="sm" />;
  if (!data || data.groups.length === 0)
    return <p className="text-muted small">Geen data voor geselecteerde periode.</p>;

  const visible = data.groups.filter(g => g.spent > 0 || g.group === "fish" || g.group === "legumes");

  return (
    <div>
      <div className="small text-muted mb-3 d-flex gap-3 flex-wrap">
        <span>Voedsel: <strong>€{data.food_spend.toFixed(2)}</strong></span>
        {data.total_spend > data.food_spend && (
          <span>Non-food: <strong>€{(data.total_spend - data.food_spend).toFixed(2)}</strong></span>
        )}
        <span>Totaal: <strong>€{data.total_spend.toFixed(2)}</strong></span>
        {data.total_savings > 0 && (
          <span className="text-success">Bespaard: <strong>−€{data.total_savings.toFixed(2)}</strong></span>
        )}
      </div>
      <div className="row g-2">
        {visible.map(g => (
          <div key={g.group} className="col-6 col-md-4 col-lg-3">
            <div
              className="p-2 rounded border h-100"
              style={{ borderColor: RATING_COLOR[g.rating] + "55", background: RATING_COLOR[g.rating] + "0a" }}
            >
              <div className="d-flex align-items-center gap-2 mb-1">
                <span style={{ fontSize: "1.1rem" }}>{g.emoji}</span>
                <span className="small fw-semibold">{g.label}</span>
                <span
                  className="ms-auto badge"
                  style={{ background: RATING_COLOR[g.rating], fontSize: "0.65rem" }}
                >
                  {RATING_LABEL[g.rating]}
                </span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <div style={{ flex: 1, height: 6, background: "#e9ecef", borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${Math.min(100, g.pct * 4)}%`,
                      height: "100%",
                      background: RATING_COLOR[g.rating],
                      borderRadius: 3,
                    }}
                  />
                </div>
                <span className="small text-muted" style={{ whiteSpace: "nowrap" }}>{g.pct.toFixed(1)}%</span>
              </div>
              <div className="small text-muted mt-1 d-flex gap-2">
                <span>€{g.spent.toFixed(2)}</span>
                {g.savings > 0 && <span className="text-success">−€{g.savings.toFixed(2)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ollama chat widget ───────────────────────────────────────────────────────

