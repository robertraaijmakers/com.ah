"use client";
import { useState, useEffect } from "react";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import ProgressBar from "react-bootstrap/ProgressBar";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";

interface AuthStatus {
  authenticated: boolean;
  expires_at: string | null;
  login_url: string;
}

interface OllamaStatus {
  available: boolean;
  model: string;
  url: string;
}

interface ScrapeStatus {
  running: boolean;
  phase: string | null;
  last_run_at: string | null;
  last_error: string | null;
  current_category: string | null;
  current_subcat: string | null;
  categories_done: number;
  categories_total: number;
  categories_skipped: number;
  categories_started: number;
  subcats_done: number;
  subcats_total: number;
  subcats_skipped: number;
  products_this_run: number;
}

interface OrdersStatus {
  running: boolean;
  mode: "full" | "incremental" | null;
  last_run_at: string | null;
  last_error: string | null;
  last_result: { pos: number; online: number; skipped?: boolean } | null;
}

interface EnrichStatus {
  running: boolean;
  last_result: { enriched: number; skipped: number; failed: number; total: number } | null;
  last_error: string | null;
}

interface NutritionStatus {
  running: boolean;
  last_result: {
    updated: number;
    skipped: number;
    errors: number;
    total: number;
    products_with_error: number;
  } | null;
  last_error: string | null;
  batches_done: number;
  total_updated: number;
  total_skipped: number;
  total_errors: number;
}

interface ProductStats {
  total_products: number;
  total_categories: number;
  total_groups: number;
}

interface NutritionStats {
  total_active: number;
  with_nutrition: number;
  with_error: number;
  never_attempted: number;
  last_enriched_at: string | null;
}

function statusBadge(running: boolean, error: string | null, doneAt: string | null) {
  if (running) return <Badge bg="warning" text="dark">Bezig</Badge>;
  if (error) return <Badge bg="danger">Fout</Badge>;
  if (doneAt) return <Badge bg="success">Klaar</Badge>;
  return <Badge bg="secondary">Inactief</Badge>;
}

