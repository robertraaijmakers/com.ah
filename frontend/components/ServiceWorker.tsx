"use client";
import { useEffect, useState } from "react";
import Alert from "react-bootstrap/Alert";

/** Registers the service worker (production only) and shows a banner while offline. */
export default function ServiceWorker() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (online) return null;
  return (
    <Alert variant="warning" className="rounded-0 mb-0 py-2 text-center small d-print-none">
      Je bent offline. Je ziet de laatst opgeslagen gegevens; wijzigen kan pas weer met verbinding.
    </Alert>
  );
}
