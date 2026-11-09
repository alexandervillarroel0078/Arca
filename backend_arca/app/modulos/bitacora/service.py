"""Lectura de la bitacora unificada: mezcla `bitacora` (accesos y seguridad) con `historial` (cambios de datos).

Nada se copia entre tablas: cada pagina pide a CADA tabla un tope de filas, las mezcla en orden y devuelve las primeras.
El orden es (fecha, origen, id) descendente y el cursor lleva esos tres valores, asi la paginacion es estable (sin
repetidos ni saltos aunque haya filas con la misma fecha). Se ordena por la fecha del SERVIDOR (la de registro), que solo
crece: lo nuevo siempre aparece arriba y nunca "detras" de la pagina que ya se vio. La fecha REAL de una accion hecha sin
internet se muestra aparte.
"""
import base64
import csv
import io
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.anulable import nombres_usuarios
from app.core.deps import Contexto
from app.modulos.apoyos.models import Apoyo, Devolucion
from app.modulos.auth.models import Usuario
from app.modulos.bitacora.models import Bitacora
from app.modulos.bitacora.schemas import (
    BitacoraItem, BitacoraPagina, FalloUsuario, NovedadAcceso, ResumenBitacora, UltimoAcceso,
)
from app.modulos.categorias.models import Categoria
from app.modulos.familia.models import Miembro
from app.modulos.historial.models import Historial
from app.modulos.movimientos.models import Movimiento
from app.modulos.visibilidad import service as vis

UTC = timezone.utc
RANGO = {"acceso": 0, "datos": 1}  # desempate entre tablas cuando la fecha es igual
TOPE_CSV = 5000
UMBRAL_SIN_INTERNET = timedelta(seconds=60)

# ------------------------------------------------------------------ textos
ETIQUETA_ACCESO = {
    "login_ok": "Entrada", "login_fallido": "Entrada fallida", "login_bloqueado": "Entrada bloqueada",
    "logout": "Salida", "registro": "Registro", "cambio_clave_ok": "Clave cambiada",
    "cambio_clave_fallido": "Cambio de clave fallido", "restablecer_clave": "Clave restablecida",
    "usuario_desactivado": "Usuario desactivado", "usuario_reactivado": "Usuario reactivado", "cambio_rol": "Cambio de rol",
    "acceso_denegado": "Acceso denegado", "token_invalido": "Sesion invalida", "sincronizacion_rechazada": "Sincronizacion rechazada",
}
ETIQUETA_DATOS = {
    "crear": "Creado", "editar": "Editado", "anular": "Anulado", "reactivar": "Reactivado", "consumir": "Consumido",
    "reabrir": "Reabierto", "cambiar_rol": "Cambio de rol", "desactivar": "Desactivado",
    "restablecer_clave": "Clave restablecida", "cambiar_clave": "Clave cambiada", "cambiar_visibilidad": "Visibilidad",
}
VERBO = {
    "crear": "Creo", "editar": "Edito", "anular": "Anulo", "reactivar": "Reactivo", "consumir": "Marco como consumido",
    "reabrir": "Reabrio", "desactivar": "Desactivo", "cambiar_rol": "Cambio el rol de",
    "restablecer_clave": "Restablecio la clave de", "cambiar_visibilidad": "Cambio quien puede ver",
}
NOMBRE_VISIBILIDAD = {"solo_yo": "Solo yo", "familia": "Familia", "elegidas": "Personas elegidas"}
CAMPOS = {
    "monto": "Monto", "fecha": "Fecha", "categoria": "Categoria", "nota": "Nota", "tipo": "Tipo",
    "beneficiario": "Beneficiario", "monto_consumido": "Consumido", "nombre": "Nombre", "email": "Correo",
    "dia_inicio_mes": "Dia de inicio del mes", "visibilidad": "Quien lo ve", "compartido_con": "Compartido con", "rol": "Rol", "activo": "Activo", "activa": "Activa", "icono": "Icono", "anulado": "Anulado", "clave": "Clave",
}
CAMPOS_DINERO = {"monto", "monto_consumido"}