function ScrapeStatusCard({
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

function NutritionStatusCard({ status }: { status: NutritionStatus | null }) {
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

function OrdersStatusCard({ status }: { status: OrdersStatus | null }) {
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

export default function SettingsPage() {
  const { showToast } = useToast();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus | null>(null);
  const [ordersStatus, setOrdersStatus] = useState<OrdersStatus | null>(null);
  const [enrichStatus, setEnrichStatus] = useState<EnrichStatus | null>(null);
  const [nutritionStatus, setNutritionStatus] = useState<NutritionStatus | null>(null);
  const [dbStats, setDbStats] = useState<ProductStats | null>(null);
  const [nutritionStats, setNutritionStats] = useState<NutritionStats | null>(null);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);

  // One-time fetches
  useEffect(() => {
    api.get<AuthStatus>("/scraper/auth/status").then(setAuthStatus).catch(() => null);
    api.get<OllamaStatus>("/ai/status").then(setOllamaStatus).catch(() => null);
    api.get<ProductStats>("/products/stats").then(setDbStats).catch(() => null);
    api.get<NutritionStats>("/products/nutrition-stats").then(setNutritionStats).catch(() => null);
  }, []);

  // Unified 2s poll for all running statuses
  useEffect(() => {
    const poll = () => {
      api.get<ScrapeStatus>("/scraper/scrape-status").then(setScrapeStatus).catch(() => null);
      api.get<OrdersStatus>("/scraper/orders-status").then(setOrdersStatus).catch(() => null);
      api.get<EnrichStatus>("/scraper/enrich-status").then(setEnrichStatus).catch(() => null);
      api.get<NutritionStatus>("/scraper/nutrition-status").then(setNutritionStatus).catch(() => null);
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  // Refresh DB stats when a scrape finishes
  useEffect(() => {
    if (scrapeStatus && !scrapeStatus.running && scrapeStatus.last_run_at) {
      api.get<ProductStats>("/products/stats").then(setDbStats).catch(() => null);
    }
  }, [scrapeStatus?.running]);

  // Refresh nutrition stats when enrichment run finishes
  useEffect(() => {
    if (nutritionStatus && !nutritionStatus.running) {
      api.get<NutritionStats>("/products/nutrition-stats").then(setNutritionStats).catch(() => null);
    }
  }, [nutritionStatus?.running]);

  // Conflict flags
  const scrapeRunning = scrapeStatus?.running ?? false;
  const ordersRunning = ordersStatus?.running ?? false;
  const enrichRunning = enrichStatus?.running ?? false;
  const nutritionRunning = nutritionStatus?.running ?? false;
  const anyRunning = scrapeRunning || ordersRunning;

  async function submitAuth() {
    if (!redirectUrl.trim()) return;
    setLoading(true);
    setAuthError(null);
    try {
      const result = await api.post<{ ok: boolean; expires_at: string }>("/scraper/auth/callback", {
        redirect_url: redirectUrl,
      });
      showToast(`Verbonden! Verloopt: ${result.expires_at}`, "success");
      setRedirectUrl("");
      setAuthStatus(await api.get<AuthStatus>("/scraper/auth/status"));
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Verbinden mislukt");
    } finally {
      setLoading(false);
    }
  }

  async function triggerScrape() {
    try {
      await api.post("/scraper/trigger");
      showToast("Producten scrape gestart", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Scrapen mislukt");
    }
  }

  async function triggerCleanup() {
    setCleanupRunning(true);
    try {
      await api.post("/scraper/trigger-cleanup");
      showToast("Database opschonen gestart op de achtergrond", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opschonen mislukt");
    } finally {
      setTimeout(() => setCleanupRunning(false), 3000);
    }
  }

  async function resetCheckpoint() {
    try {
      await api.post("/scraper/reset-checkpoint");
      showToast("Checkpoint gewist — volgende scrape haalt alle categorieën opnieuw op", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Resetten mislukt");
    }
  }

  async function enrichUnits() {
    try {
      const result = await api.post<{ enriched: number }>("/products/enrich-units");
      showToast(`Eenheden verrijkt: ${result.enriched} snapshots bijgewerkt`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Verrijken mislukt");
    }
  }

  async function enrichNames() {
    try {
      await api.post("/scraper/enrich-names?limit=200");
      showToast("Engelse namen ophalen gestart (Open Food Facts, max 200 producten)", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Verrijken mislukt");
    }
  }

  async function enrichNutrition() {
    try {
      await api.post("/scraper/enrich-nutrition?batch_size=500");
      showToast("Voedingswaarden ophalen gestart — loopt door tot alle producten verwerkt zijn", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Verrijken mislukt");
    }
  }

  async function triggerOrders(full: boolean) {
    try {
      await api.post(`/scraper/trigger-orders?full=${full}`);
      showToast(
        full ? "Volledige bestellingen scrape gestart (365 dagen)" : "Incrementele bestellingen scrape gestart (30 dagen)",
        "success"
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Scrapen mislukt");
    }
  }

  async function triggerRematch() {
    try {
      await api.post("/scraper/trigger-rematch");
      showToast("Hermatching gestart op de achtergrond", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Hermatching mislukt");
    }
  }

  return (
    <>
      <h1 className="h3 mb-4">Instellingen</h1>

      <Row className="g-4" style={{ maxWidth: 1100 }}>
        {/* ── LEFT: Status ── */}
        <Col xs={12} lg={5}>
          <h2 className="h6 text-uppercase text-muted mb-3" style={{ letterSpacing: "0.05em" }}>Status</h2>

          {/* AH Koppeling */}
          <Card className="shadow-sm mb-3">
            <Card.Header className="bg-white fw-semibold">Albert Heijn Koppeling</Card.Header>
            <Card.Body>
              {authStatus ? (
                <Alert variant={authStatus.authenticated ? "success" : "warning"} className="mb-0">
                  {authStatus.authenticated ? (
                    <>
                      ✓ Verbonden
                      {authStatus.expires_at && (
                        <div className="small text-muted mt-1">
                          Verloopt {new Date(authStatus.expires_at).toLocaleString("nl-NL")}
                        </div>
                      )}
                    </>
                  ) : "✗ Niet verbonden"}
                </Alert>
              ) : <Spinner size="sm" />}
            </Card.Body>
          </Card>

          {/* Ollama */}
          <Card className="shadow-sm mb-3">
            <Card.Header className="bg-white fw-semibold">AI (Ollama)</Card.Header>
            <Card.Body>
              {!ollamaStatus && <Spinner size="sm" />}
              {ollamaStatus && (
                <>
                  <Alert variant={ollamaStatus.available ? "success" : "danger"} className="mb-2">
                    {ollamaStatus.available ? "✓ Beschikbaar" : "✗ Niet beschikbaar"}
                  </Alert>
                  <p className="small mb-1">Model: <code className="bg-light px-1 rounded">{ollamaStatus.model}</code></p>
                  <p className="small mb-0">URL: <code className="bg-light px-1 rounded text-break">{ollamaStatus.url}</code></p>
                  {!ollamaStatus.available && (
                    <Alert variant="warning" className="mt-2 mb-0 small">
                      Start Ollama op je Mac: <code>ollama serve</code>
                    </Alert>
                  )}
                </>
              )}
            </Card.Body>
          </Card>

          <ScrapeStatusCard status={scrapeStatus} dbStats={dbStats} nutritionStats={nutritionStats} nutritionStatus={nutritionStatus} />
          <OrdersStatusCard status={ordersStatus} />
          <NutritionStatusCard status={nutritionStatus} />
        </Col>

        {/* ── RIGHT: Acties ── */}
        <Col xs={12} lg={7}>
          <h2 className="h6 text-uppercase text-muted mb-3" style={{ letterSpacing: "0.05em" }}>Acties</h2>

          {/* AH koppelen (alleen tonen als niet verbonden) */}
          {authStatus && !authStatus.authenticated && (
            <Card className="shadow-sm mb-3">
              <Card.Header className="bg-white fw-semibold">AH Account koppelen</Card.Header>
              <Card.Body>
                <p className="fw-medium small mb-2">Eenmalige setup:</p>
                <ol className="small text-muted mb-3">
                  <li className="mb-1">
                    Open deze URL in je browser:{" "}
                    {authStatus.login_url && (
                      <a href={authStatus.login_url} target="_blank" rel="noopener noreferrer">AH Login</a>
                    )}
                  </li>
                  <li className="mb-1">Log in met je AH account</li>
                  <li className="mb-1">De browser probeert &apos;appie://login-exit?code=...&apos; te openen — dit mislukt</li>
                  <li>Kopieer die volledige URL en plak hem hieronder</li>
                </ol>
                {authError && (
                  <Alert variant="danger" onClose={() => setAuthError(null)} dismissible>{authError}</Alert>
                )}
                <Form.Control
                  as="textarea"
                  rows={3}
                  placeholder="appie://login-exit?code=..."
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  className="mb-2"
                />
                <Button className="btn-ah" onClick={submitAuth} disabled={loading || !redirectUrl.trim()}>
                  {loading && <Spinner size="sm" className="me-1" />}Verbinden
                </Button>
              </Card.Body>
            </Card>
          )}

          {/* Producten */}
          <Card className="shadow-sm mb-3">
            <Card.Header className="bg-white fw-semibold">Producten & Prijzen</Card.Header>
            <Card.Body>
              <p className="small text-muted mb-3">
                Scrapet alle AH producten met actuele prijzen. Loopt automatisch elke dag om 06:00.
              </p>
              <div className="d-flex gap-2 flex-wrap">
                <Button
                  variant="outline-secondary"
                  onClick={triggerScrape}
                  disabled={anyRunning}
                  title={anyRunning ? "Wacht tot huidige taak klaar is" : undefined}
                >
                  {scrapeRunning && <Spinner size="sm" className="me-1" />}
                  Nu scrapen
                </Button>
                <Button
                  variant="outline-info"
                  onClick={enrichUnits}
                  disabled={scrapeRunning || enrichRunning}
                  title="Leidt prijs per kg/l af voor multipacks op basis van losse varianten in dezelfde groep"
                >
                  Eenheden verrijken
                </Button>
                <Button
                  variant="outline-info"
                  onClick={enrichNames}
                  disabled={scrapeRunning || enrichRunning}
                  title={enrichRunning ? "Verrijking al bezig" : scrapeRunning ? "Wacht tot scrape klaar is" : "Haalt Engelse productnamen op via Open Food Facts (max 200 per keer)"}
                >
                  {enrichRunning && <Spinner size="sm" className="me-1" />}
                  Engelse namen verrijken
                </Button>
                <Button
                  variant="outline-info"
                  onClick={enrichNutrition}
                  disabled={scrapeRunning || enrichRunning || nutritionRunning}
                  title={nutritionRunning
                    ? `Bezig — batch ${nutritionStatus?.batches_done ?? 0}, ${nutritionStatus?.total_updated ?? 0} bijgewerkt`
                    : "Haalt voedingswaarden op via AH API voor alle producten zonder data (100 per batch, loopt door tot klaar)"}
                >
                  {nutritionRunning && <Spinner size="sm" className="me-1" />}
                  Voedingswaarden ophalen
                  {nutritionRunning && nutritionStatus && nutritionStatus.batches_done > 0 && (
                    <span className="ms-1 text-muted" style={{ fontSize: "0.75em" }}>
                      (batch {nutritionStatus.batches_done}, {nutritionStatus.total_updated} ✓)
                    </span>
                  )}
                </Button>
                <Button
                  variant="outline-warning"
                  onClick={resetCheckpoint}
                  disabled={scrapeRunning}
                  title={scrapeRunning ? "Wacht tot scrape klaar is" : "Wist de voortgang zodat alle categorieën opnieuw worden gescraped"}
                >
                  Checkpoint resetten
                </Button>
                <Button
                  variant="outline-danger"
                  onClick={triggerCleanup}
                  disabled={scrapeRunning || cleanupRunning}
                  title={scrapeRunning ? "Wacht tot scrape klaar is" : "Verwijder ongeldige snapshots en dedupliceert opeenvolgende identieke prijzen"}
                >
                  {cleanupRunning && <Spinner size="sm" className="me-1" />}
                  Database opschonen
                </Button>
              </div>
            </Card.Body>
          </Card>

          {/* Bestellingen */}
          <Card className="shadow-sm">
            <Card.Header className="bg-white fw-semibold">Bestellingen & Kassabonnen</Card.Header>
            <Card.Body>
              <p className="small text-muted mb-2">
                Importeert kassabonnen (in-store) en online bestellingen vanuit je AH account.
                Klassificeert automatisch als <Badge bg="secondary" className="fw-normal">🏪 in-store</Badge> of <Badge bg="primary" className="fw-normal">🚚 online</Badge>.
              </p>
              <p className="small text-muted mb-3">
                <strong>Volledig:</strong> haalt 365 dagen op (eerste keer). <strong>Incrementeel:</strong> haalt alleen de laatste 30 dagen op.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <ButtonGroup>
                  <Button
                    variant="outline-secondary"
                    onClick={() => triggerOrders(false)}
                    disabled={anyRunning}
                    title={anyRunning ? "Wacht tot huidige taak klaar is" : undefined}
                  >
                    {ordersRunning && <Spinner size="sm" className="me-1" />}
                    Incrementeel (30d)
                  </Button>
                  <Button
                    variant="outline-primary"
                    onClick={() => triggerOrders(true)}
                    disabled={anyRunning}
                    title={anyRunning ? "Wacht tot huidige taak klaar is" : undefined}
                  >
                    Volledig (365d)
                  </Button>
                </ButtonGroup>
                <Button
                  variant="outline-warning"
                  onClick={triggerRematch}
                  disabled={anyRunning}
                  title={anyRunning ? "Wacht tot huidige taak klaar is" : "Probeer ongematchte order-items opnieuw te koppelen aan producten"}
                >
                  Hermatching producten
                </Button>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
}
