import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ErrorRed } from "./api";

// Componentes visuales basicos del sistema de diseno. Todos los controles miden 44px o mas de alto.

type Variante = "primario" | "apoyo" | "suave" | "peligro";

/**
 * Jerarquia de botones (nunca todos iguales):
 *  - primario: relleno verde, ancho completo, 56px: LA accion de la pantalla.
 *  - suave: secundario, blanco con borde.
 *  - peligro: destructivo (anular), rojo suave.
 *  - apoyo: relleno naranja (acciones del flujo de apoyos).
 */
export function Boton({
  variante = "primario",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  const estilos: Record<Variante, string> = {
    primario: "w-full min-h-[56px] bg-arca text-white text-base active:bg-arca-oscuro",
    apoyo: "min-h-[48px] bg-apoyo text-white active:opacity-90",
    suave: "min-h-[48px] bg-white text-stone-900 border-[1.5px] border-stone-300 active:bg-stone-100",
    peligro: "min-h-[48px] bg-red-50 text-red-700 border-[1.5px] border-red-200 active:bg-red-100",
  };
  return (
    <button
      {...props}
      className={`px-4 rounded-campo font-semibold disabled:opacity-50 transition ${estilos[variante]} ${className}`}
    />
  );
}

export function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-tarjeta border border-stone-200 p-4 ${className}`}>{children}</div>;
}

/** Mensaje de error de un campo: icono + texto (nunca solo color), debajo del campo. */
export function MensajeError({ mensaje }: { mensaje: string | null | undefined }) {
  if (!mensaje) return null;
  return (
    // el icono va como contenido CSS: se ve (nunca solo color) pero no forma parte del texto del mensaje
    <p role="alert" className="mt-1 flex items-start gap-1.5 text-sm font-medium text-red-700 before:content-['⚠'] before:shrink-0">
      {mensaje}
    </p>
  );
}

/** Resalte de «esto hay que revisarlo» (p. ej. un campo que el dictado no entendió): borde y fondo del color de apoyo. */
export const claseRevisar = "rounded-xl p-2 -m-2 bg-apoyo-claro/60 ring-2 ring-apoyo";

/** Aviso de un campo por revisar: icono + texto (nunca solo color). No es un error: no usa role="alert". */
export function AvisoRevisar({ mensaje }: { mensaje: string | null | undefined }) {
  if (!mensaje) return null;
  return (
    <p data-testid="aviso-revisar" className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-apoyo-texto before:content-['⚠'] before:shrink-0">
      {mensaje}
    </p>
  );
}

/** Etiqueta arriba, campo de 52px y, si hay, el error debajo del campo. `aviso` marca el campo como «por revisar». */
export function Campo({ etiqueta, children, error, aviso }: { etiqueta: string; children: ReactNode; error?: string | null; aviso?: string | null }) {
  return (
    <div className={aviso ? claseRevisar : undefined} data-revisar={aviso ? "true" : undefined}>
      <label className="block">
        <span className="block text-sm font-semibold text-stone-600 mb-1.5">{etiqueta}</span>
        {children}
      </label>
      <AvisoRevisar mensaje={aviso} />
      <MensajeError mensaje={error} />
    </div>
  );
}

/** Estilo del boton principal para enlaces (<Link>) que se ven como boton: relleno verde, ancho completo, 56px. */
export const claseBotonPrimario =
  "flex items-center justify-center w-full min-h-[56px] px-4 rounded-campo font-semibold text-base bg-arca text-white active:bg-arca-oscuro shadow-md";

export const claseInput =
  "w-full min-h-[52px] px-3.5 rounded-campo border-[1.5px] border-stone-300 bg-white text-base focus:outline-none focus:border-arca focus:ring-2 focus:ring-arca/40";

/** Campo de clave con boton para mostrar u ocultar. */
export function CampoClave({
  etiqueta,
  error,
  mostrarAlInicio = false,
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { etiqueta: string; error?: string | null; mostrarAlInicio?: boolean }) {
  const id = useId();
  const [visible, setVisible] = useState(mostrarAlInicio);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-stone-600 mb-1.5">
        {etiqueta}
      </label>
      <div className="relative">
        <input id={id} {...props} type={visible ? "text" : "password"} className={`${claseInput} pr-24 ${className}`} />
        <button
          type="button"
          aria-label={visible ? "Ocultar clave" : "Mostrar clave"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] px-3 rounded-xl text-sm font-semibold text-arca active:bg-arca-claro"
        >
          {visible ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      <MensajeError mensaje={error} />
    </div>
  );
}

/** Interruptor (on/off): un checkbox de verdad con apariencia de interruptor, asi funciona con teclado y lectores. */
export function Interruptor({ etiqueta, activo, alCambiar }: { etiqueta: string; activo: boolean; alCambiar: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 min-h-[48px] font-medium cursor-pointer">
      <span>{etiqueta}</span>
      <input
        type="checkbox"
        role="switch"
        checked={activo}
        onChange={(e) => alCambiar(e.target.checked)}
        className="appearance-none shrink-0 w-14 h-8 rounded-full bg-stone-300 checked:bg-arca relative transition-colors before:content-[''] before:absolute before:top-1 before:left-1 before:w-6 before:h-6 before:rounded-full before:bg-white before:shadow before:transition-transform checked:before:translate-x-6"
      />
    </label>
  );
}

/** Estado de carga con esqueletos (nunca pantalla en blanco). El texto solo se anuncia a lectores de pantalla. */
export function Cargando({ texto = "Cargando..." }: { texto?: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-3 py-2">
      <span className="sr-only">{texto}</span>
      <div className="esqueleto h-36 rounded-tarjeta" />
      <div className="esqueleto h-16 rounded-tarjeta" />
      <div className="esqueleto h-16 rounded-tarjeta" />
      <div className="esqueleto h-16 rounded-tarjeta" />
    </div>
  );
}

export interface AccionVacio {
  texto: string;
  /** Ruta a la que lleva (enlace) ... */
  a?: string;
  /** ... o funcion a ejecutar (boton). */
  alClic?: () => void;
}

/** Estado vacio: mensaje amable y, cuando hay algo que hacer, una accion. */
export function Vacio({ texto, icono = "🌱", accion }: { texto: string; icono?: string; accion?: AccionVacio }) {
  const clase =
    "inline-flex items-center justify-center min-h-[48px] px-5 rounded-campo font-semibold border-[1.5px] border-arca text-arca bg-white active:bg-arca-claro";
  return (
    <div className="text-center text-stone-600 py-8 px-4 space-y-3" data-testid="estado-vacio">
      <div className="text-4xl" aria-hidden>{icono}</div>
      <p>{texto}</p>
      {accion && (accion.a ? (
        <Link to={accion.a} className={clase}>{accion.texto}</Link>
      ) : (
        <button type="button" onClick={accion.alClic} className={clase}>{accion.texto}</button>
      ))}
    </div>
  );
}

/** Error visible: icono + texto (nunca solo color). */
export function ErrorCaja({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 text-red-800 px-3 py-2.5 text-sm font-medium before:content-['⚠'] before:shrink-0">
      {mensaje}
    </div>
  );
}

export function Titulo({ children }: { children: ReactNode }) {
  return <h1 className="font-titulo text-2xl font-bold">{children}</h1>;
}

/**
 * Hook simple para cargar datos de la API y poder recargarlos.
 * `olvidarAlCambiar`: al cambiar `deps` (p. ej. el periodo) se descartan los datos anteriores, para no mostrar
 * los numeros de un periodo con la etiqueta de otro mientras llegan los nuevos (o si no llegan).
 */
export function useCarga<T>(cargar: () => Promise<T>, deps: unknown[], olvidarAlCambiar = false) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);

  const claveDeps = JSON.stringify(deps);
  const [claveDatos, setClaveDatos] = useState(claveDeps); // para que dependencias se cargaron los datos que hay
  const [claveError, setClaveError] = useState<string | null>(null); // y para cuales fallo la carga
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    cargar()
      .then((d) => vivo && (setDatos(d), setError(null), setSinConexion(false), setClaveDatos(claveDeps), setClaveError(null)))
      .catch((e: Error) => vivo && (setError(e.message), setSinConexion(e instanceof ErrorRed), setClaveError(claveDeps)))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  useEffect(() => {
    const f = () => setVersion((v) => v + 1);
    window.addEventListener("arca-datos-nuevos", f);
    return () => window.removeEventListener("arca-datos-nuevos", f);
  }, []);

  // Con `olvidarAlCambiar`, ni los datos ni el error de OTRO periodo se muestran: ni los numeros viejos con la etiqueta
  // nueva, ni (si la carga nueva falla) los datos viejos en lugar del error.
  const datosVigentes = !olvidarAlCambiar || claveDatos === claveDeps;
  const errorVigente = !olvidarAlCambiar || claveError === claveDeps;
  return {
    datos: datosVigentes ? datos : null,
    error: errorVigente ? error : null,
    cargando: olvidarAlCambiar && !datosVigentes && !errorVigente ? true : cargando,
    sinConexion: errorVigente ? sinConexion : false,
    recargar: () => setVersion((v) => v + 1),
  };
}

/** Sin conexion y sin copia de este periodo (nunca se abrio con internet): se dice claro, no es un error de la app. */
export function SinDatosPeriodo() {
  return (
    <div role="status" data-testid="sin-datos-periodo" className="flex gap-3 rounded-tarjeta bg-apoyo-claro border border-apoyo/30 p-4 text-apoyo-texto">
      <span aria-hidden className="text-2xl">📴</span>
      <div>
        <p className="font-titulo font-bold">Sin datos guardados para este periodo</p>
        <p className="text-sm">Este periodo no se abrió antes con internet. Conéctate para verlo; los periodos que ya abriste sí se ven sin conexión y lo que registres se enviará después.</p>
      </div>
    </div>
  );
}
