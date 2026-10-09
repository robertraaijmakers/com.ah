"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import Toast from "react-bootstrap/Toast";
import ToastContainer from "react-bootstrap/ToastContainer";

interface ToastMsg { id: number; message: string; variant: string; }
interface ToastCtx { showToast: (message: string, variant?: string) => void; }

const Ctx = createContext<ToastCtx>({ showToast: () => {} });
export const useToast = () => useContext(Ctx);

let _id = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const showToast = useCallback((message: string, variant = "danger") => {
    const id = ++_id;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <ToastContainer position="top-end" className="p-3" style={{ zIndex: 9999, position: "fixed" }}>
        {toasts.map((t) => (
          <Toast key={t.id} bg={t.variant} onClose={() => dismiss(t.id)} show autohide delay={5000}>
            <Toast.Header closeButton>
              <strong className="me-auto">{t.variant === "danger" ? "Fout" : "Melding"}</strong>
            </Toast.Header>
            <Toast.Body className={["danger", "dark", "primary", "secondary"].includes(t.variant) ? "text-white" : ""}>
              {t.message}
            </Toast.Body>
          </Toast>
        ))}
      </ToastContainer>
    </Ctx.Provider>
  );
}
