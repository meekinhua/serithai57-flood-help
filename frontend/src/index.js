import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";
import StaffApp from "./components/StaffApp";
import ZonesPage from "./components/ZonesPage";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {{ "/staff": <StaffApp />, "/zones": <ZonesPage /> }[window.location.pathname.replace(/\/+$/, "")] || <App />}
  </React.StrictMode>
);
