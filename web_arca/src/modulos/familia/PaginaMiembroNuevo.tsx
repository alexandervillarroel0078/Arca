import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import Encabezado from "../../core/Encabezado";
import { Boton, Campo, CampoClave, MensajeError, claseInput } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { invitar } from "./api";

/** Pantalla "Agregar miembro" (solo admin): crea la cuenta con una clave temporal. */
export default function PaginaMiembroNuevo() {
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const avisar = useAviso();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [rol, setRol] = useState<"miembro" | "admin">("miembro");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario?.rol !== "admin") return <Navigate to="/familia/miembros" replace />;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await invitar(nombre.trim(), email.trim(), clave, rol);
      avisar("Miembro agregado");
      navegar("/familia/miembros", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <Encabezado titulo="Agregar miembro" volverA="/familia/miembros" />
      <p className="text-sm text-stone-600">Se crea su cuenta con una clave temporal que le entregas tú; después la cambia en su perfil.</p>
      <Campo etiqueta="Nombre"><input className={claseInput} value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus /></Campo>
      <Campo etiqueta="Correo"><input className={claseInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Campo>
      <CampoClave etiqueta="Contraseña temporal (mínimo 8)" value={clave} onChange={(e) => setClave(e.target.value)} required minLength={8} mostrarAlInicio autoComplete="off" />
      <Campo etiqueta="Rol">
        <select className={claseInput} value={rol} onChange={(e) => setRol(e.target.value as "miembro" | "admin")}>
          <option value="miembro">Miembro (edita solo lo suyo)</option>
          <option value="admin">Admin (edita todo)</option>
        </select>
      </Campo>
      <MensajeError mensaje={error} />
      <Boton type="submit" disabled={enviando}>{enviando ? "Guardando..." : "Agregar miembro"}</Boton>
    </form>
  );
}
