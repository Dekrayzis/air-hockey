import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AirHockey } from "./air-hockey/AirHockey";
import "./index.scss";
import "./sections/_air-hockey.scss";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="page">
      <h1 className="page__title">Air Hockey</h1>
      <AirHockey />
    </main>
    <footer className="credit">
      <p>By Vincent Corleone.</p>
    </footer>
  </StrictMode>,
);