def _valor(campo: str, v: Any) -> str:
    if v is None or v == "":
        return "(vacio)"
    if isinstance(v, bool):
        return "si" if v else "no"
    if isinstance(v, list):
        return ", ".join(str(x) for x in v) or "(nadie)"
    if campo == "visibilidad":
        return NOMBRE_VISIBILIDAD.get(v, str(v))
    if campo in CAMPOS_DINERO:
        return f"Bs {v}"
    return str(v)


def lineas_de_cambios(accion: str, cambios: dict, entidad: str = "") -> list[str]:
    """'Monto: Bs 45.00 -> Bs 60.00'. En una creacion solo el valor nuevo. 'anulado' ya lo dice el titulo.

    Al crear una categoria, un miembro o un usuario el titulo ya dice todo (solo se agrega el correo): sin ruido."""
    out = []
    for campo, c in (cambios or {}).items():
        if campo == "anulado":
            continue
        if accion == "crear" and entidad in ("categoria", "miembro", "usuario") and campo != "email":
            continue
        etiqueta = CAMPOS.get(campo, campo)
        if not isinstance(c, dict) or ("antes" not in c and "despues" not in c):
            out.append(f"{etiqueta}: {c}")  # p. ej. {"clave": "clave cambiada"}
        elif c.get("antes") is None:
            out.append(f"{etiqueta}: {_valor(campo, c.get('despues'))}")
        else:
            out.append(f"{etiqueta}: {_valor(campo, c.get('antes'))} -> {_valor(campo, c.get('despues'))}")
    return out


def _titulo_datos(accion: str, entidad: str, descr: str) -> str:
    if entidad == "usuario":
        if accion == "crear":
            return f"Creo la cuenta de {descr}"
        if accion == "cambiar_clave":
            return f"{descr} cambio su clave"
        return f"Edito el perfil de {descr}"
    if entidad == "miembro":
        if accion == "crear":
            return f"Agrego a {descr} a la familia"
        if accion in ("desactivar", "reactivar"):
            return f"{VERBO.get(accion, 'Reactivo')} a {descr}"
        return f"{VERBO.get(accion, accion)} {descr}"
    return f"{VERBO.get(accion, accion.replace('_', ' ').capitalize())} {descr}".strip()


def _titulo_acceso(f: Bitacora, persona: str) -> str:
    d = f.detalle or {}
    objetivo = d.get("objetivo") or "otra persona"
    correo = f.correo_intentado or "un correo"
    match f.evento:
        case "login_ok":
            return f"{persona} inicio sesion"
        case "login_fallido":
            motivo = "el correo no existe" if d.get("motivo") == "usuario_inexistente" else "clave incorrecta"
            return f"Intento fallido de entrada con {correo} ({motivo})"
        case "login_bloqueado":
            return f"Entrada bloqueada por demasiados intentos con {correo}"
        case "logout":
            return f"{persona} cerro sesion"
        case "registro":
            return f"{persona} creo su cuenta y su familia"
        case "cambio_clave_ok":
            return f"{persona} cambio su clave"
        case "cambio_clave_fallido":
            return f"{persona} puso mal su clave actual al intentar cambiarla"
        case "restablecer_clave":
            return f"{persona} restablecio la clave de {objetivo}"
        case "usuario_desactivado":
            return f"{persona} desactivo a {objetivo}"
        case "usuario_reactivado":
            return f"{persona} reactivo a {objetivo}"
        case "cambio_rol":
            return f"{persona} cambio el rol de {objetivo}: {d.get('rol_antes')} -> {d.get('rol_despues')}"
        case "acceso_denegado":
            motivo = "usuario desactivado" if d.get("motivo") == "usuario_desactivado" else "sin permisos"
            return f"Acceso denegado a {persona} ({motivo})" if f.usuario_id else f"Acceso denegado ({motivo})"
        case "token_invalido":
            return "Sesion invalida o vencida"
        case "sincronizacion_rechazada":
            return f"Cambio de {persona} rechazado al sincronizar" if f.usuario_id else "Cambio rechazado al sincronizar"
    return f.evento


