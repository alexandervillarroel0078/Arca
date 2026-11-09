import secrets

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.core.deps import Ctx, CtxAdmin, DbSession
from app.core.security import hashear_clave
from app.modulos.auth.models import Usuario
from app.modulos.familia.models import Familia, Miembro
from app.modulos.bitacora import registro as bitacora
from app.modulos.historial import service as historial
from app.modulos.familia.schemas import ClaveTemporalOut, FamiliaEditar, FamiliaOut, InvitarIn, MiembroEditar, MiembroOut

router = APIRouter(prefix="/familia", tags=["familia"])


def _salida(u: Usuario, m: Miembro) -> MiembroOut:
    return MiembroOut(usuario_id=u.id, nombre=u.nombre, email=u.email, rol=m.rol, activo=m.activo)


def _miembro_de_familia(db, familia_id: int, usuario_id: int) -> tuple[Usuario, Miembro]:
    fila = db.execute(
        select(Usuario, Miembro)
        .join(Miembro, Miembro.usuario_id == Usuario.id)
        .where(Miembro.familia_id == familia_id, Usuario.id == usuario_id)
    ).first()
    if fila is None:
        raise HTTPException(status_code=404, detail="Miembro no encontrado")
    return fila


def _familia_out(f: Familia) -> FamiliaOut:
    return FamiliaOut(id=f.id, nombre=f.nombre, dia_inicio_mes=f.dia_inicio_mes)


@router.get("", response_model=FamiliaOut)
def obtener_familia(db: DbSession, ctx: Ctx):
    return _familia_out(db.get(Familia, ctx.familia_id))


@router.patch("", response_model=FamiliaOut)
def editar_familia(datos: FamiliaEditar, db: DbSession, ctx: CtxAdmin):
    """Solo el admin cambia el dia de inicio del mes. Es solo una VISTA: no mueve ni cierra ningun dato."""
    familia = db.get(Familia, ctx.familia_id)
    if datos.dia_inicio_mes != familia.dia_inicio_mes:
        historial.registrar(
            db, ctx.familia_id, ctx.usuario.id, "familia", familia.id, "editar",
            {"dia_inicio_mes": historial.cambio(familia.dia_inicio_mes, datos.dia_inicio_mes)},
        )
        familia.dia_inicio_mes = datos.dia_inicio_mes
        db.commit()
    return _familia_out(familia)


@router.get("/miembros", response_model=list[MiembroOut])
def miembros(db: DbSession, ctx: Ctx):
    filas = db.execute(
        select(Usuario, Miembro)
        .join(Miembro, Miembro.usuario_id == Usuario.id)
        .where(Miembro.familia_id == ctx.familia_id)
        .order_by(Miembro.id)
    ).all()
    return [_salida(u, m) for u, m in filas]


@router.post("/invitar", response_model=MiembroOut, status_code=201)
def invitar(datos: InvitarIn, db: DbSession, ctx: CtxAdmin):
    email = datos.email.lower()
    if db.scalar(select(Usuario.id).where(Usuario.email == email)):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese correo")
    usuario = Usuario(nombre=datos.nombre.strip(), email=email, password_hash=hashear_clave(datos.password))
    db.add(usuario)
    db.flush()
    miembro = Miembro(usuario_id=usuario.id, familia_id=ctx.familia_id, rol=datos.rol, activo=True)
    db.add(miembro)
    # historial (misma transaccion): sin la clave temporal
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "usuario", usuario.id, "crear",
        historial.creacion({"nombre": usuario.nombre, "email": usuario.email}), "Invitado por el administrador",
    )
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "miembro", usuario.id, "crear",
        historial.creacion({"rol": miembro.rol, "activo": True}),
    )
    db.commit()
    return _salida(usuario, miembro)


@router.patch("/miembros/{usuario_id}", response_model=MiembroOut)
def editar_miembro(usuario_id: int, datos: MiembroEditar, db: DbSession, ctx: CtxAdmin):
    """Cambiar rol, desactivar o reactivar. Nunca se borra al miembro."""
    usuario, miembro = _miembro_de_familia(db, ctx.familia_id, usuario_id)
    nuevo_rol = datos.rol if datos.rol is not None else miembro.rol
    nuevo_activo = datos.activo if datos.activo is not None else miembro.activo

    era_admin_activo = miembro.rol == "admin" and miembro.activo
    seguira_admin_activo = nuevo_rol == "admin" and nuevo_activo
    if era_admin_activo and not seguira_admin_activo:
        otros = db.scalar(
            select(func.count()).select_from(Miembro).where(
                Miembro.familia_id == ctx.familia_id,
                Miembro.rol == "admin",
                Miembro.activo.is_(True),
                Miembro.usuario_id != usuario_id,
            )
        )
        if not otros:
            raise HTTPException(
                status_code=400, detail="No puedes desactivar ni degradar al ultimo administrador"
            )
    if nuevo_rol != miembro.rol:
        historial.registrar(
            db, ctx.familia_id, ctx.usuario.id, "miembro", usuario_id, "cambiar_rol",
            {"rol": historial.cambio(miembro.rol, nuevo_rol)},
        )
    if nuevo_activo != miembro.activo:
        historial.registrar(
            db, ctx.familia_id, ctx.usuario.id, "miembro", usuario_id,
            "reactivar" if nuevo_activo else "desactivar", {"activo": historial.cambio(miembro.activo, nuevo_activo)},
        )
    # bitacora de seguridad (misma transaccion): solo quien, a quien y el rol; nunca datos de acceso
    objetivo = {"objetivo_id": usuario_id, "objetivo": usuario.nombre}
    if nuevo_rol != miembro.rol:
        bitacora.en_transaccion(
            db, "cambio_rol", familia_id=ctx.familia_id, usuario_id=ctx.usuario.id,
            detalle={**objetivo, "rol_antes": miembro.rol, "rol_despues": nuevo_rol},
        )
    if nuevo_activo != miembro.activo:
        bitacora.en_transaccion(
            db, "usuario_reactivado" if nuevo_activo else "usuario_desactivado",
            familia_id=ctx.familia_id, usuario_id=ctx.usuario.id, detalle=objetivo,
        )
    miembro.rol = nuevo_rol
    miembro.activo = nuevo_activo
    db.commit()
    return _salida(usuario, miembro)


@router.post("/miembros/{usuario_id}/restablecer-clave", response_model=ClaveTemporalOut)
def restablecer_clave(usuario_id: int, db: DbSession, ctx: CtxAdmin):
    """Genera una clave temporal nueva. Se muestra una sola vez; el miembro la cambia en su perfil."""
    usuario, _ = _miembro_de_familia(db, ctx.familia_id, usuario_id)
    temporal = secrets.token_urlsafe(6)
    usuario.password_hash = hashear_clave(temporal)
    # solo "clave cambiada": la temporal NO se guarda en ningun lado
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "miembro", usuario_id, "restablecer_clave", historial.solo_clave_cambiada()
    )
    bitacora.en_transaccion(
        db, "restablecer_clave", familia_id=ctx.familia_id, usuario_id=ctx.usuario.id,
        detalle={"objetivo_id": usuario_id, "objetivo": usuario.nombre},
    )
    db.commit()
    return ClaveTemporalOut(clave_temporal=temporal)
