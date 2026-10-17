import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";
import RepairApp from "./RepairApp";
import { api, load, save } from "./api";
import StaffApp from "./components/StaffApp";
import ZonesPage from "./components/ZonesPage";
import OpsPage from "./components/OpsPage";
import HqPage from "./components/HqPage";
import TeamPage from "./components/TeamPage";
import TeamworkPage from "./components/TeamworkPage";
import FundPage from "./components/FundPage";
import CleanupPage from "./components/CleanupPage";
import TechPage from "./components/TechPage";
import { MediaViewerHost } from "./components/MediaGallery";

// Home follows the site mode an admin sets: "repair" (after the flood, 2 Oct 2026) or "flood" (if the
// water comes back). The last known mode is remembered so the page doesn't flash the wrong one.
function Home() {
  const [mode, setMode] = useState(() => load("siteMode", "repair"));
  useEffect(() => {
    api("/site")
      .then((r) => {
        setMode(r.mode);
        save("siteMode", r.mode);
      })
      .catch(() => {});
  }, []);
  return mode === "flood" ? <App /> : <RepairApp />;
}

const path = window.location.pathname.replace(/\/+$/, "");
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {{ "/staff": <StaffApp />, "/zones": <ZonesPage />, "/ops": <OpsPage />, "/hq": <HqPage />, "/team": <TeamPage />, "/teamwork": <TeamworkPage />, "/admin": <App />, "/flood": <App archived />, "/fund": <FundPage />, "/cleanup": <CleanupPage />, "/tech": <TechPage /> }[path] || <Home />}
    <MediaViewerHost />
  </React.StrictMode>
);
