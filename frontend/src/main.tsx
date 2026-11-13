import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import '@/index.css'
import App from '@/app/App.tsx'
import { enableMocking } from './mocks'

const queryClient = new QueryClient();

async function bootstrap() {
  await enableMocking();

  ReactDOM.createRoot(document.getElementById("root")!).render(
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
