from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.anulable import (
    auditoria,
    exigir_activo,
    exigir_dueno_o_admin,
    exigir_version,
    limpiar_anulacion,
    marcar_anulacion,
    marcar_edicion,
    nombres_usuarios,
)
from app.core.deps import Contexto
from datetime import date

from app.core.tipos import rango_filtro
from app.modulos.categorias.models import Categoria
from app.modulos.categorias.service import obtener_de_familia
from app.modulos.historial import service as historial
from app.modulos.movimientos.models import Movimiento
from app.modulos.visibilidad import cambios as visib
from app.modulos.visibilidad import service as vis
from app.modulos.movimientos.schemas import MovimientoCrear, MovimientoEditar, MovimientoOut


def _datos(db: Session, m: Movimiento) -> dict:
    """Foto de los campos editables (la categoria por nombre, para que el historial se entienda solo)."""
    cat = db.get(Categoria, m.categoria_id) if m.categoria_id else None
    return {"tipo": m.tipo, "monto": m.monto, "fecha": m.fecha, "categoria": cat.nombre if cat else None, "nota": m.nota}


def armar(db: Session, movs: list[Movimiento], ctx: Contexto) -> list[MovimientoOut]:
    """Convierte movimientos en su salida, cargando nombres y categorias en bloque."""
    propios = [m.id for m in movs if m.usuario_id == ctx.usuario.id and m.visibilidad == "elegidas"]
    personas = vis.compartidos_de(db, "movimiento", propios)
    nombres = nombres_usuarios(
        db, {m.usuario_id for m in movs} | {m.anulado_por for m in movs} | {m.editado_por for m in movs}
    )
    cat_ids = {m.categoria_id for m in movs if m.categoria_id}
    cats = {c.id: c for c in db.scalars(select(Categoria).where(Categoria.id.in_(cat_ids)))} if cat_ids else {}
    salida = []
    for m in movs:
        c = cats.get(m.categoria_id) if m.categoria_id else None
        salida.append(
            MovimientoOut(
                id=m.id,
                tipo=m.tipo,
                monto=m.monto,
                fecha=m.fecha,
                categoria_id=m.categoria_id,
                categoria_nombre=c.nombre if c else None,
                categoria_icono=c.icono if c else None,
                nota=m.nota,
                usuario_id=m.usuario_id,
                usuario_nombre=nombres.get(m.usuario_id, ""),
                visibilidad=m.visibilidad,
                compartido_con=personas.get(m.id, []),
                **auditoria(m, nombres),
            )
        )
    return salida


def consulta_filtrada(
    ctx: Contexto,
    mes: str | None,
    usuario_id: int | None,
    tipo: str | None,
    categoria_id: int | None,
    ver_anulados: bool,
    desde: date | None = None,
    hasta: date | None = None,
):
    consulta = vis.filtrar(select(Movimiento), ctx, Movimiento)  # Fase 17: solo lo que este usuario puede ver
    if not ver_anulados:
        consulta = consulta.where(Movimiento.anulado.is_(False))
    inicio, fin = rango_filtro(mes, desde, hasta)
    if inicio is not None:
        consulta = consulta.where(Movimiento.fecha >= inicio)
    if fin is not None:
        consulta = consulta.where(Movimiento.fecha < fin)
    if usuario_id:
        consulta = consulta.where(Movimiento.usuario_id == usuario_id)
    if tipo:
        consulta = consulta.where(Movimiento.tipo == tipo)
    if categoria_id:
        consulta = consulta.where(Movimiento.categoria_id == categoria_id)
    return consulta


def listar(
    db: Session,
    ctx: Contexto,
    mes: str | None,
    usuario_id: int | None,
    tipo: str | None,
    categoria_id: int | None,
    ver_anulados: bool = False,
    limite: int = 200,
    desplazamiento: int = 0,
    desde: date | None = None,
    hasta: date | None = None,
) -> list[MovimientoOut]:
    consulta = (
        consulta_filtrada(ctx, mes, usuario_id, tipo, categoria_id, ver_anulados, desde, hasta)
        .order_by(Movimiento.fecha.desc(), Movimiento.id.desc())
        .limit(limite)
        .offset(desplazamiento)
    )
    return armar(db, list(db.scalars(consulta)), ctx)


