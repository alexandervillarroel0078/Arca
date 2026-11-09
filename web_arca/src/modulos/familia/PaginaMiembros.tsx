import { useState } from "react";
import { Link } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import { useConfirmar } from "../../core/DialogoConfirmar";
import { Fondo } from "../../core/DialogoAnular";
import Encabezado, { AccionFija } from "../../core/Encabezado";
import MenuFila, { type AccionMenu } from "../../core/MenuFila";
import { Boton, Cargando, ErrorCaja, Tarjeta, claseBotonPrimario, useCarga } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { editarMiembro, listarMiembros, restablecerClave, type MiembroFamilia } from "./api";

/** Miembros de la familia. Todos la ven; el admin agrega, cambia roles, desactiva y restablece claves. */
export default function PaginaMiembros() {
  const { usuario } = useAuth();
  const avisar = useAviso();
  const esAdmin = usuario?.rol === "admin";
  const { datos, error, cargando, recargar } = useCarga(listarMiembros, []);
  const [temporal, setTemporal] = useState<{ nombre: string; clave: string } | null>(null);
  const { confirmar, dialogo: dialogoConfirmar } = useConfirmar();

  async function cambiarMiembro(m: MiembroFamilia, cambios: Partial<{ rol: "admin" | "miembro"; activo: boolean }>, mensaje: string) {
    try {
      await editarMiembro(m.usuario_id, cambios);
      avisar(mensaje);
      recargar();
    } catch (err) {
      avisar((err as Error).message, "error");
    }
  }

  function nuevaClaveTemporal(m: MiembroFamilia) {
    confirmar({
      titulo: "Restablecer clave",
      mensaje: `¿Restablecer la clave de ${m.nombre}? La clave actual dejará de servir.`,
      ejecutar: () => restablecer(m),
    });
  }

  async function restablecer(m: MiembroFamilia) {
    try {
      const r = await restablecerClave(m.usuario_id);
      setTemporal({ nombre: m.nombre, clave: r.clave_temporal });
    } catch (err) {
      avisar((err as Error).message, "error");
    }
  }

  function menuMiembro(m: MiembroFamilia): AccionMenu[] {
    return [
      m.rol === "admin"
        ? { texto: "Pasar a miembro", alAccionar: () => cambiarMiembro(m, { rol: "miembro" }, `${m.nombre} ahora es miembro`) }
        : { texto: "Hacer administrador", alAccionar: () => cambiarMiembro(m, { rol: "admin" }, `${m.nombre} ahora es administrador`) },
      m.activo
        ? { texto: "Desactivar", peligro: true, alAccionar: () => cambiarMiembro(m, { activo: false }, `${m.nombre} fue desactivado`) }
        : { texto: "Reactivar", alAccionar: () => cambiarMiembro(m, { activo: true }, `${m.nombre} fue reactivado`) },
      { texto: "Restablecer clave", alAccionar: () => nuevaClaveTemporal(m) },
    ];
  }

  return (
    <div className="space-y-4">
      <Encabezado titulo="Miembros" volverA="/familia" />
      {!esAdmin && <p className="text-sm text-stone-600">Solo un administrador puede agregar o cambiar miembros.</p>}

      {cargando && !datos && <Cargando />}
      {error && !datos && <ErrorCaja mensaje={error} />}
      {datos && (
        <Tarjeta className="!py-1">
          <ul className="divide-y divide-stone-100">
            {datos.map((m) => (
              <li key={m.usuario_id} data-testid="fila-miembro" data-activo={m.activo} className={`flex items-center gap-3 py-2.5 min-h-[64px] ${m.activo ? "" : "text-stone-400"}`}>
                <span className="shrink-0 w-11 h-11 rounded-full bg-arca-claro text-arca font-titulo font-bold flex items-center justify-center" aria-hidden>
                  {m.nombre.trim()[0]?.toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold break-words ${m.activo ? "" : "line-through"}`}>{m.nombre}</p>
                  <p className="text-xs text-stone-600 break-all">{m.email}</p>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${!m.activo ? "bg-stone-200 text-stone-600" : m.rol === "admin" ? "bg-arca-claro text-arca" : "bg-stone-100 text-stone-700"}`}>
                  {!m.activo ? "Desactivado" : m.rol === "admin" ? "Admin" : "Miembro"}
                </span>
                {esAdmin && <MenuFila acciones={menuMiembro(m)} etiqueta={`Acciones de ${m.nombre}`} />}
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {esAdmin && (
        <AccionFija>
          <Link to="/familia/miembros/nuevo" className={claseBotonPrimario}>Agregar miembro</Link>
        </AccionFija>
      )}

      {dialogoConfirmar}
      {temporal && (
        <Fondo alCerrar={() => setTemporal(null)} sinGuardar>
          <div role="dialog" aria-modal="true" aria-label="Clave temporal" className="bg-white rounded-tarjeta p-5 w-full max-w-[400px] space-y-3">
            <h2 className="font-titulo text-xl font-bold">Clave temporal</h2>
            <p className="text-sm text-stone-600">Entrega esta clave a {temporal.nombre}. Solo se muestra ahora; después podrá cambiarla en su perfil.</p>
            <p className="font-titulo text-2xl font-bold text-center bg-stone-100 rounded-xl py-3 select-all" data-testid="clave-temporal">{temporal.clave}</p>
            <Boton onClick={() => setTemporal(null)}>Listo</Boton>
          </div>
        </Fondo>
      )}
    </div>
  );
}
