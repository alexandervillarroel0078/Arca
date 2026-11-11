import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAviso } from "../../core/Aviso";
import { ErrorApi, token } from "../../core/api";
import { olvidarUltimo } from "../cuentas/recordar";
import { borrarTodoLocal, olvidarCacheDeSesionVencida, prepararSesion } from "../sync/sesion";
import * as authApi from "./api";
import type { Yo } from "./api";

interface Auth {
  usuario: Yo | null;
  cargando: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  registrar: (nombre: string, email: string, password: string, familia: string) => Promise<void>;
  salir: () => void;
  actualizarUsuario: (u: Yo) => void;
}

const AuthCtx = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth fuera de AuthProvider");
  return c;
}

/** El usuario actual, o null si no hay sesion ni proveedor (componentes que tambien se prueban sueltos). */
export function useUsuarioOpcional(): Yo | null {
  return useContext(AuthCtx)?.usuario ?? null;
}

const CLAVE_USUARIO = "arca-usuario";

export function AuthProvider({ children }: { children: ReactNode }) {
  const avisar = useAviso();
  // El usuario se guarda para poder abrir la app sin internet.
  const [usuario, setUsuario] = useState<Yo | null>(() => {
    try {
      return token.leer() ? (JSON.parse(localStorage.getItem(CLAVE_USUARIO) ?? "null") as Yo | null) : null;
    } catch {
      return null;
    }
  });
  const [cargando, setCargando] = useState(!!token.leer());

  const cerrar = useCallback(() => {
    token.borrar();
    localStorage.removeItem(CLAVE_USUARIO);
    localStorage.removeItem("arca-categorias");
    setUsuario(null);
  }, []);

  // El usuario cierra sesion: se borra TODO lo guardado en el aparato (cache, registros conocidos y cola).
  const salir = useCallback(() => {
    // La bitacora anota la salida (sin esperar; sin internet simplemente no queda). Se pide ANTES de borrar el token.
    try {
      void Promise.resolve(authApi.logout()).catch(() => {});
    } catch {
      /* nunca impide cerrar la sesion */
    }
    cerrar();
    olvidarUltimo(); // lo recordado en Cuentas (solo ids) se va con la sesión
    void borrarTodoLocal().catch(() => {});
  }, [cerrar]);

  // La sesion vencio: se borra el cache pero se CONSERVAN los cambios sin enviar de esa persona.
  const sesionVencida = useCallback(() => {
    cerrar();
    // si el almacen local no responde, no se rompe nada: la sesion ya se cerro
    void olvidarCacheDeSesionVencida().catch(() => {});
  }, [cerrar]);

  const iniciar = async (r: authApi.RespuestaToken) => {
    // antes de mostrar nada: si lo guardado es de otra cuenta se borra (nunca se envian cambios ajenos)
    const descartados = await prepararSesion(r.usuario.id);
    token.guardar(r.access_token);
    localStorage.setItem(CLAVE_USUARIO, JSON.stringify(r.usuario));
    setUsuario(r.usuario);
    if (descartados > 0) avisar(`Se descartaron ${descartados} cambio(s) sin enviar de otra cuenta`, "info");
  };

  useEffect(() => {
    if (!token.leer()) return;
    authApi
      .yo()
      .then((u) => {
        localStorage.setItem(CLAVE_USUARIO, JSON.stringify(u));
        setUsuario(u);
        void prepararSesion(u.id);
      })
      .catch((e) => {
        // Solo se cierra la sesion si el servidor dice que el token no sirve.
        if (e instanceof ErrorApi && e.estado === 401) sesionVencida();
      })
      .finally(() => setCargando(false));
  }, [sesionVencida]);

  useEffect(() => {
    window.addEventListener("arca-sesion-expirada", sesionVencida);
    return () => window.removeEventListener("arca-sesion-expirada", sesionVencida);
  }, [sesionVencida]);

  const valor: Auth = {
    usuario,
    cargando,
    salir,
    actualizarUsuario: (u) => {
      localStorage.setItem(CLAVE_USUARIO, JSON.stringify(u));
      setUsuario(u);
    },
    entrar: async (email, password) => iniciar(await authApi.login(email, password)),
    registrar: async (n, e, p, f) => iniciar(await authApi.registro(n, e, p, f)),
  };
  return <AuthCtx.Provider value={valor}>{children}</AuthCtx.Provider>;
}
