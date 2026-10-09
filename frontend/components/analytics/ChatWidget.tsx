"use client";
import { useState, useRef, useEffect } from "react";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";
import { api } from "@/lib/api";
import { ChatMessage, STARTERS } from "@/lib/analytics";


export function ChatWidget({ start, end }: { start?: string; end?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(question: string) {
    if (!question.trim() || streaming) return;
    const userMsg: ChatMessage = { role: "user", content: question };
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const resp = await fetch("/api/analytics/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, messages: history, start, end }),
      });

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            if (chunk.content) {
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: next[next.length - 1].content + chunk.content,
                };
                return next;
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: `[Fout: ${e}]` };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div>
      {messages.length === 0 && (
        <div className="d-flex flex-wrap gap-2 mb-3">
          {STARTERS.map(s => (
            <button
              key={s}
              className="btn btn-outline-secondary btn-sm"
              onClick={() => send(s)}
              disabled={streaming}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div
          className="mb-3 border rounded p-3"
          style={{ maxHeight: 480, overflowY: "auto", background: "#f8f9fa" }}
        >
          {messages.map((m, i) => (
            <div key={i} className={`mb-3 ${m.role === "user" ? "text-end" : ""}`}>
              <div
                className="d-inline-block text-start rounded p-2"
                style={{
                  maxWidth: "85%",
                  background: m.role === "user" ? "#003d9b" : "#fff",
                  color: m.role === "user" ? "#fff" : "#212529",
                  fontSize: "0.875rem",
                  whiteSpace: "pre-wrap",
                  border: m.role === "assistant" ? "1px solid #dee2e6" : "none",
                }}
              >
                {m.content || (streaming && i === messages.length - 1 ? "▋" : "")}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="d-flex gap-2">
        <input
          className="form-control form-control-sm"
          placeholder="Stel een vraag over jouw boodschappen…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          disabled={streaming}
        />
        <Button size="sm" variant="primary" onClick={() => send(input)} disabled={streaming || !input.trim()}>
          {streaming ? <Spinner size="sm" /> : "Verstuur"}
        </Button>
        {messages.length > 0 && (
          <Button size="sm" variant="outline-secondary" onClick={() => setMessages([])} disabled={streaming}>
            Wis
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

