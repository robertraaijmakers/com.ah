"use client";
import { useState, useMemo } from "react";
import useSWR from "swr";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Row from "react-bootstrap/Row";
import Spinner from "react-bootstrap/Spinner";
import Table from "react-bootstrap/Table";
import Tab from "react-bootstrap/Tab";
import Tabs from "react-bootstrap/Tabs";
import { RecommendationsCard } from "@/components/analytics/RecommendationsCard";
import { ExportCard } from "@/components/analytics/ExportCard";
import { api } from "@/lib/api";
import { CategorySpend, NutritionPoint, PERIOD_LABELS, Period, RANGE_LABELS, Range, SpendingPoint, TopProduct, buildQuery, euro, rangeToParams } from "@/lib/analytics";
import { CategoryChart, NutritionBar, NutritionLineChart, SpendingChart, TrendLine } from "@/components/analytics/Charts";
import { PeriodRangeSelectors } from "@/components/analytics/PeriodRangeSelectors";
import { HealthScorecard } from "@/components/analytics/HealthScorecard";
import { ChatWidget } from "@/components/analytics/ChatWidget";



export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [range, setRange] = useState<Range>("ytd");
  const [nutritionView, setNutritionView] = useState<"total" | "avg">("total");

  const rangeParams = useMemo(() => rangeToParams(range), [range]);
  const rangeQs = useMemo(() => buildQuery(rangeParams), [rangeParams]);
  const spendingQs = useMemo(
    () => buildQuery({ period, ...rangeParams }),
    [period, rangeParams]
  );

  const { data: summaryData } = useSWR(
    `/analytics/summary${rangeQs}`,
    (url: string) => api.get<{
      total_orders: number; total_spent: number; avg_per_order: number;
      first_date: string | null; last_date: string | null;
    }>(url)
  );

  const { data: spendingData, isLoading: spendingLoading } = useSWR(
    `/analytics/spending${spendingQs}`,
    (url: string) => api.get<{ period: string; data: SpendingPoint[] }>(url)
  );

  const { data: nutritionData, isLoading: nutritionLoading } = useSWR(
    `/analytics/nutrition${spendingQs}`,
    (url: string) => api.get<{ period: string; data: NutritionPoint[]; has_nutrition_data: boolean }>(url)
  );

  const { data: productsData, isLoading: productsLoading } = useSWR(
    `/analytics/top-products${rangeQs}`,
    (url: string) => api.get<{ products: TopProduct[] }>(url)
  );

  const { data: categoriesData, isLoading: categoriesLoading } = useSWR(
    `/analytics/categories${rangeQs}`,
    (url: string) => api.get<{ categories: CategorySpend[] }>(url)
  );

  const spending = spendingData?.data ?? [];
  const nutrition = nutritionData?.data ?? [];
  const products = productsData?.products ?? [];
  const categories = categoriesData?.categories ?? [];
  const analyticsStart = rangeParams.start;
  const analyticsEnd = rangeParams.end;

  // Sum totals across all periods for macro summary bars
  const nutritionSummary = useMemo(() => {
    const rows = nutrition.filter(n => n.total_kcal !== null);
    if (rows.length === 0) return null;
    const sum = (field: keyof NutritionPoint) =>
      rows.reduce((s, r) => s + ((r[field] as number | null) ?? 0), 0) || null;
    const totalOrders = rows.reduce((s, r) => s + r.order_count, 0);
    return {
      total_kcal: sum("total_kcal"),
      total_protein: sum("total_protein"),
      total_fat: sum("total_fat"),
      total_carbs: sum("total_carbs"),
      total_fiber: sum("total_fiber"),
      total_salt: sum("total_salt"),
      avg_kcal: sum("total_kcal") !== null ? sum("total_kcal")! / totalOrders : null,
    };
  }, [nutrition]);

  return (
    <>
      <h1 className="h3 mb-4">Analytics</h1>

      {/* ── Summary ── */}
      {summaryData && summaryData.total_orders > 0 && (
        <Row className="g-3 mb-4">
          {[
            { label: "Totaal uitgegeven", value: euro(summaryData.total_spent) },
            { label: "Bestellingen", value: String(summaryData.total_orders) },
            { label: "Gem. per bestelling", value: euro(summaryData.avg_per_order) },
            {
              label: "Periode",
              value: summaryData.first_date && summaryData.last_date
                ? `${summaryData.first_date} – ${summaryData.last_date}`
                : "—",
            },
          ].map(({ label, value }) => (
            <Col key={label} xs={6} sm={3}>
              <div className="text-center p-3 bg-white border rounded shadow-sm h-100">
                <div className="fw-bold fs-5">{value}</div>
                <div className="small text-muted">{label}</div>
              </div>
            </Col>
          ))}
        </Row>
      )}

      <div className="mb-3 p-3 bg-white border rounded">
        <div className="small fw-semibold mb-2">Periode</div>
        <PeriodRangeSelectors period={period} range={range} onPeriod={setPeriod} onRange={setRange} />
      </div>

      <Tabs defaultActiveKey="spending" className="mb-3" mountOnEnter>
        {/* ── Spending ── */}
        <Tab eventKey="spending" title="Uitgaven">
        <Col xs={12}>
          <Card className="shadow-sm">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">Uitgaven</span>
            </Card.Header>
            <Card.Body>
              {spendingLoading && <Spinner size="sm" />}
              {!spendingLoading && spending.length === 0 && (
                <Alert variant="info" className="mb-0">
                  Geen bestellingen gevonden. Importeer eerst bestellingen via Instellingen → Bestellingen &amp; Kassabonnen.
                </Alert>
              )}
              {spending.length > 0 && (
                <>
                  <SpendingChart data={spending} />
                  {period !== "season" && spending.length >= 3 && (
                    <div className="mt-3 pt-3 border-top">
                      <div className="small fw-medium mb-2">Trend — gem. per bestelling</div>
                      <TrendLine data={spending} field="avg_per_order" />
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-top">
                    <Table responsive size="sm" className="mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>{PERIOD_LABELS[period]}</th>
                          <th className="text-end">Bestellingen</th>
                          <th className="text-end">Totaal</th>
                          <th className="text-end">Gem./bestelling</th>
                        </tr>
                      </thead>
                      <tbody style={{ fontSize: "0.82rem" }}>
                        {[...spending].reverse().map((d, i) => (
                          <tr key={i}>
                            <td>{d.label}</td>
                            <td className="text-end">{d.order_count}</td>
                            <td className="text-end">{euro(d.total_spent)}</td>
                            <td className="text-end">{euro(d.avg_per_order)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        {/* ── Nutrition ── */}
        <Tab eventKey="nutrition" title="Voedingswaarden">
        <Col xs={12}>
          <Card className="shadow-sm">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <span className="fw-semibold">Voedingswaarden</span>
                <div className="small text-muted">Gem. voedingswaarden per bestelling (op basis van gekochte producten)</div>
              </div>
            </Card.Header>
            <Card.Body>
              {nutritionLoading && <Spinner size="sm" />}
              {!nutritionLoading && nutrition.length === 0 && (
                <Alert variant="info" className="mb-0">
                  Geen data. Zorg dat bestellingen geïmporteerd zijn én producten voedingswaarden hebben.
                </Alert>
              )}
              {!nutritionLoading && nutrition.length > 0 && !nutritionData?.has_nutrition_data && (
                <Alert variant="warning" className="mb-3">
                  Bestellingen gevonden, maar geen voedingswaarden in de database. Scrape eerst producten om voedingswaarden te laden.
                </Alert>
              )}
              {nutrition.length > 0 && nutritionData?.has_nutrition_data && (
                <Row className="g-4">
                  {/* Macro summary bars — totals for the period */}
                  {nutritionSummary && (
                    <Col xs={12} md={4}>
                      <div className="small fw-medium mb-3">Totaal gekochte voedingsstoffen (gehele periode)</div>
                      <NutritionBar label="Calorieën" value={nutritionSummary.total_kcal} max={150000} unit="kcal" color="#003d9b" />
                      <NutritionBar label="Eiwit" value={nutritionSummary.total_protein} max={10000} unit="g" color="#198754" />
                      <NutritionBar label="Koolhydraten" value={nutritionSummary.total_carbs} max={30000} unit="g" color="#fd7e14" />
                      <NutritionBar label="Vetten" value={nutritionSummary.total_fat} max={10000} unit="g" color="#ffc107" />
                      <NutritionBar label="Vezels" value={nutritionSummary.total_fiber} max={3000} unit="g" color="#20c997" />
                      <NutritionBar label="Zout" value={nutritionSummary.total_salt} max={1000} unit="g" color="#dc3545" />
                      {nutritionSummary.avg_kcal !== null && (
                        <div className="small text-muted mt-2 pt-2 border-top">
                          Gem. {nutritionSummary.avg_kcal.toFixed(0)} kcal per bestelling
                        </div>
                      )}
                    </Col>
                  )}

                  {/* Kcal trend + table */}
                  <Col xs={12} md={8}>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="small fw-medium">
                        {nutritionView === "total" ? "Totale kcal per periode" : "Gem. kcal per bestelling"}
                      </div>
                      <ButtonGroup size="sm">
                        <Button variant={nutritionView === "total" ? "secondary" : "outline-secondary"} onClick={() => setNutritionView("total")}>Totaal</Button>
                        <Button variant={nutritionView === "avg" ? "secondary" : "outline-secondary"} onClick={() => setNutritionView("avg")}>Per bestelling</Button>
                      </ButtonGroup>
                    </div>
                    <NutritionLineChart
                      data={nutrition}
                      field={nutritionView === "total" ? "total_kcal" : "avg_kcal"}
                      color="#003d9b"
                    />
                    <div className="mt-3 overflow-auto" style={{ maxHeight: 260 }}>
                      <Table responsive size="sm" className="mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>{PERIOD_LABELS[period]}</th>
                            <th className="text-end">Orders</th>
                            <th className="text-end">{nutritionView === "total" ? "Kcal totaal" : "Kcal/order"}</th>
                            <th className="text-end">{nutritionView === "total" ? "Eiwit tot." : "Eiwit/order"}</th>
                            <th className="text-end">{nutritionView === "total" ? "KH tot." : "KH/order"}</th>
                            <th className="text-end">{nutritionView === "total" ? "Vet tot." : "Vet/order"}</th>
                          </tr>
                        </thead>
                        <tbody style={{ fontSize: "0.82rem" }}>
                          {[...nutrition].reverse().map((n, i) => {
                            const kcal = nutritionView === "total" ? n.total_kcal : n.avg_kcal;
                            const prot = nutritionView === "total" ? n.total_protein : n.avg_protein;
                            const carb = nutritionView === "total" ? n.total_carbs : n.avg_carbs;
                            const fat = nutritionView === "total" ? n.total_fat : n.avg_fat;
                            return (
                              <tr key={i}>
                                <td>{n.label}</td>
                                <td className="text-end">{n.order_count}</td>
                                <td className="text-end">{kcal?.toFixed(0) ?? "—"}</td>
                                <td className="text-end">{prot?.toFixed(1) ?? "—"}g</td>
                                <td className="text-end">{carb?.toFixed(1) ?? "—"}g</td>
                                <td className="text-end">{fat?.toFixed(1) ?? "—"}g</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </div>
                  </Col>
                </Row>
              )}
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        {/* ── Aanbevelingen ── */}
        <Tab eventKey="recommendations" title="Aanbevelingen">
        <RecommendationsCard rangeParams={rangeParams} />
        </Tab>

        {/* ── Categorie & Top producten ── */}
        <Tab eventKey="categories" title="Categorieën">
        <Col xs={12}>
          <Card className="shadow-sm h-100">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">Uitgaven per categorie</span>
            </Card.Header>
            <Card.Body>
              {categoriesLoading && <Spinner size="sm" />}
              {!categoriesLoading && categories.length === 0 && (
                <Alert variant="info" className="mb-0">Geen categoriedata beschikbaar.</Alert>
              )}
              {categories.length > 0 && <CategoryChart data={categories} />}
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        {/* ── CSV export ── */}
        <Tab eventKey="export" title="Exporteren">
        <ExportCard range={range} rangeParams={rangeParams} />
        </Tab>

        {/* ── Health scorecard ── */}
        <Tab eventKey="advice" title="Voedselgroepen & advies">
        <Col xs={12}>
          <Card className="shadow-sm">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <span className="fw-semibold">Voedselgroepen scorecard</span>
                <div className="small text-muted">
                  Analyse voor {RANGE_LABELS[range].toLowerCase()}
                </div>
              </div>
            </Card.Header>
            <Card.Body>
              <HealthScorecard start={analyticsStart} end={analyticsEnd} />
            </Card.Body>
          </Card>
        </Col>

        {/* ── Ollama chat ── */}
        <Col xs={12} className="mt-4">
          <Card className="shadow-sm">
            <Card.Header className="bg-white">
              <div>
                <span className="fw-semibold">Voedingsadvies assistent</span>
                <div className="small text-muted">
                  Stel vragen over jouw boodschappen van {RANGE_LABELS[range].toLowerCase()} — aangedreven door Ollama (lokaal)
                </div>
              </div>
            </Card.Header>
            <Card.Body>
              <ChatWidget
                start={analyticsStart}
                end={analyticsEnd}
              />
            </Card.Body>
          </Card>
        </Col>
        </Tab>

        <Tab eventKey="products" title="Topproducten">
        <Col xs={12}>
          <Card className="shadow-sm h-100">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">Meest gekochte producten</span>
            </Card.Header>
            <Card.Body className="p-0">
              {productsLoading && <div className="p-3"><Spinner size="sm" /></div>}
              {!productsLoading && products.length === 0 && (
                <Alert variant="info" className="m-3 mb-0">Geen producten gevonden voor deze periode.</Alert>
              )}
              {products.length > 0 && (
                <Table responsive size="sm" hover className="mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">#</th>
                      <th>Product</th>
                      <th className="text-end">Stuks</th>
                      <th className="text-end">Orders</th>
                      <th className="text-end">Bespaard</th>
                      <th className="text-end pe-3">Totaal</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontSize: "0.82rem" }}>
                    {products.slice(0, 20).map((p, i) => (
                      <tr key={i}>
                        <td className="ps-3 text-muted">{i + 1}</td>
                        <td>{p.name}</td>
                        <td className="text-end"><Badge bg="primary">{Math.round(p.total_qty)}×</Badge></td>
                        <td className="text-end"><Badge bg="light" text="dark">{p.order_count}×</Badge></td>
                        <td className="text-end text-success">{p.total_savings > 0 ? `−${euro(p.total_savings)}` : "—"}</td>
                        <td className="text-end pe-3">{euro(p.total_spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
        </Tab>
      </Tabs>
    </>
  );
}
