"""Importa todos los modelos para que Base.metadata los conozca (Alembic y pruebas)."""
from app.modulos.apoyos import models as _apoyos  # noqa: F401
from app.modulos.auth import models as _auth  # noqa: F401
from app.modulos.bitacora import models as _bitacora  # noqa: F401
from app.modulos.categorias import models as _categorias  # noqa: F401
from app.modulos.cuentas import models as _cuentas  # noqa: F401
from app.modulos.familia import models as _familia  # noqa: F401
from app.modulos.historial import models as _historial  # noqa: F401
from app.modulos.movimientos import models as _movimientos  # noqa: F401
from app.modulos.visibilidad import models as _visibilidad  # noqa: F401
