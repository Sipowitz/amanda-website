import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";

import { AdminAuthProvider } from "./contexts/AdminAuthContext";
import { ToastProvider } from "./contexts/ToastContext";
import { ConfirmProvider } from "./contexts/ConfirmContext";

import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AdminAuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </AdminAuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
