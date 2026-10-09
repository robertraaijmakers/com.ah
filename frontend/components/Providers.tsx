"use client";
import { ReactNode } from "react";
import { ToastProvider } from "@/lib/toast";
import ServiceWorker from "@/components/ServiceWorker";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ServiceWorker />
      {children}
    </ToastProvider>
  );
}
