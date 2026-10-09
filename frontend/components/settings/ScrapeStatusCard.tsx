"use client";
import Alert from "react-bootstrap/Alert";
import Card from "react-bootstrap/Card";
import ProgressBar from "react-bootstrap/ProgressBar";
import Spinner from "react-bootstrap/Spinner";
import { NutritionStats, NutritionStatus, ProductStats, ScrapeStatus, statusBadge } from "@/lib/settings";


export function ScrapeStatusCard({
  status,
  dbStats,
  nutritionStats,
  nutritionStatus,
}: {
  status: ScrapeStatus | null;
  dbStats: ProductStats | null;
  nutritionStats: NutritionStats | null;
  nutritionStatus: NutritionStatus | null;
}) {
  if (!status) return null;

  const isPhase2 = status.phase?.includes("2/2") || (status.subcats_total > 0 && status.subcats_done >= 0);
  const phaseDone = isPhase2 ? status.subcats_done : status.categories_done;
  const phaseTotal = isPhase2 ? status.subcats_total : status.categories_total;
  const phaseCurrent = isPhase2 ? status.current_subcat : status.current_category;
  const phaseLabel = isPhase2 ? "Subcategorie" : "Categorie";
  const phaseSkipped = isPhase2 ? status.subcats_skipped : status.categories_skipped;

  const pct = status.running
    ? phaseTotal > 0 ? Math.round(((phaseDone + phaseSkipped) / phaseTotal) * 100) : 0
    : status.last_error ? 0 : 100;

  return (
    <Card className="shadow-sm mb-3">
      <Card.Header className="bg-white d-flex justify-content-between align-items-center">
        <div>
          <span className="fw-semibold">Producten scrape</span>
          {status.running && status.phase && (
            <span className="ms-2 small text-muted">{status.phase}</span>
          )}
        </div>
        {statusBadge(status.running, status.last_error, status.last_run_at)}
      </Card.Header>
      <Card.Body>
        {status.running && (
          <div className="mb-2">
            <div className="d-flex align-items-center gap-2 mb-1">
              <Spinner size="sm" />
              <span className="small fw-medium">
                {phaseCurrent
                  ? <>{phaseLabel}: <strong>{phaseCurrent}</strong></>
                  : `${phaseLabel}en ophalen...`}
              </span>
            </div>
            {phaseTotal > 0 && (
              <div className="text-muted small">
                {`${phaseDone + phaseSkipped} / ${phaseTotal}`}
                {phaseDone > 0 && ` · ${phaseDone} afgerond`}
                {phaseSkipped > 0 && ` · ${phaseSkipped} overgeslagen`}
                {status.products_this_run > 0 && ` · ${status.products_this_run.toLocaleString("nl-NL")} producten`}
              </div>
            )}
          </div>
        )}
        <ProgressBar
          animated={status.running}
          striped={status.running}
          now={pct}
          label={status.running && phaseTotal > 0 ? `${pct}%` : undefined}
          variant={status.last_error ? "danger" : status.running ? "warning" : "success"}
          className="mb-2"
          style={{ height: "1.1rem" }}
        />
        {status.last_error && (
          <Alert variant="danger" className="mb-0 small"><strong>Fout:</strong> {status.last_error}</Alert>
        )}
        {!status.running && !status.last_error && status.last_run_at && (
          <div className="small text-muted">
            <div>Voltooid {new Date(status.last_run_at).toLocaleString("nl-NL")}</div>
            <div>
              {status.products_this_run.toLocaleString("nl-NL")} producten verwerkt
              {status.categories_done > 0 && ` · ${status.categories_done} categorieën`}
              {status.subcats_done > 0 && ` · ${status.subcats_done} subcategorieën`}
            </div>
          </div>
        )}
        {!status.running && !status.last_run_at && (
          <p className="small text-muted mb-0">Nog niet gestart in deze sessie.</p>
        )}
        {dbStats && (
          <div className="mt-2 pt-2 border-top small text-muted d-flex gap-3">
            <span><strong>{dbStats.total_products.toLocaleString("nl-NL")}</strong> producten</span>
            <span><strong>{dbStats.total_categories.toLocaleString("nl-NL")}</strong> categorieën</span>
            <span><strong>{dbStats.total_groups.toLocaleString("nl-NL")}</strong> groepen</span>
          </div>
        )}
        {/* Nutrition enrichment progress */}
        {(nutritionStats || nutritionStatus?.running) && (() => {
          const ns = nutritionStats;
          const nutRunning = nutritionStatus?.running ?? false;
          const nutPct = ns
            ? ns.total_active > 0 ? Math.round((ns.with_nutrition / ns.total_active) * 100) : 0
            : 0;
          return (
            <div className="mt-2 pt-2 border-top">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className="small fw-medium text-muted">Voedingswaarden</span>
                {nutRunning && (
                  <span className="small text-muted d-flex align-items-center gap-1">
                    <Spinner size="sm" style={{ width: "0.7rem", height: "0.7rem" }} />
                    batch {(nutritionStatus?.batches_done ?? 0) + 1}…
                  </span>
                )}
              </div>
              <ProgressBar
                animated={nutRunning}
                striped={nutRunning}
                now={nutRunning && !ns ? 5 : nutPct}
                variant={ns && ns.with_error > 0 && ns.with_nutrition < ns.total_active ? "warning" : "info"}
                style={{ height: "0.6rem" }}
                className="mb-1"
              />
              {ns && (
                <div className="small text-muted">
                  <strong>{ns.with_nutrition.toLocaleString("nl-NL")}</strong> / {ns.total_active.toLocaleString("nl-NL")} met voedingswaarden
                  {ns.with_error > 0 && <span className="ms-2 text-warning">· {ns.with_error} fouten</span>}
                  {ns.last_enriched_at && (
                    <span className="ms-2">· {new Date(ns.last_enriched_at).toLocaleDateString("nl-NL")}</span>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </Card.Body>
    </Card>
  );
}

