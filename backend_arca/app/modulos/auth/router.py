from fastapi import APIRouter, Request, Response

from app.core.deps import Ctx, DbSession
from app.modulos.auth import service
from app.modulos.auth.schemas import CambiarClaveIn, LoginIn, PerfilIn, RegistroIn, TokenOut, YoOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/registro", response_model=TokenOut, status_code=201)
def registro(datos: RegistroIn, db: DbSession):
    """Crea el usuario y una familia nueva donde queda como admin.

    Con REGISTRO_ABIERTO=false responde 403, salvo que aun no exista ningun usuario (el primer admin de la instalacion).
    """
    return service.registrar(db, datos)


@router.post("/login", response_model=TokenOut)
def login(datos: LoginIn, db: DbSession, request: Request):
    """5 fallos por IP y correo en 10 minutos -> 429."""
    ip = request.client.host if request.client else "desconocida"
    return service.ingresar(db, datos, ip)


@router.post("/logout", status_code=204)
def logout(db: DbSession, ctx: Ctx):
    """Deja constancia en la bitacora de que la persona cerro sesion (el token vence solo)."""
    service.salir(db, ctx)
    return Response(status_code=204)


@router.get("/yo", response_model=YoOut)
def yo(db: DbSession, ctx: Ctx):
    return service.yo_desde_contexto(db, ctx)


@router.patch("/yo", response_model=YoOut)
def editar_perfil(datos: PerfilIn, db: DbSession, ctx: Ctx):
    """Cada usuario cambia su propio nombre."""
    return service.editar_perfil(db, ctx, datos.nombre)


@router.post("/cambiar-clave", status_code=204)
def cambiar_clave(datos: CambiarClaveIn, db: DbSession, ctx: Ctx):
    """Pide la clave actual. Si es incorrecta responde 400 (no 401, para no cerrar la sesion)."""
    service.cambiar_clave(db, ctx, datos)
    return Response(status_code=204)