def _obtener(db: Session, ctx: Contexto, movimiento_id: int, bloquear: bool = False) -> Movimiento:
    # bloquear = SELECT ... FOR UPDATE: dos cambios simultaneos del mismo registro se atienden uno tras otro
    m = db.get(Movimiento, movimiento_id, with_for_update=bloquear or None)
    # lo que no puedes ver (otra familia, privado de otro, inexistente) responde igual: 404 con el mismo cuerpo
    vis.exigir_ver(db, ctx, m, "Movimiento")
    return m


def obtener(db: Session, ctx: Contexto, movimiento_id: int) -> MovimientoOut:
    return armar(db, [_obtener(db, ctx, movimiento_id)], ctx)[0]


def crear(db: Session, ctx: Contexto, datos: MovimientoCrear) -> tuple[MovimientoOut, bool]:
    """Devuelve (movimiento, creado). Si el UUID ya existe, devuelve el existente sin tocarlo."""
    uuid_txt = str(datos.uuid_cliente) if datos.uuid_cliente else None
    if uuid_txt:
        previo = db.scalar(
            select(Movimiento).where(Movimiento.familia_id == ctx.familia_id, Movimiento.uuid_cliente == uuid_txt)
        )
        if previo is not None:
            if not vis.puede_ver(db, ctx, previo):  # UUID ya usado por otra persona: no se revela nada de ese registro
                raise HTTPException(status_code=409, detail="Ese identificador ya fue usado")
            return armar(db, [previo], ctx)[0], False  # aunque este anulado, NO se reactiva

    if datos.tipo == "gasto":
        if datos.categoria_id is None:
            raise HTTPException(status_code=422, detail="El gasto necesita una categoria")
        cat = obtener_de_familia(db, ctx.familia_id, datos.categoria_id)
        if not cat.activa:
            raise HTTPException(status_code=422, detail="La categoria esta desactivada")
    elif datos.categoria_id is not None:
        raise HTTPException(status_code=422, detail="El ingreso no lleva categoria")
    visibilidad, personas = visib.preparar_creacion(db, ctx, datos)
    m = Movimiento(
        visibilidad=visibilidad,
        familia_id=ctx.familia_id,
        usuario_id=ctx.usuario.id,
        tipo=datos.tipo,
        monto=datos.monto,
        fecha=datos.fecha,
        categoria_id=datos.categoria_id,
        nota=datos.nota,
        uuid_cliente=uuid_txt,
    )
    db.add(m)
    db.flush()
    visib.guardar_personas(db, ctx, "movimiento", m.id, personas)
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "movimiento", m.id, "crear", historial.creacion(_datos(db, m))
    )
    if datos.anulado:  # creado y anulado sin internet: llega como una sola operacion
        marcar_anulacion(m, ctx.usuario.id, datos.motivo_anulacion)
        historial.registrar(
            db, ctx.familia_id, ctx.usuario.id, "movimiento", m.id, "anular",
            {"anulado": historial.cambio(False, True)}, m.motivo_anulacion, datos.fecha_cliente_anulacion,
        )
    db.commit()
    return armar(db, [m], ctx)[0], True


def _obtener_modificable(db: Session, ctx: Contexto, movimiento_id: int) -> Movimiento:
    m = _obtener(db, ctx, movimiento_id, bloquear=True)
    vis.exigir_editar(ctx, m)  # (ya se comprobo que lo ves: aqui un 403 no revela nada)
    return m


def _ya_aplicada(db: Session, ctx: Contexto, m: Movimiento) -> bool:
    """Idempotencia por operacion: la misma operacion (mismo UUID) enviada dos veces tiene un solo efecto."""
    return historial.operacion_aplicada(db, ctx.familia_id, ctx.uuid_operacion, "movimiento", m.id)


