import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import { ErrorApi, ErrorRed } from "../../core/api";
import { AccionFija } from "../../core/Encabezado";
import { ayerISO, hoyISO, iconoDe } from "../../core/formato";
import { Boton, Campo, Cargando, ErrorCaja, claseInput } from "../../core/ui";
import { nuevoUuid } from "../../core/uuid";
import { editarApoyo, listarApoyos, obtenerApoyo } from "../apoyos/api";
import { useUsuarioOpcional } from "../auth/AuthContext";
import { refrescarPorConfirmar } from "../cuentas/porConfirmar";
import { guardarUltimaFuente } from "../cuentas/recordar";
import { listarCategorias, type Categoria } from "../familia/api";
import SelectorVisibilidad, { type Seleccion } from "../privacidad/SelectorVisibilidad";
import { editarMovimiento, obtenerMovimiento, type CamposFuente, type NuevoApoyo, type NuevoMovimiento } from "./api";
import { crearConBanco, editarConBanco, EtiquetaFuente, type FuenteElegida } from "./fuente";
import HojaFuente from "./HojaFuente";
import { registrar } from "./registrar";

/** La fuente con la que se abrió un registro guardado: null = Efectivo; -1 = una cuenta que no ves ("otra cuenta"). */
function fuenteDeRegistro(r: CamposFuente): FuenteElegida | null {
  if (r.fuente !== "banco") return null;
  return { id: r.cuenta_id ?? -1, nombre: r.cuenta_nombre ?? "Banco", directo: true, confirma_nombre: null };
}

const CACHE_CATEGORIAS = "arca-categorias";

type Tipo = "gasto" | "ingreso" | "apoyo";
const TIPOS: { id: Tipo; texto: string }[] = [
  { id: "gasto", texto: "Gasto" },
  { id: "ingreso", texto: "Ingreso" },
  { id: "apoyo", texto: "Apoyo" },
];

