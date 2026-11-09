import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Fondo } from "../../core/DialogoAnular";
import { Boton, Titulo } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { cantidadEnCola } from "../sync/cola";

interface Opcion {
  id: string;
  icono: string;
  titulo: string;
  descripcion: string;
  a?: string;
  alClic?: () => void;
  peligro?: boolean;
}

function TarjetaOpcion({ o }: { o: Opcion }) {
  const contenido: ReactNode = (
    <>
      <span className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${o.peligro ? "bg-red-50" : "bg-arca-claro"}`} aria-hidden>
        {o.icono}
      </span>
      <span className="flex-1 min-w-0 text-left">
        <span className={`block font-titulo font-bold ${o.peligro ? "text-red-700" : ""}`}>{o.titulo}</span>
        <span className="block text-sm text-stone-600">{o.descripcion}</span>
      </span>
      <span className="text-2xl text-stone-400" aria-hidden>›</span>
    </>
  );
  const clase = "flex items-center gap-3 w-full bg-white rounded-tarjeta border border-stone-200 p-4 min-h-[76px] active:bg-stone-100";
  return o.a ? (
    <Link to={o.a} data-testid={`opcion-familia-${o.id}`} className={clase}>{contenido}</Link>
  ) : (
    <button type="button" onClick={o.alClic} data-testid={`opcion-familia-${o.id}`} className={clase}>{contenido}</button>
  );
}

/** Pregunta antes de salir; avisa si hay cambios sin enviar (al salir se borran del telefono). */
function DialogoCerrarSesion({ alCerrar }: { alCerrar: () => void }) {
  const { salir } = useAuth();
  const navegar = useNavigate();
  const [sinEnviar, setSinEnviar] = useState<number | null>(null);
  useEffect(() => {
    void cantidadEnCola().then(setSinEnviar);
  }, []);
  return (
    <Fondo alCerrar={alCerrar}>
      <div role="dialog" aria-modal="true" aria-label="Cerrar sesión" className="bg-white rounded-tarjeta p-5 w-full max-w-[400px] space-y-3">
        <h2 className="font-titulo text-xl font-bold">Cerrar sesión</h2>
        <p className="text-stone-700">Vas a salir de Arca en este dispositivo.</p>
        {!!sinEnviar && (
          <p role="alert" className="flex gap-2 rounded-xl bg-apoyo-claro text-apoyo-texto px-3 py-2 text-sm font-semibold">
            <span aria-hidden>⚠</span>
            <span>Hay {sinEnviar} registro(s) sin enviar. Si sales ahora se perderán.</span>
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="suave" onClick={alCerrar}>Cancelar</Boton>
          <Boton
            variante="peligro"
            onClick={() => {
              salir();
              navegar("/", { replace: true }); // el proximo ingreso empieza en Inicio, no en esta pantalla
            }}
          >
            Cerrar sesión
          </Boton>
        </div>
      </div>
    </Fondo>
  );
}

/** Familia: un menu de opciones; cada una abre su propia pantalla. */
export default function PaginaFamilia() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "admin";
  const [saliendo, setSaliendo] = useState(false);

  const opciones: Opcion[] = [
    { id: "mi-familia", icono: "🏡", titulo: "Mi familia", descripcion: esAdmin ? "Tu familia y el día en que empieza el mes" : "Tu familia y cuándo empieza el mes", a: "/familia/mi-familia" },
    { id: "miembros", icono: "👥", titulo: "Miembros", descripcion: esAdmin ? "Quiénes forman tu familia y sus roles" : "Quiénes forman tu familia", a: "/familia/miembros" },
    { id: "categorias", icono: "🏷️", titulo: "Categorías", descripcion: esAdmin ? "En qué se gasta: crea y ordena categorías" : "En qué se gasta", a: "/familia/categorias" },
    ...(esAdmin ? [{ id: "actividad", icono: "🕑", titulo: "Actividad de la familia", descripcion: "Todo lo que se hizo, quién y cuándo", a: "/familia/actividad" }] : []),
    ...(esAdmin ? [{ id: "bitacora", icono: "🛡️", titulo: "Bitácora", descripcion: "Quién entró, intentos fallidos y cambios", a: "/familia/bitacora" }] : []),
    { id: "perfil", icono: "🙂", titulo: "Mi perfil", descripcion: "Tu nombre y tu clave", a: "/familia/perfil" },
    { id: "salir", icono: "🚪", titulo: "Cerrar sesión", descripcion: "Salir de Arca en este dispositivo", alClic: () => setSaliendo(true), peligro: true },
  ];

  return (
    <div className="space-y-4">
      <div>
        <Titulo>Familia</Titulo>
        <p className="text-sm text-stone-600">
          {usuario?.familia_nombre}
          {!esAdmin && " · solo un administrador puede cambiar categorías y miembros"}
        </p>
      </div>
      <nav aria-label="Opciones de Familia" className="space-y-3">
        {opciones.map((o) => <TarjetaOpcion key={o.id} o={o} />)}
      </nav>
      {saliendo && <DialogoCerrarSesion alCerrar={() => setSaliendo(false)} />}
    </div>
  );
}
