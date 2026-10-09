"use client";
import { useState, useRef, useCallback } from "react";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import InputGroup from "react-bootstrap/InputGroup";
import ListGroup from "react-bootstrap/ListGroup";
import { api, type LinkedProduct } from "@/lib/api";
import { Suggestion } from "@/lib/meals";
import { Stars } from "@/components/meals/Stars";


export function ProductSearchDropdown({
  onSelect,
  onClear,
  currentProduct,
}: {
  onSelect: (id: number) => void;
  onClear: () => void;
  currentProduct: LinkedProduct | null;
}) {
  const [input, setInput] = useState(currentProduct?.name ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [show, setShow] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInput = useCallback((val: string) => {
    setInput(val);
    if (debounce.current) clearTimeout(debounce.current);
    if (val.length < 2) { setSuggestions([]); setShow(false); return; }
    debounce.current = setTimeout(() => {
      api.get<Suggestion[]>(`/products/suggest?q=${encodeURIComponent(val)}&limit=8`)
        .then((s) => { setSuggestions(s); setShow(true); })
        .catch(() => {});
    }, 200);
  }, []);

  return (
    <div className="position-relative">
      <InputGroup size="sm">
        <Form.Control
          placeholder="Zoek product..."
          value={input}
          onChange={(e) => handleInput(e.target.value)}
          onBlur={() => setTimeout(() => setShow(false), 150)}
          style={{ fontSize: "0.8rem" }}
        />
        {currentProduct && (
          <Button variant="outline-secondary" size="sm" onClick={() => { setInput(""); onClear(); }}>✕</Button>
        )}
      </InputGroup>
      {show && suggestions.length > 0 && (
        <ListGroup className="position-absolute w-100 shadow-sm" style={{ zIndex: 9999, top: "100%", maxHeight: 200, overflowY: "auto" }}>
          {suggestions.map((s) => (
            <ListGroup.Item key={s.id} action onMouseDown={() => { setInput(s.name); setShow(false); onSelect(s.id); }}
              className="py-1 px-2" style={{ fontSize: "0.78rem" }}>
              {s.name}{s.brand && <span className="text-muted ms-1">({s.brand})</span>}
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </div>
  );
}

// ─── Stars ─────────────────────────────────────────────────────────────────────