def _lineas_acceso(f: Bitacora) -> list[str]:
    d = f.detalle or {}
    out = []
    if f.evento in ("acceso_denegado", "sincronizacion_rechazada", "token_invalido") and d.get("ruta"):
        out.append(f"{d.get('metodo', '')} {d['ruta']}".strip())
    if d.get("motivo") and f.evento in ("sincronizacion_rechazada", "acceso_denegado"):  # (en login_fallido ya va en el titulo)
        out.append(f"Motivo: {str(d['motivo']).replace('_', ' ')}")
    if d.get("status"):
        out.append(f"Codigo: {d['status']}")
    if d.get("espera_segundos"):
        out.append(f"Espera: {d['espera_segundos']} s")
    return out


# ------------------------------------------------------------------ filtros y cursor
@dataclass
class Filtros:
    origen: str | None = None
    evento: str | None = None
    resultado: str | None = None
    persona: int | None = None
    desde: datetime | None = None
    hasta: datetime | None = None  # exclusivo
    ip: str | None = None


def parsear_fecha(texto: str | None, fin: bool = False) -> datetime | None:
    """'2026-11-08' (dia completo, UTC) o fecha-hora ISO. `hasta` con solo el dia incluye ese dia entero."""
    if not texto:
        return None
    try:
        if len(texto) == 10:
            dt = datetime.fromisoformat(texto).replace(tzinfo=UTC)
            return dt + timedelta(days=1) if fin else dt
        dt = datetime.fromisoformat(texto.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt + timedelta(microseconds=1) if fin else dt
    except ValueError:
        raise HTTPException(status_code=422, detail="Fecha invalida: usa AAAA-MM-DD o una fecha-hora ISO")


def codificar_cursor(fecha: datetime, rango: int, id_: int) -> str:
    return base64.urlsafe_b64encode(f"{fecha.isoformat()}|{rango}|{id_}".encode()).decode()


def decodificar_cursor(cursor: str | None) -> tuple[datetime, int, int] | None:
    if not cursor:
        return None
    try:
        f, r, i = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(f), int(r), int(i)
    except Exception:
        raise HTTPException(status_code=422, detail="Cursor invalido")


def _despues_del_cursor(col_fecha, col_id, rango: int, cur):
    """Filas que van DESPUES del cursor en el orden (fecha, rango, id) descendente."""
    f, r, i = cur
    if rango < r:
        return or_(col_fecha < f, col_fecha == f)
    if rango == r:
        return or_(col_fecha < f, and_(col_fecha == f, col_id < i))
    return col_fecha < f


def _q_acceso(familia_id: int, f: Filtros, cur):
    correos = (
        select(func.lower(Usuario.email)).join(Miembro, Miembro.usuario_id == Usuario.id)
        .where(Miembro.familia_id == familia_id)
    )
    # Sin familia (p. ej. login fallido de un correo desconocido): solo si el correo intentado es de alguien de la familia
    q = select(Bitacora).where(
        or_(Bitacora.familia_id == familia_id, and_(Bitacora.familia_id.is_(None), Bitacora.correo_intentado.in_(correos)))
    )
    if f.evento:
        q = q.where(Bitacora.evento == f.evento)
    if f.resultado:
        q = q.where(Bitacora.resultado == f.resultado)
    if f.persona:
        correo_persona = select(func.lower(Usuario.email)).where(Usuario.id == f.persona).scalar_subquery()
        q = q.where(or_(Bitacora.usuario_id == f.persona, Bitacora.correo_intentado == correo_persona))
    if f.desde:
        q = q.where(Bitacora.fecha >= f.desde)
    if f.hasta:
        q = q.where(Bitacora.fecha < f.hasta)
    if f.ip:
        q = q.where(Bitacora.ip == f.ip)
    if cur:
        q = q.where(_despues_del_cursor(Bitacora.fecha, Bitacora.id, RANGO["acceso"], cur))
    return q


def _q_datos(ctx: Contexto, f: Filtros, cur):
    # Fase 17: tambien el admin ve solo las entradas de registros que puede ver (con su visibilidad ACTUAL)
    q = select(Historial).where(vis.condicion_historial(ctx))
    if f.evento:
        q = q.where(Historial.accion == f.evento)
    if f.persona:
        q = q.where(Historial.usuario_id == f.persona)
    if f.desde:
        q = q.where(Historial.fecha >= f.desde)
    if f.hasta:
        q = q.where(Historial.fecha < f.hasta)
    if cur:
        q = q.where(_despues_del_cursor(Historial.fecha, Historial.id, RANGO["datos"], cur))
    return q


# ------------------------------------------------------------------ descripcion legible de los registros
def _descripciones(db: Session, filas: list[Historial]) -> dict[tuple[str, int], str]:
    """'gasto Transporte Bs 50.00', 'apoyo a Tia Rosa Bs 100.00', ... segun el estado actual del registro."""
    ids: dict[str, set[int]] = {}
    for h in filas:
        ids.setdefault(h.entidad, set()).add(h.entidad_id)
    out: dict[tuple[str, int], str] = {}
    if ids.get("movimiento"):
        cats: dict[int, str] = {}
        for m in db.scalars(select(Movimiento).where(Movimiento.id.in_(ids["movimiento"]))):
            if m.categoria_id and m.categoria_id not in cats:
                c = db.get(Categoria, m.categoria_id)
                cats[m.categoria_id] = c.nombre if c else ""
            nombre = cats.get(m.categoria_id) or (m.nota or "").strip()
            out[("movimiento", m.id)] = " ".join(x for x in (m.tipo, nombre, f"Bs {m.monto:.2f}") if x)
    if ids.get("apoyo"):
        for a in db.scalars(select(Apoyo).where(Apoyo.id.in_(ids["apoyo"]))):
            out[("apoyo", a.id)] = f"apoyo a {a.beneficiario} Bs {a.monto:.2f}"
    if ids.get("devolucion"):
        for d, a in db.execute(
            select(Devolucion, Apoyo).join(Apoyo, Apoyo.id == Devolucion.apoyo_id).where(Devolucion.id.in_(ids["devolucion"]))
        ).all():
            out[("devolucion", d.id)] = f"devolucion de {a.beneficiario} Bs {d.monto:.2f}"
    if ids.get("categoria"):
        for c in db.scalars(select(Categoria).where(Categoria.id.in_(ids["categoria"]))):
            out[("categoria", c.id)] = f"categoria {c.nombre}"
    if ids.get("familia"):
        out.update({("familia", i): "los periodos de la familia" for i in ids["familia"]})
    personas = ids.get("miembro", set()) | ids.get("usuario", set())
    if personas:
        nombres = nombres_usuarios(db, personas)
        for e in ("miembro", "usuario"):
            for i in ids.get(e, set()):
                out[(e, i)] = nombres.get(i, "")
    return out


# ------------------------------------------------------------------ armado de items
def _armar(db: Session, filas: list[tuple[str, Any]]) -> list[BitacoraItem]:
    nombres = nombres_usuarios(db, {f.usuario_id for _, f in filas})
    descr = _descripciones(db, [f for o, f in filas if o == "datos"])
    items = []
    for origen, f in filas:
        if origen == "acceso":
            persona = nombres.get(f.usuario_id) or f.correo_intentado or "Alguien"
            items.append(BitacoraItem(
                clave=f"acceso-{f.id}", origen="acceso", evento=f.evento,
                etiqueta=ETIQUETA_ACCESO.get(f.evento, f.evento), titulo=_titulo_acceso(f, persona),
                resultado=f.resultado, fecha=f.fecha, fecha_real=f.fecha, usuario_id=f.usuario_id,
                usuario_nombre=nombres.get(f.usuario_id), correo_intentado=f.correo_intentado, ip=f.ip,
                dispositivo=f.dispositivo, detalle=_lineas_acceso(f),
            ))
            continue
        real, sync = f.fecha, None
        if f.fecha_cliente and abs(f.fecha - f.fecha_cliente) > UMBRAL_SIN_INTERNET:
            real, sync = f.fecha_cliente, f.fecha  # se hizo sin internet: fecha real aparte de la de sincronizacion
        d = descr.get((f.entidad, f.entidad_id)) or f"{f.entidad} #{f.entidad_id}"
        if f.entidad == "usuario" and f.accion == "cambiar_clave":
            d = nombres.get(f.usuario_id) or d
        items.append(BitacoraItem(
            clave=f"datos-{f.id}", origen="datos", evento=f.accion,
            etiqueta=ETIQUETA_DATOS.get(f.accion, f.accion), titulo=_titulo_datos(f.accion, f.entidad, d),
            resultado="ok", fecha=f.fecha, fecha_real=real, fecha_sincronizacion=sync, usuario_id=f.usuario_id,
            usuario_nombre=nombres.get(f.usuario_id), detalle=lineas_de_cambios(f.accion, f.cambios or {}, f.entidad),
            motivo=f.motivo, entidad=f.entidad, entidad_id=f.entidad_id,
        ))
    return items


def listar(db: Session, ctx: Contexto, f: Filtros, cursor: str | None, limite: int) -> BitacoraPagina:
    cur = decodificar_cursor(cursor)
    candidatos: list[tuple[datetime, int, int, str, Any]] = []
    if f.origen in (None, "acceso"):
        q = _q_acceso(ctx.familia_id, f, cur).order_by(Bitacora.fecha.desc(), Bitacora.id.desc()).limit(limite + 1)
        candidatos += [(x.fecha, RANGO["acceso"], x.id, "acceso", x) for x in db.scalars(q)]
    if f.origen in (None, "datos") and not f.ip and f.resultado in (None, "ok"):
        q = _q_datos(ctx, f, cur).order_by(Historial.fecha.desc(), Historial.id.desc()).limit(limite + 1)
        candidatos += [(x.fecha, RANGO["datos"], x.id, "datos", x) for x in db.scalars(q)]
    candidatos.sort(key=lambda t: (t[0], t[1], t[2]), reverse=True)
    pagina = candidatos[:limite]
    hay_mas = len(candidatos) > limite
    items = _armar(db, [(c[3], c[4]) for c in pagina])
    siguiente = codificar_cursor(pagina[-1][0], pagina[-1][1], pagina[-1][2]) if hay_mas and pagina else None
    return BitacoraPagina(items=items, hay_mas=hay_mas, siguiente=siguiente)


# ------------------------------------------------------------------ CSV
def _celda(v: Any) -> str:
    """Evita la inyeccion de formulas: si empieza con = + - @ (o tab/retorno) se antepone una comilla simple."""
    s = "" if v is None else str(v)
    return "'" + s if s and s[0] in "=+-@\t\r" else s


COLUMNAS_CSV = [
    "origen", "fecha_registro_utc", "fecha_real_utc", "evento", "descripcion", "resultado", "persona",
    "correo_intentado", "ip", "dispositivo", "detalle", "motivo",
]


def exportar_csv(db: Session, ctx: Contexto, f: Filtros) -> tuple[str, bool]:
    """Devuelve (texto CSV, truncado). Tope de 5000 filas."""
    pagina = listar(db, ctx, f, None, TOPE_CSV)
    salida = io.StringIO()
    w = csv.writer(salida, lineterminator="\r\n")
    w.writerow(COLUMNAS_CSV)
    for i in pagina.items:
        w.writerow([_celda(x) for x in (
            i.origen, i.fecha.astimezone(UTC).isoformat(), i.fecha_real.astimezone(UTC).isoformat(), i.evento, i.titulo,
            i.resultado, i.usuario_nombre, i.correo_intentado, i.ip, i.dispositivo, " | ".join(i.detalle), i.motivo,
        )])
    return salida.getvalue(), pagina.hay_mas


# ------------------------------------------------------------------ resumen
def resumen(db: Session, ctx: Contexto) -> ResumenBitacora:
    F = ctx.familia_id
    hace_7 = datetime.now(UTC) - timedelta(days=7)
    miembros = db.execute(
        select(Usuario, Miembro).join(Miembro, Miembro.usuario_id == Usuario.id)
        .where(Miembro.familia_id == F).order_by(Miembro.id)
    ).all()
    por_id = {u.id: (u, m) for u, m in miembros}

    ultimos = []
    for u, m in miembros:
        fila = db.execute(
            select(Bitacora.fecha, Bitacora.ip, Bitacora.dispositivo)
            .where(Bitacora.familia_id == F, Bitacora.usuario_id == u.id, Bitacora.evento == "login_ok")
            .order_by(Bitacora.fecha.desc(), Bitacora.id.desc()).limit(1)
        ).first()
        ultimos.append(UltimoAcceso(
            usuario_id=u.id, nombre=u.nombre, rol=m.rol, activo=m.activo,
            ultimo_login=fila[0] if fila else None, ip=fila[1] if fila else None, dispositivo=fila[2] if fila else None,
        ))

    correos = [u.email.lower() for u, _ in miembros]
    visible = or_(Bitacora.familia_id == F, and_(Bitacora.familia_id.is_(None), Bitacora.correo_intentado.in_(correos)))
    cuenta = {
        e: n for e, n in db.execute(
            select(Bitacora.evento, func.count()).where(
                visible, Bitacora.fecha >= hace_7, Bitacora.evento.in_(("login_fallido", "login_bloqueado"))
            ).group_by(Bitacora.evento)
        ).all()
    }
    por_usuario = [
        FalloUsuario(usuario_id=uid, nombre=por_id[uid][0].nombre, fallos=n)
        for uid, n in db.execute(
            select(Bitacora.usuario_id, func.count()).where(
                Bitacora.familia_id == F, Bitacora.fecha >= hace_7, Bitacora.evento == "login_fallido",
                Bitacora.usuario_id.isnot(None),
            ).group_by(Bitacora.usuario_id).order_by(func.count().desc())
        ).all()
        if uid in por_id
    ]

    # IP y dispositivos nuevos: valores que un usuario uso por PRIMERA vez en los ultimos 7 dias, teniendo ya entradas
    # anteriores (su primer ingreso no cuenta: todo seria "nuevo").
    primera = {
        uid: p for uid, p in db.execute(
            select(Bitacora.usuario_id, func.min(Bitacora.fecha))
            .where(Bitacora.familia_id == F, Bitacora.evento == "login_ok").group_by(Bitacora.usuario_id)
        ).all()
    }
    novedades: list[NovedadAcceso] = []
    for tipo, col in (("ip", Bitacora.ip), ("dispositivo", Bitacora.dispositivo)):
        for uid, valor, desde in db.execute(
            select(Bitacora.usuario_id, col, func.min(Bitacora.fecha))
            .where(Bitacora.familia_id == F, Bitacora.evento == "login_ok", col.isnot(None))
            .group_by(Bitacora.usuario_id, col)
        ).all():
            if uid in por_id and desde >= hace_7 and primera.get(uid) is not None and primera[uid] < desde:
                novedades.append(NovedadAcceso(
                    usuario_id=uid, nombre=por_id[uid][0].nombre, tipo=tipo, valor=valor, primera_vez=desde
                ))
    novedades.sort(key=lambda n: n.primera_vez, reverse=True)

    return ResumenBitacora(
        ultimos_accesos=ultimos,
        fallos_login_7d=cuenta.get("login_fallido", 0),
        bloqueos_login_7d=cuenta.get("login_bloqueado", 0),
        fallos_por_usuario=por_usuario,
        novedades=novedades,
    )
