"use client";
import { useState, useEffect } from "react";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { AuthStatus, EnrichStatus, NutritionStats, NutritionStatus, OllamaStatus, OrdersStatus, ProductStats, ScrapeStatus } from "@/lib/settings";
import { ScrapeStatusCard } from "@/components/settings/ScrapeStatusCard";
import { NutritionStatusCard } from "@/components/settings/NutritionStatusCard";
import { OrdersStatusCard } from "@/components/settings/OrdersStatusCard";


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
