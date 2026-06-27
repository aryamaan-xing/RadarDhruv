import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RadarConsole } from "@/components/radar/RadarConsole";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <RadarConsole />
  </StrictMode>,
);
