// leaflet.markercluster is a UMD plugin that extends the global `L`; expose ours before it loads.
import L from "leaflet";

window.L = L;
export default L;