/** Registrar un movimiento en pocos segundos. La misma pantalla sirve para editar (/editar/:clase/:id). */
export default function PaginaNuevo() {
  const navegar = useNavigate();
  const avisar = useAviso();
  const { clase, id } = useParams();
  const editando = !!clase && !!id;
  const usuario = useUsuarioOpcional();

  const [tipo, setTipo] = useState<Tipo>(clase === "apoyo" ? "apoyo" : "gasto");
  const [monto, setMonto] = useState("");
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const [categoriaOriginal, setCategoriaOriginal] = useState<number | null>(null);
  const [beneficiario, setBeneficiario] = useState("");
  const [conocidos, setConocidos] = useState<string[]>([]);
  const [fecha, setFecha] = useState(hoyISO());
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [cargandoItem, setCargandoItem] = useState(editando);
  // Fase 17: "Quien lo ve". Un registro nuevo hereda tu preferencia; al editar, el selector solo lo ve el dueno.
  const [quien, setQuien] = useState<Seleccion>({ visibilidad: usuario?.visibilidad_defecto ?? "familia", compartido_con: [] });
  const [esDueno, setEsDueno] = useState(!editando);
  // Fuente de pago (0010): la elegida en la hoja del "+" (null = Efectivo) o, al editar, la del registro.
  const estadoNav = useLocation().state as { fuente?: FuenteElegida | null; cambiarFuente?: boolean } | null;
  const [fuente, setFuente] = useState<FuenteElegida | null>(editando ? null : estadoNav?.fuente ?? null);
  const [fuenteOriginal, setFuenteOriginal] = useState<number | null>(null); // id con que se abrio (al editar)
  const [registro, setRegistro] = useState<CamposFuente | null>(null); // marcas del registro guardado
  const [tipoOriginal, setTipoOriginal] = useState<Tipo | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [hojaFuente, setHojaFuente] = useState(false);

  useEffect(() => {
    listarCategorias()
      .then((c) => {
        setCategorias(c);
        localStorage.setItem(CACHE_CATEGORIAS, JSON.stringify(c.filter((x) => x.activa))); // para registrar sin internet
      })
      .catch(() => {
        try {
          setCategorias(JSON.parse(localStorage.getItem(CACHE_CATEGORIAS) ?? "[]") as Categoria[]);
        } catch {
          /* sin cache */
        }
      });
    if (!editando) {
      listarApoyos()
        .then((a) => setConocidos([...new Set(a.map((x) => x.beneficiario))]))
        .catch(() => {});
    }
  }, [editando]);

  // Modo edicion: cargar el registro y rellenar el formulario.
  // `vivo` evita que una respuesta tardia (o la segunda ejecucion del efecto en desarrollo) pise lo que el usuario ya escribio.
  useEffect(() => {
    if (!editando) return;
    let vivo = true;
    const num = Number(id);
    const cargar = async () => {
      if (clase === "apoyo") {
        const a = await obtenerApoyo(num);
        if (!vivo) return;
        setTipo("apoyo");
        setMonto(String(a.monto));
        setBeneficiario(a.beneficiario);
        setFecha(a.fecha);
        setNota(a.nota ?? "");
        setQuien({ visibilidad: a.visibilidad ?? "familia", compartido_con: a.compartido_con ?? [] });
        setEsDueno(a.usuario_id === usuario?.id);
        cargarFuente(a, "apoyo", a.version);
      } else {
        const m = await obtenerMovimiento(num);
        if (!vivo) return;
        setTipo(m.tipo);
        setMonto(String(m.monto));
        setCategoriaId(m.categoria_id);
        setCategoriaOriginal(m.categoria_id);
        setFecha(m.fecha);
        setNota(m.nota ?? "");
        setQuien({ visibilidad: m.visibilidad ?? "familia", compartido_con: m.compartido_con ?? [] });
        setEsDueno(m.usuario_id === usuario?.id);
        cargarFuente(m, m.tipo, m.version);
      }
    };
    const cargarFuente = (r: CamposFuente, t: Tipo, v: number | undefined) => {
      const f = fuenteDeRegistro(r);
      setFuente(f);
      setFuenteOriginal(f?.id ?? null);
      setRegistro(r);
      setTipoOriginal(t);
      setVersion(v);
      if (estadoNav?.cambiarFuente) setHojaFuente(true); // viene del aviso de rechazo: "Cambiar fuente"
    };
    cargar()
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargandoItem(false));
    return () => {
      vivo = false;
    };
  }, [editando, clase, id]);

  // Al aparecer un error de validacion se baja hasta el y se enfoca (en el movil quedaba bajo la barra, fuera de la vista).
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView?.({ block: "center" }); // (jsdom no lo implementa)
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  const color = tipo === "apoyo" ? "text-apoyo" : "text-arca";
  // Una categoria desactivada no se ofrece para registros nuevos; si el registro ya la tenia, se conserva.
  const selector = categorias.filter((c) => c.activa || c.id === categoriaOriginal);
  const tabs = editando ? TIPOS.filter((t) => (clase === "apoyo" ? t.id === "apoyo" : t.id !== "apoyo")) : TIPOS;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valor = Number(monto.replace(",", "."));
    if (!valor || valor <= 0) return setError("Escribe un monto mayor a cero");
    if (Math.round(valor * 100) / 100 !== valor) return setError("El monto admite hasta 2 decimales");
    if (tipo === "gasto" && categoriaId === null) return setError("Elige una categoría");
    if (tipo === "apoyo" && !beneficiario.trim()) return setError("Escribe quién recibe el apoyo");
    if (esDueno && quien.visibilidad === "elegidas" && quien.compartido_con.length === 0)
      return setError("Elige con quién compartirlo o cambia a Solo yo o Familia");
    const vis = esDueno
      ? { visibilidad: quien.visibilidad, compartido_con: quien.visibilidad === "elegidas" ? quien.compartido_con : [] }
      : {};
    const cuentaId = fuente?.id ?? null;
    const cambioFuente = editando && cuentaId !== fuenteOriginal;
    if (editando && tipoOriginal && tipo !== tipoOriginal && cuentaId !== null)
      return setError(`Un ${tipoOriginal} pagado con banco no se puede pasar a ${tipo}: cámbialo a Efectivo primero`);
    const esApoyo = tipo === "apoyo";
    const datosApoyo: NuevoApoyo = { beneficiario: beneficiario.trim(), monto: valor, fecha, nota: nota.trim() || null, ...vis };
    const datosMov: NuevoMovimiento = {
      tipo: tipo === "ingreso" ? "ingreso" : "gasto",
      monto: valor,
      fecha,
      categoria_id: tipo === "gasto" ? categoriaId : null,
      nota: nota.trim() || null,
      ...vis,
    };

    setEnviando(true);
    try {
      if (editando) {
        if (cambioFuente && cuentaId !== null) {
          // a una cuenta de banco: directo y en linea (nunca por la cola)
          const cambios = esApoyo ? { ...datosApoyo } : { ...datosMov, ...(tipo === "gasto" ? {} : { categoria_id: undefined }) };
          await editarConBanco(esApoyo ? "apoyo" : "movimiento", Number(id), { ...cambios, cuenta_id: cuentaId }, version);
          void refrescarPorConfirmar();
        } else if (esApoyo) {
          await editarApoyo(Number(id), { ...datosApoyo, ...(cambioFuente ? { cuenta_id: null } : {}) });
        } else {
          const { categoria_id, ...resto } = datosMov;
          await editarMovimiento(Number(id), {
            ...resto,
            ...(tipo === "gasto" ? { categoria_id } : {}),
            ...(cambioFuente ? { cuenta_id: null } : {}), // pasar a Efectivo si puede ir por la cola
          });
        }
        if (cambioFuente) guardarUltimaFuente(cuentaId ?? "efectivo");
        avisar("Cambios guardados");
        navegar(-1); // vuelve a donde estaba (Inicio, lista o Apoyos)
        return;
      }
      if (fuente) {
        const conBanco = { cuenta_id: fuente.id, uuid_cliente: nuevoUuid() };
        await (esApoyo ? crearConBanco("apoyo", { ...datosApoyo, ...conBanco }) : crearConBanco("movimiento", { ...datosMov, ...conBanco }));
        guardarUltimaFuente(fuente.id);
        avisar(fuente.directo ? "Guardado" : `Guardado. Queda por confirmar de ${fuente.confirma_nombre ?? "su dueño"}`);
        navegar("/");
        return;
      }
      const resultado = await registrar(esApoyo ? { clase: "apoyo", datos: datosApoyo } : { clase: "movimiento", datos: datosMov });
      guardarUltimaFuente("efectivo");
      avisar(resultado === "enviado" ? "Guardado" : "Sin internet: se guardó en el teléfono y se enviará luego", resultado === "enviado" ? "ok" : "info");
      navegar("/");
    } catch (err) {
      setError(err instanceof ErrorApi || err instanceof ErrorRed ? err.message : "No se pudo guardar");
    } finally {
      setEnviando(false);
    }
  }

  if (cargandoItem) return <Cargando />;

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-titulo text-2xl font-bold">
          {editando ? (clase === "apoyo" ? "Editar apoyo" : "Editar movimiento") : "Nuevo movimiento"}
        </h1>
        <button type="button" onClick={() => navegar(-1)} className="min-h-[44px] min-w-[44px] text-stone-500" aria-label="Cerrar">
          ✕
        </button>
      </div>

      <div className="flex items-baseline justify-center gap-2 py-2">
        <span className={`font-titulo text-3xl font-bold ${color}`}>Bs</span>
        <input
          aria-label="Monto"
          className={`font-titulo text-5xl font-bold w-48 text-center bg-transparent border-b-2 border-stone-300 focus:outline-none focus:border-current ${color}`}
          inputMode="decimal"
          placeholder="0.00"
          value={monto}
          onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, ""))}
          autoFocus={!editando}
        />
      </div>

      {tabs.length > 1 && (
        <div role="tablist" className={`grid gap-1 bg-stone-200 rounded-xl p-1 ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tipo === t.id}
              onClick={() => setTipo(t.id)}
              className={`min-h-[44px] rounded-lg font-semibold ${
                tipo === t.id ? (t.id === "apoyo" ? "bg-apoyo text-white" : "bg-arca text-white") : "text-stone-700"
              }`}
            >
              {t.texto}
            </button>
          ))}
        </div>
      )}

      {/* Fuente de pago: chip tocable que abre la misma hoja del "+" para cambiarla */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-stone-600">{tipo === "ingreso" ? "Entra a" : "Pagado con"}</span>
          <button
            type="button"
            data-testid="chip-fuente"
            aria-label={`${tipo === "ingreso" ? "Entra a" : "Pagado con"}: ${fuente ? fuente.nombre : "Efectivo"}. Cambiar`}
            aria-haspopup="dialog"
            onClick={() => setHojaFuente(true)}
            className="min-h-[44px] max-w-full rounded-full border-[1.5px] border-arca bg-arca-claro px-4 font-semibold text-arca break-words active:bg-white"
          >
            <span aria-hidden>{fuente ? "🏦 " : "💵 "}</span>
            {fuente ? fuente.nombre : "Efectivo"}
            <span aria-hidden className="ml-1 text-xs">▼</span>
          </button>
        </div>
        {/* al editar sin cambiar la fuente: su estado; con una cuenta ajena recien elegida: que no suma hasta confirmar */}
        {editando && registro && (fuente?.id ?? null) === fuenteOriginal && <EtiquetaFuente registro={registro} />}
        {fuente && !fuente.directo && (fuente.id !== fuenteOriginal || !editando) && (
          <p data-testid="aviso-confirmacion" className="text-xs font-medium text-apoyo-texto">
            Requiere confirmación de {fuente.confirma_nombre ?? "su dueño"}: no se descuenta de la cuenta hasta que lo confirme.
          </p>
        )}
      </div>
      {hojaFuente && (
        <HojaFuente
          actual={fuente ? fuente.id : "efectivo"}
          alCerrar={() => setHojaFuente(false)}
          alElegir={(f) => {
            setFuente(f);
            setHojaFuente(false);
          }}
        />
      )}

      {tipo === "gasto" && (
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Categoría">
          {selector.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={categoriaId === c.id}
              onClick={() => setCategoriaId(c.id)}
              className={`min-h-[84px] rounded-2xl border-2 flex flex-col items-center justify-center gap-1 ${
                categoriaId === c.id ? "border-arca bg-arca-claro" : "border-stone-200 bg-white"
              } ${c.activa ? "" : "opacity-60"}`}
            >
              <span className="text-3xl" aria-hidden>{iconoDe(c.icono)}</span>
              <span className="text-sm font-medium">{c.nombre}{c.activa ? "" : " (desactivada)"}</span>
            </button>
          ))}
        </div>
      )}

      {tipo === "apoyo" && (
        <Campo etiqueta="Beneficiario (quién recibe)">
          <input
            className={claseInput}
            list="beneficiarios"
            value={beneficiario}
            onChange={(e) => setBeneficiario(e.target.value)}
            placeholder="Ej. Tía Rosa"
          />
          <datalist id="beneficiarios">
            {conocidos.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Campo>
      )}

      <div className="space-y-2">
        <Campo etiqueta="Fecha">
          <input className={claseInput} type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value || hoyISO())} />
        </Campo>
        {/* atajos: casi todo se registra de hoy o de ayer */}
        <div role="group" aria-label="Atajos de fecha" className="grid grid-cols-2 gap-2">
          {[
            { texto: "Hoy", valor: hoyISO() },
            { texto: "Ayer", valor: ayerISO() },
          ].map((a) => (
            <button
              key={a.texto}
              type="button"
              aria-pressed={fecha === a.valor}
              onClick={() => setFecha(a.valor)}
              className={`min-h-[44px] rounded-full border-[1.5px] text-sm font-semibold ${
                fecha === a.valor ? "bg-arca-claro border-arca text-arca" : "bg-white border-stone-300 text-stone-800 active:bg-stone-100"
              }`}
            >
              {a.texto}
            </button>
          ))}
        </div>
      </div>
      <Campo etiqueta="Nota (opcional)">
        <input className={claseInput} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} />
      </Campo>

      {esDueno && <SelectorVisibilidad valor={quien} alCambiar={setQuien} />}

      {/* el error aparece a la vista: al fallar una validacion la pantalla baja hasta el y lo enfoca */}
      <div ref={errorRef} tabIndex={-1} className="outline-none scroll-mt-4 scroll-mb-32">
        <ErrorCaja mensaje={error} />
      </div>
      {/* Guardar siempre a la vista, encima de la barra de navegacion (hereda el espacio al final para no tapar el contenido) */}
      <AccionFija>
        <Boton type="submit" variante={tipo === "apoyo" ? "apoyo" : "primario"} className="w-full text-lg" disabled={enviando}>
          {enviando ? "Guardando..." : editando ? "Guardar cambios" : "Guardar"}
        </Boton>
      </AccionFija>
    </form>
  );
}
