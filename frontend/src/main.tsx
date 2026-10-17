import React from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import '@/index.css'
import App from '@/app/App.tsx'

const queryClient = new QueryClient();

async function bootstrap() {
  if (import.meta.env.VITE_ENABLE_MOCK === "true") {
    const { worker } = await import("./mocks/browser");
    await worker.start({ serviceWorker: { url: "/mockServiceWorker.js" } });
  }

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

bootstrap();
