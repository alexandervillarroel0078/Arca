import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import Encabezado from "../../core/Encabezado";
import { Boton, Campo, claseInput } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { crearCategoria } from "./api";
import SelectorIcono from "./SelectorIcono";

/** Pantalla "Agregar categoria" (solo admin). */
export default function PaginaCategoriaNueva() {
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const avisar = useAviso();
  const [nombre, setNombre] = useState("");
  const [icono, setIcono] = useState("tag");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario?.rol !== "admin") return <Navigate to="/familia/categorias" replace />;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await crearCategoria(nombre.trim(), icono);
      avisar("Categoría creada");
      navegar("/familia/categorias", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <Encabezado titulo="Agregar categoría" volverA="/familia/categorias" />
      <Campo etiqueta="Nombre" error={error}>
        <input className={claseInput} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={60} autoFocus aria-invalid={!!error} />
      </Campo>
      <div>
        <p className="text-sm font-semibold text-stone-600 mb-1.5">Icono</p>
        <SelectorIcono valor={icono} alCambiar={setIcono} />
      </div>
      <Boton type="submit" disabled={enviando}>{enviando ? "Guardando..." : "Agregar categoría"}</Boton>
    </form>
  );
}

