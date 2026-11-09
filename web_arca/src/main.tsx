import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { buscarVersionesNuevas, marcarVersionNueva } from "./core/actualizacion";
import { apiConfigurada } from "./core/api";
import { ErrorConfiguracionPantalla } from "./core/AvisosGlobales";
import "./index.css";

// Service worker: la app abre y registra sin internet. Una version nueva NO se aplica sola: se avisa
// ("Hay una version nueva, actualizar") y el usuario decide cuando recargar.
const actualizarSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    marcarVersionNueva(() => actualizarSW(true));
  },
  onRegisteredSW(_url, registro) {
    if (registro) buscarVersionesNuevas(registro);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>{apiConfigurada() ? <App /> : <ErrorConfiguracionPantalla />}</StrictMode>,
);
