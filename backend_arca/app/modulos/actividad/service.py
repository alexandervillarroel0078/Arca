"""Lista completa: mezcla movimientos y apoyos de la familia con filtros y paginacion."""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Contexto
from app.core.tipos import rango_filtro
from app.modulos.actividad.schemas import ActividadItem, ActividadPagina
from app.modulos.apoyos import service as apoyos
from app.modulos.apoyos.models import Apoyo
from app.modulos.movimientos import service as movimientos
from app.modulos.movimientos.models import Movimiento
from app.modulos.visibilidad import service as vis

CAMPOS_AUDITORIA = {
    "visibilidad", "compartido_con", "version", "uuid_cliente", "anulado", "anulado_por_nombre", "anulado_en", "motivo_anulacion", "editado_por_nombre", "editado_en",
}


def listar(
    db: Session,
    ctx: Contexto,
    mes: str | None,
    usuario_id: int | None,
    tipo: str | None,
    categoria_id: int | None,
    ver_anulados: bool,
    limite: int,
    desplazamiento: int,
    desde: date | None = None,
    hasta: date | None = None,
) -> ActividadPagina:
    tope = desplazamiento + limite
    candidatos: list[tuple] = []  # (fecha, creado_en, id, clase, objeto)
    total = 0

    if tipo in (None, "gasto", "ingreso"):
        q = movimientos.consulta_filtrada(ctx, mes, usuario_id, tipo, categoria_id, ver_anulados, desde, hasta)
        total += db.scalar(select(func.count()).select_from(q.subquery())) or 0
        for m in db.scalars(q.order_by(Movimiento.fecha.desc(), Movimiento.id.desc()).limit(tope)):
            candidatos.append((m.fecha, m.creado_en, m.id, "movimiento", m))

    if tipo in (None, "apoyo") and categoria_id is None:
        q = vis.filtrar(select(Apoyo), ctx, Apoyo)  # Fase 17: solo lo que este usuario puede ver
        if not ver_anulados:
            q = q.where(Apoyo.anulado.is_(False))
        inicio, fin = rango_filtro(mes, desde, hasta)
        if inicio is not None:
            q = q.where(Apoyo.fecha >= inicio)
        if fin is not None:
            q = q.where(Apoyo.fecha < fin)
        if usuario_id:
            q = q.where(Apoyo.usuario_id == usuario_id)
        total += db.scalar(select(func.count()).select_from(q.subquery())) or 0
        for a in db.scalars(q.order_by(Apoyo.fecha.desc(), Apoyo.id.desc()).limit(tope)):
            candidatos.append((a.fecha, a.creado_en, a.id, "apoyo", a))

    candidatos.sort(key=lambda c: (c[0], c[1], c[2]), reverse=True)
    pagina = candidatos[desplazamiento:tope]

    por_mov = {m.id: m for m in movimientos.armar(db, [c[4] for c in pagina if c[3] == "movimiento"], ctx)}
    por_apo = {a.id: a for a in apoyos._armar(db, [c[4] for c in pagina if c[3] == "apoyo"], ctx)}

    items: list[ActividadItem] = []
    for _fecha, _creado, id_, clase, _obj in pagina:
        if clase == "movimiento":
            m = por_mov[id_]
            items.append(
                ActividadItem(
                    clase="movimiento",
                    id=m.id,
                    tipo=m.tipo,  # type: ignore[arg-type]
                    titulo=(m.nota or "").strip() or m.categoria_nombre or "Ingreso",
                    monto=m.monto,
                    fecha=m.fecha,
                    nota=m.nota,
                    usuario_id=m.usuario_id,
                    usuario_nombre=m.usuario_nombre,
                    categoria_id=m.categoria_id,
                    categoria_nombre=m.categoria_nombre,
                    categoria_icono=m.categoria_icono,
                    **m.model_dump(include=CAMPOS_AUDITORIA),
                )
            )
        else:
            a = por_apo[id_]
            items.append(
                ActividadItem(
                    clase="apoyo",
                    id=a.id,
                    tipo="apoyo",
                    titulo=a.beneficiario,
                    monto=a.monto,
                    fecha=a.fecha,
                    nota=a.nota,
                    usuario_id=a.usuario_id,
                    usuario_nombre=a.usuario_nombre,
                    beneficiario=a.beneficiario,
                    estado=a.estado,
                    pendiente=a.pendiente,
                    devuelto=a.devuelto,
                    consumido=a.consumido,
                    devoluciones_activas=a.devoluciones_activas,
                    **a.model_dump(include=CAMPOS_AUDITORIA),
                )
            )
    return ActividadPagina(items=items, total=total, hay_mas=tope < total)
