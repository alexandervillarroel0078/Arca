from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import limite
from app.core.config import settings
from app.core.deps import Contexto
from app.core.security import crear_token, hashear_clave, verificar_clave
from app.modulos.auth.models import Usuario
from app.modulos.auth.schemas import LoginIn, RegistroIn, TokenOut, YoOut
from app.modulos.bitacora import registro as bitacora
from app.modulos.categorias.service import crear_iniciales
from app.modulos.familia.models import Familia, Miembro
from app.modulos.historial import service as historial


def _yo(db: Session, usuario: Usuario, familia_id: int, rol: str, defecto: str = "familia") -> YoOut:
    familia = db.get(Familia, familia_id)
    return YoOut(
        id=usuario.id,
        nombre=usuario.nombre,
        email=usuario.email,
        familia_id=familia_id,
        familia_nombre=familia.nombre,
        rol=rol,
        dia_inicio_mes=familia.dia_inicio_mes,
        visibilidad_defecto=defecto,
    )


def yo_desde_contexto(db: Session, ctx: Contexto) -> YoOut:
    return _yo(db, ctx.usuario, ctx.familia_id, ctx.rol, ctx.visibilidad_defecto)


def registrar(db: Session, datos: RegistroIn) -> TokenOut:
    # Registro cerrado: solo se permite crear el PRIMER usuario (asi se arranca la instalacion y despues se cierra sola)
    if not settings.registro_esta_abierto and (db.scalar(select(func.count()).select_from(Usuario)) or 0) > 0:
        raise HTTPException(
            status_code=403,
            detail="El registro está cerrado. Pide al administrador de tu familia que cree tu cuenta.",
        )
    email = datos.email.lower()
    if db.scalar(select(Usuario.id).where(Usuario.email == email)):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese correo")
    usuario = Usuario(nombre=datos.nombre.strip(), email=email, password_hash=hashear_clave(datos.password))
    familia = Familia(nombre=(datos.nombre_familia or f"Familia de {datos.nombre.strip()}").strip())
    db.add_all([usuario, familia])
    db.flush()
    db.add(Miembro(usuario_id=usuario.id, familia_id=familia.id, rol="admin"))
    # historial (misma transaccion): nunca se guarda la clave, solo nombre y correo
    historial.registrar(
        db, familia.id, usuario.id, "usuario", usuario.id, "crear",
        historial.creacion({"nombre": usuario.nombre, "email": usuario.email}), "Registro",
    )
    historial.registrar(
        db, familia.id, usuario.id, "miembro", usuario.id, "crear",
        historial.creacion({"rol": "admin", "activo": True}), "Registro: crea la familia",
    )
    crear_iniciales(db, familia.id, usuario.id)
    bitacora.en_transaccion(db, "registro", familia_id=familia.id, usuario_id=usuario.id)
    db.commit()
    return TokenOut(access_token=crear_token(usuario.id), usuario=_yo(db, usuario, familia.id, "admin"))


def _quien(db: Session, email: str) -> tuple[Usuario | None, Miembro | None]:
    usuario = db.scalar(select(Usuario).where(Usuario.email == email))
    miembro = db.scalar(select(Miembro).where(Miembro.usuario_id == usuario.id)) if usuario else None
    return usuario, miembro


def ingresar(db: Session, datos: LoginIn, ip: str = "desconocida") -> TokenOut:
    email = datos.email.lower()
    origen = db.info.get("origen")
    espera = limite.segundos_de_espera(ip, datos.email)
    if espera:
        # como mucho un registro por minuto, IP y correo (un ataque insistente no llena la bitacora)
        if bitacora.permitir_cada(("login_bloqueado", ip, email)):
            u, m = _quien(db, email)
            bitacora.aparte(
                db, "login_bloqueado", familia_id=m.familia_id if m else None, usuario_id=u.id if u else None,
                correo=email, detalle={"espera_segundos": espera},
            )
        minutos = -(-espera // 60)
        raise HTTPException(
            status_code=429,
            detail=f"Demasiados intentos fallidos. Espera {minutos} minuto{'s' if minutos != 1 else ''} e intenta de nuevo.",
            headers={"Retry-After": str(espera)},
        )
    usuario, miembro = _quien(db, email)
    if usuario is None or not verificar_clave(datos.password, usuario.password_hash):
        limite.registrar_fallo(ip, datos.email)
        bitacora.aparte(
            db, "login_fallido", familia_id=miembro.familia_id if miembro else None,
            usuario_id=usuario.id if usuario else None, correo=email,
            detalle={"motivo": "usuario_inexistente" if usuario is None else "clave_incorrecta"},
        )
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")
    limite.limpiar(ip, datos.email)
    if origen:
        origen.usuario_id, origen.familia_id = usuario.id, (miembro.familia_id if miembro else None)
    if miembro is None:
        raise HTTPException(status_code=403, detail="El usuario no pertenece a ninguna familia")
    if not miembro.activo:
        if origen:
            origen.registrado = True  # ya queda escrito aqui; el manejador de errores no lo repite
        bitacora.aparte(
            db, "acceso_denegado", familia_id=miembro.familia_id, usuario_id=usuario.id, correo=email,
            detalle={"motivo": "usuario_desactivado", "ruta": "/api/auth/login", "metodo": "POST", "status": 403},
        )
        raise HTTPException(
            status_code=403, detail="Tu cuenta está desactivada. Habla con el administrador de tu familia"
        )
    bitacora.aparte(
        db, "login_ok", resultado="ok", familia_id=miembro.familia_id, usuario_id=usuario.id, correo=email
    )
    return TokenOut(
        access_token=crear_token(usuario.id), usuario=_yo(db, usuario, miembro.familia_id, miembro.rol, miembro.visibilidad_defecto)
    )


def salir(db: Session, ctx: Contexto) -> None:
    """Cerrar sesion deja constancia en la bitacora. El token no se revoca (JWT sin estado: vence solo)."""
    bitacora.aparte(db, "logout", resultado="ok", familia_id=ctx.familia_id, usuario_id=ctx.usuario.id)


def cambiar_clave(db: Session, ctx: Contexto, datos) -> None:
    if not verificar_clave(datos.clave_actual, ctx.usuario.password_hash):
        bitacora.aparte(db, "cambio_clave_fallido", familia_id=ctx.familia_id, usuario_id=ctx.usuario.id)
        raise HTTPException(status_code=400, detail="La clave actual no es correcta")
    ctx.usuario.password_hash = hashear_clave(datos.clave_nueva)
    historial.registrar(
        db, ctx.familia_id, ctx.usuario.id, "usuario", ctx.usuario.id, "cambiar_clave", historial.solo_clave_cambiada()
    )
    bitacora.en_transaccion(db, "cambio_clave_ok", familia_id=ctx.familia_id, usuario_id=ctx.usuario.id)
    db.commit()


def editar_perfil(db: Session, ctx: Contexto, nombre: str) -> YoOut:
    antes = {"nombre": ctx.usuario.nombre}
    ctx.usuario.nombre = nombre.strip()
    dif = historial.diferencias(antes, {"nombre": ctx.usuario.nombre})
    if dif:
        historial.registrar(db, ctx.familia_id, ctx.usuario.id, "usuario", ctx.usuario.id, "editar", dif)
    db.commit()
    return yo_desde_contexto(db, ctx)
