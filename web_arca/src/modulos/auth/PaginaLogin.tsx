import { useState, type FormEvent } from "react";
import { Boton, Campo, CampoClave, ErrorCaja, claseInput } from "../../core/ui";
import { useAuth } from "./AuthContext";

export default function PaginaLogin() {
  const { entrar, registrar } = useAuth();
  const [modoRegistro, setModoRegistro] = useState(false);
  const [nombre, setNombre] = useState("");
  const [familia, setFamilia] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      if (modoRegistro) await registrar(nombre, email, password, familia);
      else await entrar(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-8">
      <form onSubmit={enviar} className="w-full max-w-[400px] space-y-4">
        <div className="text-center mb-2">
          <div className="text-5xl" aria-hidden>🛟</div>
          <h1 className="font-titulo text-3xl font-bold text-arca">Arca</h1>
          <p className="text-stone-600 mt-1">Gastos de la familia, al instante</p>
        </div>

        {modoRegistro && (
          <>
            <Campo etiqueta="Tu nombre">
              <input className={claseInput} value={nombre} onChange={(e) => setNombre(e.target.value)} required autoComplete="name" />
            </Campo>
            <Campo etiqueta="Nombre de la familia (opcional)">
              <input className={claseInput} value={familia} onChange={(e) => setFamilia(e.target.value)} />
            </Campo>
          </>
        )}
        <Campo etiqueta="Correo">
          <input className={claseInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Campo>
        <CampoClave
          etiqueta="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={modoRegistro ? 8 : undefined}
          autoComplete={modoRegistro ? "new-password" : "current-password"}
        />

        <ErrorCaja mensaje={error} />
        <Boton type="submit" disabled={enviando}>
          {enviando ? "Un momento..." : modoRegistro ? "Crear cuenta y familia" : "Entrar"}
        </Boton>
        <button
          type="button"
          className="w-full min-h-[48px] text-arca font-semibold rounded-campo border-[1.5px] border-stone-300 bg-white active:bg-arca-claro"
          onClick={() => {
            setModoRegistro(!modoRegistro);
            setError(null);
          }}
        >
          {modoRegistro ? "Ya tengo cuenta" : "Crear una cuenta nueva"}
        </button>
      </form>
      {import.meta.env.VITE_BUILD_ID && (
        <p data-testid="version-app" className="text-center text-xs text-stone-400 mt-6">Versión {import.meta.env.VITE_BUILD_ID}</p>
      )}
    </div>
  );
}