def editar(db: Session, ctx: Contexto, movimiento_id: int, datos: MovimientoEditar) -> MovimientoOut:
    m = _obtener_modificable(db, ctx, movimiento_id)
    if _ya_aplicada(db, ctx, m):
        return armar(db, [m], ctx)[0]
    exigir_version(m, datos.version_base, lambda: armar(db, [m], ctx)[0], "El movimiento")
    cambios = datos.model_dump(exclude_unset=True, exclude={"visibilidad", "compartido_con", "version_base"})
    if cambios or not (datos.visibilidad or datos.compartido_con is not None):
        exigir_activo(m, "El movimiento")  # cambiar solo "quien lo ve" se permite tambien en un registro anulado
    antes = _datos(db, m)

    tipo = cambios.get("tipo") or m.tipo
    categoria_id = cambios["categoria_id"] if "categoria_id" in cambios else m.categoria_id
    if tipo == "ingreso":
        # al pasar a ingreso la categoria se limpia sola; pedirla explicitamente es un error
        if cambios.get("categoria_id") is not None:
            raise HTTPException(status_code=422, detail="El ingreso no lleva categoria")
        categoria_id = None
    else:
        if categoria_id is None:
            raise HTTPException(status_code=422, detail="El gasto necesita una categoria")
        cat = obtener_de_familia(db, ctx.familia_id, categoria_id)
        # se permite conservar una categoria desactivada (historial), pero no elegirla de nuevo
        if not cat.activa and categoria_id != m.categoria_id:
            raise HTTPException(status_code=422, detail="La categoria esta desactivada")

    m.tipo = tipo
    m.categoria_id = categoria_id
    if cambios.get("monto") is not None:
        m.monto = cambios["monto"]
    if cambios.get("fecha") is not None:
        m.fecha = cambios["fecha"]
    if "nota" in cambios:
        m.nota = cambios["nota"]
    diferencias = historial.diferencias(antes, _datos(db, m))
    cambio_vis = visib.aplicar(db, ctx, m, datos.visibilidad, datos.compartido_con)
    if diferencias or not cambio_vis:
        marcar_edicion(m, ctx.usuario.id)
        historial.registrar(db, ctx.familia_id, ctx.usuario.id, "movimiento", m.id, "editar", diferencias)
    db.commit()
    return armar(db, [m], ctx)[0]


def anular(
    db: Session, ctx: Contexto, movimiento_id: int, motivo: str | None, version_base: int | None = None
) -> MovimientoOut:
    m = _obtener_modificable(db, ctx, movimiento_id)
    if _ya_aplicada(db, ctx, m):
        return armar(db, [m], ctx)[0]
    exigir_version(m, version_base, lambda: armar(db, [m], ctx)[0], "El movimiento")
    if m.anulado:
        raise HTTPException(status_code=400, detail="El movimiento ya esta anulado")
    marcar_anulacion(m, ctx.usuario.id, motivo)
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "movimiento", m.id, "anular",
        {"anulado": historial.cambio(False, True)}, m.motivo_anulacion,
    )
    db.commit()
    return armar(db, [m], ctx)[0]


def reactivar(db: Session, ctx: Contexto, movimiento_id: int, version_base: int | None = None) -> MovimientoOut:
    m = _obtener_modificable(db, ctx, movimiento_id)
    if _ya_aplicada(db, ctx, m):
        return armar(db, [m], ctx)[0]
    exigir_version(m, version_base, lambda: armar(db, [m], ctx)[0], "El movimiento")
    if not m.anulado:
        raise HTTPException(status_code=400, detail="El movimiento no esta anulado")
    limpiar_anulacion(m)
    marcar_edicion(m, ctx.usuario.id)
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "movimiento", m.id, "reactivar", {"anulado": historial.cambio(True, False)}
    )
    db.commit()
    return armar(db, [m], ctx)[0]


def cambiar_visibilidad(db: Session, ctx: Contexto, movimiento_id: int, datos: visib.VisibilidadCambiar) -> MovimientoOut:
    """Solo el dueno cambia quien lo ve (no el admin: lo privado de otros ni siquiera lo ve)."""
    m = _obtener(db, ctx, movimiento_id, bloquear=True)
    if m.usuario_id != ctx.usuario.id:
        raise HTTPException(status_code=403, detail="Solo quien lo registro puede cambiar quien lo ve")
    if _ya_aplicada(db, ctx, m):
        return armar(db, [m], ctx)[0]
    exigir_version(m, datos.version_base, lambda: armar(db, [m], ctx)[0], "El movimiento")
    visib.aplicar(db, ctx, m, datos.visibilidad, datos.compartido_con)
    db.commit()
    return armar(db, [m], ctx)[0]
