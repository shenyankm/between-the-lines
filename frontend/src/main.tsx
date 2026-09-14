import { installDiagnostics } from "./reporting";
import { QueryClientProvider } from "@tanstack/react-query";
import { createGameQueryClient } from "./queryClient";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./theme.css";
import "./global.css";
import { installGlobalErrorHandlers } from "./reporting";

const client = createGameQueryClient();

// Outside React's tree, so a failure in an event handler or a timer is caught too --
// nothing React renders would ever see those.
installGlobalErrorHandlers();
installDiagnostics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Outermost: it has to be above the provider, or a throw from the provider
        itself would still blank the page. */}
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
