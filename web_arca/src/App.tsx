import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AvisoProvider } from "./core/Aviso";
import { AvisoActualizacion, AvisoServidor } from "./core/AvisosGlobales";
import Layout from "./core/Layout";
import PaginaRango from "./core/PaginaRango";
import { PeriodoProvider } from "./core/PeriodoContext";
import { Cargando } from "./core/ui";
import PaginaApoyos from "./modulos/apoyos/PaginaApoyos";
import { AuthProvider, useAuth } from "./modulos/auth/AuthContext";
import PaginaLogin from "./modulos/auth/PaginaLogin";
import PaginaBitacora from "./modulos/bitacora/PaginaBitacora";
import PaginaCategoriaNueva from "./modulos/familia/PaginaCategoriaNueva";
import PaginaCategorias from "./modulos/familia/PaginaCategorias";
import PaginaMiFamilia from "./modulos/familia/PaginaMiFamilia";
import PaginaFamilia from "./modulos/familia/PaginaFamilia";
import PaginaMiembroNuevo from "./modulos/familia/PaginaMiembroNuevo";
import PaginaMiembros from "./modulos/familia/PaginaMiembros";
import PaginaPerfil from "./modulos/familia/PaginaPerfil";
import PaginaPrivacidad from "./modulos/privacidad/PaginaPrivacidad";
import PaginaActividadFamilia from "./modulos/historial/PaginaActividadFamilia";
import PaginaInicio from "./modulos/inicio/PaginaInicio";
import PaginaLista from "./modulos/movimientos/PaginaLista";
import PaginaNuevo from "./modulos/movimientos/PaginaNuevo";
import Sincronizador from "./modulos/sync/Sincronizador";
import PaginaReportes from "./modulos/reportes/PaginaReportes";

/** El periodo elegido vive aqui, por encima de las pantallas: se conserva al navegar y se reinicia al cerrar sesion. */
function ConPeriodo({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  return (
    <PeriodoProvider diaInicioMes={usuario?.dia_inicio_mes ?? 1} sesion={usuario?.id ?? null}>
      {children}
    </PeriodoProvider>
  );
}

function Rutas() {
  const { usuario, cargando } = useAuth();
  if (cargando) return <Cargando />;
  if (!usuario) return <PaginaLogin />;
  return (
    <>
    <Sincronizador />
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<PaginaInicio />} />
        <Route path="nuevo" element={<PaginaNuevo />} />
        <Route path="editar/:clase/:id" element={<PaginaNuevo />} />
        <Route path="todos" element={<PaginaLista />} />
        <Route path="apoyos" element={<PaginaApoyos />} />
        <Route path="reportes" element={<PaginaReportes />} />
        <Route path="periodo/rango" element={<PaginaRango />} />
        <Route path="familia" element={<PaginaFamilia />} />
        <Route path="familia/mi-familia" element={<PaginaMiFamilia />} />
        <Route path="familia/miembros" element={<PaginaMiembros />} />
        <Route path="familia/miembros/nuevo" element={<PaginaMiembroNuevo />} />
        <Route path="familia/categorias" element={<PaginaCategorias />} />
        <Route path="familia/categorias/nueva" element={<PaginaCategoriaNueva />} />
        <Route path="familia/actividad" element={<PaginaActividadFamilia />} />
        <Route path="familia/bitacora" element={<PaginaBitacora />} />
        <Route path="familia/perfil" element={<PaginaPerfil />} />
        <Route path="familia/perfil/privacidad" element={<PaginaPrivacidad />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AvisoProvider>
        <AvisoServidor />
        <AvisoActualizacion />
        <AuthProvider>
          <ConPeriodo>
            <Rutas />
          </ConPeriodo>
        </AuthProvider>
      </AvisoProvider>
    </BrowserRouter>
  );
}
