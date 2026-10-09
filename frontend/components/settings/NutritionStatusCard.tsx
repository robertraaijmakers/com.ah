"use client";
import Alert from "react-bootstrap/Alert";
import Card from "react-bootstrap/Card";
import ProgressBar from "react-bootstrap/ProgressBar";
import Spinner from "react-bootstrap/Spinner";
import { NutritionStatus, statusBadge } from "@/lib/settings";


export function NutritionStatusCard({ status }: { status: NutritionStatus | null }) {
  if (!status) return null;

  const r = status.last_result;
  const totalProcessed = status.total_updated + status.total_skipped;
  const pct = status.running
    ? status.batches_done > 0 && r ? Math.min(99, Math.round((totalProcessed / (totalProcessed + (r.total || 1))) * 100)) : 5
    : status.last_error ? 0 : 100;

  const hasError = !!status.last_error;
  const hasProductErrors = !status.running && r && r.products_with_error > 0;

  return (
    <Card className="shadow-sm mb-3">
      <Card.Header className="bg-white d-flex justify-content-between align-items-center">
        <span className="fw-semibold">Voedingswaarden verrijking</span>
        {statusBadge(
          status.running,
          status.last_error ?? (hasProductErrors ? `${r!.products_with_error} product(en) met fout` : null),
          !status.running && !hasError && r ? "done" : null,
        )}
      </Card.Header>
      <Card.Body>
        {status.running && (
          <div className="mb-2">
            <div className="d-flex align-items-center gap-2 mb-1">
              <Spinner size="sm" />
              <span className="small fw-medium">
                Batch {status.batches_done + 1} ophalen…
              </span>
            </div>
            {status.batches_done > 0 && (
              <div className="text-muted small">
                {status.batches_done} {status.batches_done === 1 ? "batch" : "batches"} klaar
                {" · "}{status.total_updated.toLocaleString("nl-NL")} bijgewerkt
                {status.total_skipped > 0 && ` · ${status.total_skipped.toLocaleString("nl-NL")} geen data`}
                {status.total_errors > 0 && ` · ${status.total_errors.toLocaleString("nl-NL")} fouten`}
              </div>
            )}
          </div>
        )}
        <ProgressBar
          animated={status.running}
          striped={status.running}
          now={pct}
          variant={hasError ? "danger" : hasProductErrors ? "warning" : status.running ? "info" : "success"}
          className="mb-2"
          style={{ height: "1.1rem" }}
        />
        {status.last_error && (
          <Alert variant="danger" className="mb-2 small"><strong>Fout:</strong> {status.last_error}</Alert>
        )}
        {!status.running && r && (
          <div className="small text-muted">
            <div>
              {r.updated.toLocaleString("nl-NL")} bijgewerkt
              {r.skipped > 0 && ` · ${r.skipped.toLocaleString("nl-NL")} geen voedingsdata`}
              {r.errors > 0 && ` · ${r.errors.toLocaleString("nl-NL")} fouten`}
              {` · ${status.batches_done} ${status.batches_done === 1 ? "batch" : "batches"}`}
            </div>
            {hasProductErrors && (
              <div className="text-warning mt-1">
                ⚠ {r.products_with_error.toLocaleString("nl-NL")} product(en) in foutstatus — wordt na 1 dag automatisch opnieuw geprobeerd
              </div>
            )}
          </div>
        )}
        {!status.running && !r && (
          <p className="small text-muted mb-0">Nog niet gestart in deze sessie.</p>
        )}
      </Card.Body>
    </Card>
  );
}

