import { installDiagnostics } from "./reporting";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./theme.css";
import "./global.css";
import { installGlobalErrorHandlers, report } from "./reporting";

// Both caches, not just the query one: a failed mutation is a turn the player lost,
// which is the failure they actually notice, and TanStack Query v5 routes the two
// separately. This is also the only place a failed request is seen regardless of
// whether the calling component handled it.
const client = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => report("query", error) }),
  mutationCache: new MutationCache({
    onError: (error) => report("query", error),
  }),
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

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
