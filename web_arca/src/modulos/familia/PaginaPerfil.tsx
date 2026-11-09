import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import Encabezado from "../../core/Encabezado";
import { Boton, Campo, CampoClave, Tarjeta, claseInput } from "../../core/ui";
import { cambiarClave, cambiarNombre } from "../auth/api";
import { useAuth } from "../auth/AuthContext";

/** Mi perfil: cambiar mi nombre y mi clave (pidiendo la clave actual). */
export default function PaginaPerfil() {
  const { usuario, actualizarUsuario } = useAuth();
  const avisar = useAviso();
  const [miNombre, setMiNombre] = useState(usuario?.nombre ?? "");
  const [claveActual, setClaveActual] = useState("");
  const [claveNueva, setClaveNueva] = useState("");
  const [claveRepetida, setClaveRepetida] = useState("");
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);
  const [errorActual, setErrorActual] = useState<string | null>(null);
  const [errorClave, setErrorClave] = useState<string | null>(null);

  async function guardarNombre(e: FormEvent) {
    e.preventDefault();
    setErrorPerfil(null);
    try {
      actualizarUsuario(await cambiarNombre(miNombre.trim()));
      avisar("Nombre actualizado");
    } catch (err) {
      setErrorPerfil((err as Error).message);
    }
  }

  async function guardarClave(e: FormEvent) {
    e.preventDefault();
    setErrorClave(null);
    setErrorActual(null);
    if (claveNueva !== claveRepetida) return setErrorClave("La clave nueva y su repetición no coinciden");
    try {
      await cambiarClave(claveActual, claveNueva);
      setClaveActual(""); setClaveNueva(""); setClaveRepetida("");
      avisar("Clave actualizada");
    } catch (err) {
      const m = (err as Error).message;
      // la clave actual incorrecta se muestra debajo de ese campo; lo demas, debajo de la clave nueva
      if (/actual/i.test(m)) setErrorActual(m);
      else setErrorClave(m);
    }
  }

  return (
    <div className="space-y-4">
      <Encabezado titulo="Mi perfil" volverA="/familia" />

      <Tarjeta className="flex items-center gap-3">
        <span className="shrink-0 w-14 h-14 rounded-full bg-arca-claro text-arca font-titulo text-xl font-bold flex items-center justify-center" aria-hidden>
          {(usuario?.nombre ?? "?").trim()[0]?.toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="font-titulo font-bold break-words">{usuario?.nombre}</p>
          <p className="text-sm text-stone-600 break-all">{usuario?.email}</p>
          <p className="text-xs font-semibold text-arca">{usuario?.rol === "admin" ? "Administrador" : "Miembro"} · {usuario?.familia_nombre}</p>
        </div>
      </Tarjeta>

      <Link
        to="/familia/perfil/privacidad"
        data-testid="ir-privacidad"
        className="flex items-center gap-3 min-h-[64px] bg-white rounded-tarjeta border border-stone-200 p-4 active:bg-stone-100"
      >
        <span className="text-2xl" aria-hidden>🔒</span>
        <span className="flex-1 min-w-0">
          <span className="block font-titulo font-bold">Privacidad</span>
          <span className="block text-sm text-stone-600">Quién ve lo que registras</span>
        </span>
        <span aria-hidden className="text-xl text-stone-400">›</span>
      </Link>

      <Tarjeta>
        <form onSubmit={guardarNombre} className="space-y-4">
          <h2 className="font-titulo font-bold">Cambiar mi nombre</h2>
          <Campo etiqueta="Mi nombre" error={errorPerfil}>
            <input className={claseInput} value={miNombre} onChange={(e) => setMiNombre(e.target.value)} required maxLength={120} aria-invalid={!!errorPerfil} />
          </Campo>
          <Boton type="submit">Guardar nombre</Boton>
        </form>
      </Tarjeta>

      <Tarjeta>
        <form onSubmit={guardarClave} className="space-y-4">
          <h2 className="font-titulo font-bold">Cambiar mi clave</h2>
          <CampoClave etiqueta="Clave actual" value={claveActual} onChange={(e) => setClaveActual(e.target.value)} required autoComplete="current-password" error={errorActual} />
          <CampoClave etiqueta="Clave nueva (mínimo 8)" value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} required minLength={8} autoComplete="new-password" />
          <CampoClave etiqueta="Repite la clave nueva" value={claveRepetida} onChange={(e) => setClaveRepetida(e.target.value)} required minLength={8} autoComplete="new-password" error={errorClave} />
          <Boton type="submit" variante="suave" className="w-full">Cambiar clave</Boton>
        </form>
      </Tarjeta>
    </div>
  );
}
