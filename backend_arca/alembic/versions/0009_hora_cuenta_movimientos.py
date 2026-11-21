"""hora en cuenta_movimientos: hora LOCAL de La Paz (sin zona), opcional

- Solo agrega `cuenta_movimientos.hora time NULL`. No rellena nada: los movimientos anteriores quedan sin hora.
- `fecha` sigue siendo la fuente de verdad (filtros, periodos e indices). La hora solo ordena dentro del dia
  (fecha DESC, hora DESC NULLS LAST, id DESC) y se muestra.
No toca `historial` ni `bitacora` ni sus triggers ni ninguna otra tabla.

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cuenta_movimientos", sa.Column("hora", sa.Time(), nullable=True))


def downgrade() -> None:
    op.drop_column("cuenta_movimientos", "hora")
