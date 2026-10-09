"use client";
import Alert from "react-bootstrap/Alert";
import Card from "react-bootstrap/Card";
import ProgressBar from "react-bootstrap/ProgressBar";
import Spinner from "react-bootstrap/Spinner";
import { OrdersStatus, statusBadge } from "@/lib/settings";


export function OrdersStatusCard({ status }: { status: OrdersStatus | null }) {
  if (!status) return null;
  const pct = status.running ? 50 : status.last_error ? 0 : 100;

  return (
    <Card className="shadow-sm mb-3">
      <Card.Header className="bg-white d-flex justify-content-between align-items-center">
        <span className="fw-semibold">Bestellingen scrape</span>
        <div className="d-flex align-items-center gap-2">
          {status.mode && (
            <span className="small text-muted">{status.mode === "full" ? "volledig" : "incrementeel"}</span>
          )}
          {statusBadge(status.running, status.last_error, status.last_run_at)}
        </div>
      </Card.Header>
      <Card.Body>
        {status.running && (
          <div className="d-flex align-items-center gap-2 mb-2">
            <Spinner size="sm" />
            <span className="small">Bestellingen en kassabonnen ophalen...</span>
          </div>
        )}
        <ProgressBar
          animated={status.running}
          striped={status.running}
          now={pct}
          variant={status.last_error ? "danger" : status.running ? "warning" : "success"}
          className="mb-2"
        />
        {status.last_error && (
          <Alert variant="danger" className="mb-0 small"><strong>Fout:</strong> {status.last_error}</Alert>
        )}
        {!status.running && status.last_result && !status.last_result.skipped && (
          <div className="small text-muted">
            <span className="me-3">🏪 In-store: {status.last_result.pos} nieuw</span>
            <span>🚚 Online: {status.last_result.online} nieuw</span>
          </div>
        )}
        {!status.running && status.last_result?.skipped && (
          <Alert variant="warning" className="mb-0 small">Geen auth token — stel AH koppeling in.</Alert>
        )}
        {!status.running && !status.last_error && status.last_run_at && (
          <p className="small text-muted mt-1 mb-0">
            Voltooid {new Date(status.last_run_at).toLocaleString("nl-NL")}
          </p>
        )}
        {!status.running && !status.last_run_at && (
          <p className="small text-muted mb-0">Nog niet gestart in deze sessie.</p>
        )}
      </Card.Body>
    </Card>
  );
}

