"use client";
import { useState } from "react";
import useSWR from "swr";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Spinner from "react-bootstrap/Spinner";
import { api } from "@/lib/api";
import { buildQuery, RANGE_LABELS, type Range } from "@/lib/analytics";



export function ExportCard({ range, rangeParams }: { range: Range; rangeParams: { start?: string; end?: string } }) {
  const now = new Date();
  const [exportYear, setExportYear] = useState(now.getFullYear());
  const [exportMonth, setExportMonth] = useState(now.getMonth() + 1);
  const [exportSpecificMonth, setExportSpecificMonth] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const yearsData = useSWR("/analytics/years", (url: string) => api.get<{ years: number[] }>(url));

  async function downloadCsv() {
    const pad = (n: number) => String(n).padStart(2, "0");
    const exportParams = exportSpecificMonth
      ? { start: `${exportYear}-${pad(exportMonth)}-01`, end: `${exportYear}-${pad(exportMonth)}-${new Date(exportYear, exportMonth, 0).getDate()}` }
      : rangeParams;
    const query = buildQuery(exportParams);
    setExportLoading(true);
    try {
      const resp = await fetch(`/api/analytics/export${query}`);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `bestellingen-${exportSpecificMonth ? `${exportYear}-${pad(exportMonth)}` : range}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExportLoading(false);
    }
  }

  return (
          <Card className="shadow-sm">
            <Card.Header className="bg-white">
              <span className="fw-semibold">Exporteren</span>
            </Card.Header>
            <Card.Body>
              <div className="d-flex align-items-center flex-wrap gap-3">
                <div className="form-check">
                  <input
                    id="specific-export-month"
                    className="form-check-input"
                    type="checkbox"
                    checked={exportSpecificMonth}
                    onChange={e => setExportSpecificMonth(e.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="specific-export-month">Specifieke maand</label>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <label className="small fw-medium mb-0">Jaar</label>
                  <select
                    className="form-select form-select-sm"
                    style={{ width: "auto" }}
                    value={exportYear}
                    onChange={e => setExportYear(Number(e.target.value))}
                    disabled={!exportSpecificMonth}
                  >
                    {(yearsData.data?.years ?? [exportYear]).map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <label className="small fw-medium mb-0">Maand</label>
                  <select
                    className="form-select form-select-sm"
                    style={{ width: "auto" }}
                    value={exportMonth}
                    onChange={e => setExportMonth(Number(e.target.value))}
                    disabled={!exportSpecificMonth}
                  >
                    {["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"].map((m, i) => (
                      <option key={i} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <Button size="sm" variant="outline-primary" onClick={downloadCsv} disabled={exportLoading}>
                  {exportLoading ? <Spinner size="sm" className="me-1" /> : null}
                  Download CSV
                </Button>
                <span className="small text-muted">
                  {exportSpecificMonth ? `Alle producten uit ${["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"][exportMonth - 1]} ${exportYear}` : `Alle producten uit ${RANGE_LABELS[range].toLowerCase()}`}
                </span>
              </div>
            </Card.Body>
          </Card>
        
  );
}
