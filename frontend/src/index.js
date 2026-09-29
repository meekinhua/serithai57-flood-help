import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";
import StaffApp from "./components/StaffApp";
import ZonesPage from "./components/ZonesPage";
import OpsPage from "./components/OpsPage";
import HqPage from "./components/HqPage";
import TeamPage from "./components/TeamPage";
import TeamworkPage from "./components/TeamworkPage";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {{ "/staff": <StaffApp />, "/zones": <ZonesPage />, "/ops": <OpsPage />, "/hq": <HqPage />, "/team": <TeamPage />, "/teamwork": <TeamworkPage /> }[window.location.pathname.replace(/\/+$/, "")] || <App />}
  </React.StrictMode>
);
