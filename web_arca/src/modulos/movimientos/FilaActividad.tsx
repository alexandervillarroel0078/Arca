import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { EtiquetaSync } from "../../core/EtiquetaSync";
import MenuFila, { type AccionMenu } from "../../core/MenuFila";
import { bs, fechaCorta, iconoDe } from "../../core/formato";
import { fechaHora, textoAnulado } from "../../core/tipos";
import { useAnular } from "../../core/useAnular";
import { anularApoyo, reactivarApoyo } from "../apoyos/api";
import { useAuth } from "../auth/AuthContext";
import DialogoHistorial, { type PedidoHistorial } from "../historial/DialogoHistorial";
import DialogoCompartir, { type PedidoCompartir } from "../privacidad/DialogoCompartir";
import { EtiquetaPrivacidad } from "../privacidad/Etiquetas";
import { puedeEditar } from "../privacidad/visibilidad";
import type { ItemActividad } from "./actividad";
import { anularMovimiento, reactivarMovimiento } from "./api";

/**
 * Acciones del menu "..." de una fila (Editar, Anular o Reactivar, Ver historial) con los permisos de siempre:
 * el dueno toca lo suyo, el admin lo de la familia y lo compartido contigo es de solo lectura (el backend lo vuelve a validar). Lo usan la lista completa e Inicio.
 */
export function useAccionesFila(alCambiar: () => void) {
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const [historial, setHistorial] = useState<PedidoHistorial | null>(null);
  const { pedirAnular, reactivarAhora, dialogo } = useAnular(alCambiar);

  const [compartiendo, setCompartiendo] = useState<PedidoCompartir | null>(null);
  const puede = (i: ItemActividad) => puedeEditar(i, usuario);
  const etiquetaTipo = (i: ItemActividad) => (i.tipo === "gasto" ? "gasto" : i.tipo === "ingreso" ? "ingreso" : "apoyo");

  function acciones(i: ItemActividad): AccionMenu[] {
    // "Ver historial" lo puede usar cualquier miembro, aunque el registro no sea suyo.
    const verHistorial: AccionMenu = {
      texto: "Ver historial",
      alAccionar: () => setHistorial({ entidad: i.clase, id: i.id, titulo: `${i.titulo} · ${bs(i.monto)}` }),
    };
    if (!puede(i)) return [verHistorial];
    if (i.anulado) {
      return [
        {
          texto: "Reactivar",
          alAccionar: () => reactivarAhora(() => (i.clase === "apoyo" ? reactivarApoyo(i.id) : reactivarMovimiento(i.id))),
        },
        verHistorial,
      ];
    }
    return [
      { texto: "Editar", alAccionar: () => navegar(`/editar/${i.clase}/${i.id}`) },
      ...(i.usuario_id === usuario?.id
        ? [{
            texto: "Compartir...",
            alAccionar: () => setCompartiendo({ clase: i.clase, id: i.id, titulo: `${i.titulo} · ${bs(i.monto)}`, registro: i }),
          }]
        : []),
      verHistorial,
      {
        texto: "Anular",
        peligro: true,
        alAccionar: () =>
          pedirAnular({
            titulo: `Anular ${etiquetaTipo(i)}`,
            detalle: `${i.titulo} · ${bs(i.monto)}`,
            advertencia:
              i.clase === "apoyo" && (i.devoluciones_activas ?? 0) > 0
                ? `Se anularán también ${i.devoluciones_activas} ${i.devoluciones_activas === 1 ? "devolución" : "devoluciones"} de este apoyo.`
                : undefined,
            anular: (motivo) => (i.clase === "apoyo" ? anularApoyo(i.id, motivo) : anularMovimiento(i.id, motivo)),
            reactivar: () => (i.clase === "apoyo" ? reactivarApoyo(i.id) : reactivarMovimiento(i.id)),
          }),
      },
    ];
  }

  const dialogos: ReactNode = (
    <>
      {dialogo}
      {historial && <DialogoHistorial pedido={historial} alCerrar={() => setHistorial(null)} />}
      {compartiendo && <DialogoCompartir pedido={compartiendo} alCerrar={() => setCompartiendo(null)} alGuardar={alCambiar} />}
    </>
  );
  return { acciones, dialogos };
}

