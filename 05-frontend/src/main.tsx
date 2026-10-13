import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { I18nProvider } from "./i18n/I18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ToastProvider";
import { DialogProvider } from "./components/ConfirmDialog";
import { App } from "./App";
import "./styles/global.css";
import "./styles/print.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <DialogProvider>
                <App />
              </DialogProvider>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
