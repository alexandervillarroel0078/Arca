import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { olvidarLecturasDeCache } from "../modulos/sync/cache";
import BarraSync from "../modulos/sync/BarraSync";
import { useEnCola } from "../modulos/sync/useSync";

const ITEMS = [
  { a: "/", texto: "Inicio", icono: "🏠" },
  { a: "/apoyos", texto: "Apoyos", icono: "🤝" },
  { a: "/reportes", texto: "Reportes", icono: "📊" },
  { a: "/familia", texto: "Familia", icono: "👨‍👩‍👧" },
];

/**
 * Insignia con el numero de cambios sin enviar (incluye los que esperan una decision), sobre el icono de Inicio. Sin cambios no se
 * dibuja. Es hermana del enlace (no va dentro): asi no cambia el nombre accesible "Inicio" de la pestana. `absolute`: no mueve nada.
 */
function InsigniaPendientes() {
  const n = useEnCola();
  if (n === 0) return null;
  return (
    <span
      role="img"
      aria-label={`${n} ${n === 1 ? "cambio" : "cambios"} sin enviar`}
      data-testid="insignia-pendientes"
      className="pointer-events-none absolute left-1/2 top-1 ml-2 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white bg-apoyo px-1 text-[11px] font-bold leading-none text-white"
    >
      {n > 9 ? "9+" : n}
    </span>
  );
}

/**
 * El "+" de la barra: registrar un movimiento desde cualquier pantalla. Un circulo verde que sobresale de la barra.
 * En "Nuevo" y "Editar" ya estas ahi: queda marcado (aria-current) y atenuado, y tocarlo no navega.
 */
function BotonNuevo() {
  const { pathname } = useLocation();
  const aqui = pathname === "/nuevo" || pathname.startsWith("/editar/");
  return (
    <li>
      <Link
        to="/nuevo"
        aria-label="Nuevo movimiento"
        aria-current={aqui ? "page" : undefined}
        aria-disabled={aqui || undefined}
        onClick={(e) => {
          if (aqui) e.preventDefault(); // no se navega a si mismo (ni se pierde lo que se esta editando)
        }}
        className="group relative block h-nav"
      >
        <span
          aria-hidden
          className={`absolute left-1/2 -top-4 -translate-x-1/2 flex items-center justify-center w-14 h-14 rounded-full border-4 border-white bg-arca text-white text-4xl leading-none shadow-lg ${
            aqui ? "opacity-50" : "group-active:bg-arca-oscuro"
          }`}
        >
          +
        </span>
      </Link>
    </li>
  );
}

/**
 * Estado de una pestana segun la ruta. `actual` = es la pagina en la que estas (lleva aria-current="page").
 * `resaltada` = se ve activa. Inicio se resalta tambien en /nuevo y /editar (de ahi se llega), pero ahi el que lleva
 * aria-current es el "+": a lo mas UN elemento con aria-current="page" por pantalla. En /todos Inicio si es la actual.
 */
export function estadoPestana(ruta: string, pathname: string): { actual: boolean; resaltada: boolean } {
  // Cuentas se abre desde el menú Familia: en /cuentas/* la pestaña resaltada es Familia
  const actual = ruta === "/" ? pathname === "/" || pathname === "/todos" : pathname === ruta || pathname.startsWith(`${ruta}/`) || (ruta === "/familia" && (pathname === "/cuentas" || pathname.startsWith("/cuentas/")));
  const enNuevoOEditar = pathname === "/nuevo" || pathname.startsWith("/editar/");
  return { actual, resaltada: actual || (ruta === "/" && enNuevoOEditar) };
}

/** Marco de la app: contenido centrado (390px de base) y barra de navegacion inferior de 72px. */
export default function Layout() {
  const { pathname } = useLocation();
  // el aviso "Datos de hace X min" habla solo de la pantalla que se esta viendo
  useEffect(() => olvidarLecturasDeCache(), [pathname]);
  return (
    <div className="min-h-full flex flex-col items-center">
      <main className="w-full max-w-[480px] flex-1 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+7rem)]">
        <BarraSync />
        <Outlet />
      </main>
      <nav
        aria-label="Navegación principal"
        className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-stone-200 flex justify-center pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="w-full max-w-[480px] grid grid-cols-5">
          {ITEMS.flatMap((i, n) => [
            ...(n === 2 ? [<BotonNuevo key="nuevo" />] : []), // 2 pestanas, el "+", 2 pestanas
            <li key={i.a} className="relative">
              <Link
                to={i.a}
                aria-current={estadoPestana(i.a, pathname).actual ? "page" : undefined}
                className={`flex flex-col items-center justify-center h-nav gap-0.5 text-xs font-semibold ${estadoPestana(i.a, pathname).resaltada ? "text-arca" : "text-stone-500"}`}
              >
                <span className={`flex items-center justify-center w-14 h-8 rounded-full text-xl leading-none ${estadoPestana(i.a, pathname).resaltada ? "bg-arca-claro" : ""}`} aria-hidden>{i.icono}</span>
                {i.texto}
              </Link>
              {i.a === "/" && <InsigniaPendientes />}
            </li>,
          ])}
        </ul>
      </nav>
    </div>
  );
}