/**
 * Nombre de pila ("Ana") con el nombre completo para quien lo necesite: en `title` (al dejar el dedo/cursor) y como texto solo
 * para lectores de pantalla, asi el nombre completo sigue estando en el texto de la fila.
 */
function Autor({ nombre }: { nombre: string }) {
  const [pila, ...resto] = nombre.trim().split(/\s+/);
  if (resto.length === 0) return <span>{pila}</span>;
  return (
    <span title={nombre}>
      {pila}
      <span className="solo-lectores"> {resto.join(" ")}</span>
    </span>
  );
}

/** Una fila de movimiento o apoyo: icono, titulo, detalle, monto y menu "..." de 44px. Lo anulado va en gris y tachado. */
export default function FilaActividad({
  item: i,
  acciones,
  testid = "fila-lista",
  mostrarAutor = true,
  mostrarFecha = true,
}: {
  item: ItemActividad;
  acciones: AccionMenu[];
  testid?: string;
  /** false: el autor no se ve (p. ej. la lista ya esta filtrada por una persona); sigue en el texto para lectores de pantalla. */
  mostrarAutor?: boolean;
  /** false: la fecha no se ve (la lista la muestra en el encabezado del dia); sigue en el texto para lectores de pantalla. */
  mostrarFecha?: boolean;
}) {
  return (
    <div
      data-testid={testid}
      data-anulado={i.anulado}
      className={`flex items-start gap-2 pl-4 pr-1 py-2 min-h-[64px] ${i.anulado ? "bg-stone-100 text-stone-600" : ""}`}
    >
      <span className="text-2xl mt-2" aria-hidden>
        {i.tipo === "apoyo" ? "🤝" : i.tipo === "ingreso" ? "💰" : iconoDe(i.categoria_icono)}
      </span>
      <div className="flex-1 min-w-0 py-1">
        <p className={`font-medium break-words ${i.anulado ? "line-through" : ""}`}>{i.titulo}</p>
        <p className="text-xs text-stone-600">
          {i.tipo === "apoyo" ? "Apoyo" : i.categoria_nombre ?? "Ingreso"}
          {mostrarAutor ? <> · <Autor nombre={i.usuario_nombre} /></> : <span className="solo-lectores"> · {i.usuario_nombre}</span>}
          {mostrarFecha ? <> · {fechaCorta(i.fecha)}</> : <span className="solo-lectores"> · {fechaCorta(i.fecha)}</span>}
          {i.tipo === "apoyo" && i.estado && !i.anulado ? <span className="text-sm font-semibold">{` · ${i.estado}`}</span> : ""}
        </p>
        {/* etiquetas del registro (quien lo ve, sin enviar, en conflicto); un registro normal no muestra nada */}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
          <EtiquetaPrivacidad registro={i} />
          <EtiquetaSync sinSincronizar={i.sinSincronizar} enConflicto={i.enConflicto} />
        </div>
        {i.anulado ? (
          <p className="text-xs text-red-700 mt-0.5">{textoAnulado(i)}</p>
        ) : (
          i.editado_por_nombre && i.editado_en && (
            <p className="text-sm text-stone-600 mt-0.5">Editado por {i.editado_por_nombre} · {fechaHora(i.editado_en)}</p>
          )
        )}
      </div>
      <p
        className={`monto font-titulo font-bold py-3 whitespace-nowrap ${
          i.anulado ? "line-through" : i.tipo === "ingreso" ? "text-arca" : i.tipo === "apoyo" ? "text-apoyo" : ""
        }`}
      >
        {i.tipo === "ingreso" ? "+" : "-"}{bs(i.monto)}
      </p>
      <MenuFila acciones={acciones} etiqueta={`Acciones de ${i.titulo}`} />
    </div>
  );
}
