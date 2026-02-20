import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./i18n/i18n";
import { ThemeProvider } from "next-themes";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
