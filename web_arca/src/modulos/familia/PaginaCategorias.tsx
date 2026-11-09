import { useState } from "react";
import { Link } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import Encabezado, { AccionFija } from "../../core/Encabezado";
import MenuFila from "../../core/MenuFila";
import { iconoDe } from "../../core/formato";
import { Boton, Cargando, ErrorCaja, Tarjeta, Vacio, claseBotonPrimario, claseInput, useCarga } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { editarCategoria, listarCategorias, type Categoria } from "./api";
import SelectorIcono from "./SelectorIcono";

/** Categorias. Todos las ven; el admin crea, renombra, cambia el icono y desactiva (nunca se borran). */
export default function PaginaCategorias() {
  const { usuario } = useAuth();
  const avisar = useAviso();
  const esAdmin = usuario?.rol === "admin";
  const { datos, error, cargando, recargar } = useCarga(listarCategorias, []);
  const [editando, setEditando] = useState<number | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");
  const [iconoEdit, setIconoEdit] = useState("tag");

  async function cambiarCategoria(c: Categoria, cambios: Partial<Categoria>, mensaje?: string) {
    try {
      await editarCategoria(c.id, cambios);
      setEditando(null);
      if (mensaje) avisar(mensaje);
      recargar();
    } catch (err) {
      avisar((err as Error).message, "error");
    }
  }

  return (
    <div className="space-y-4">
      <Encabezado titulo="Categorías" volverA="/familia" />
      <p className="text-sm text-stone-600">Una categoría desactivada sigue en el historial pero ya no aparece al registrar.</p>

      {cargando && !datos && <Cargando />}
      {error && !datos && <ErrorCaja mensaje={error} />}
      {datos && datos.length === 0 && (
        <Vacio icono="🏷️" texto="Aún no hay categorías." accion={esAdmin ? { texto: "Agregar categoría", a: "/familia/categorias/nueva" } : undefined} />
      )}
      {datos && datos.length > 0 && (
        <Tarjeta className="!py-1">
          <ul className="divide-y divide-stone-100">
            {datos.map((c) => (
              <li key={c.id} data-testid="fila-categoria" data-activa={c.activa} className="py-2 min-h-[56px]">
                {editando === c.id ? (
                  <div className="space-y-3">
                    <input className={claseInput} value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} aria-label="Nombre de la categoría" autoFocus />
                    <SelectorIcono valor={iconoEdit} alCambiar={setIconoEdit} />
                    <div className="grid grid-cols-2 gap-2">
                      <Boton variante="suave" onClick={() => setEditando(null)}>Cancelar</Boton>
                      <Boton onClick={() => cambiarCategoria(c, { nombre: nombreEdit.trim(), icono: iconoEdit }, "Categoría actualizada")}>OK</Boton>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className={`shrink-0 w-11 h-11 rounded-2xl bg-arca-claro flex items-center justify-center text-2xl ${c.activa ? "" : "opacity-40"}`} aria-hidden>{iconoDe(c.icono)}</span>
                    <span className={`flex-1 font-medium ${c.activa ? "" : "text-stone-600 line-through"}`}>
                      {c.nombre}{c.activa ? "" : " (desactivada)"}
                    </span>
                    {esAdmin && (
                      <MenuFila
                        etiqueta={`Acciones de ${c.nombre}`}
                        acciones={[
                          { texto: "Editar nombre e icono", alAccionar: () => { setEditando(c.id); setNombreEdit(c.nombre); setIconoEdit(c.icono); } },
                          c.activa
                            ? { texto: "Desactivar", peligro: true, alAccionar: () => cambiarCategoria(c, { activa: false }, "Categoría desactivada") }
                            : { texto: "Reactivar", alAccionar: () => cambiarCategoria(c, { activa: true }, "Categoría reactivada") },
                        ]}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {esAdmin && (
        <AccionFija>
          <Link to="/familia/categorias/nueva" className={claseBotonPrimario}>Agregar categoría</Link>
        </AccionFija>
      )}
    </div>
  );
}
