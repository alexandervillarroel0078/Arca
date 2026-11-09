from fastapi import APIRouter

from app.core.deps import Ctx, CtxAdmin, DbSession
from app.modulos.categorias import service
from app.modulos.categorias.schemas import CategoriaCrear, CategoriaEditar, CategoriaOut

router = APIRouter(prefix="/categorias", tags=["categorias"])


@router.get("", response_model=list[CategoriaOut])
def listar(db: DbSession, ctx: Ctx):
    return service.listar(db, ctx.familia_id)


@router.post("", response_model=CategoriaOut, status_code=201)
def crear(datos: CategoriaCrear, db: DbSession, ctx: CtxAdmin):
    return service.crear(db, ctx.familia_id, datos, ctx.usuario.id)


@router.patch("/{categoria_id}", response_model=CategoriaOut)
def editar(categoria_id: int, datos: CategoriaEditar, db: DbSession, ctx: CtxAdmin):
    return service.editar(db, ctx.familia_id, categoria_id, datos, ctx.usuario.id)
