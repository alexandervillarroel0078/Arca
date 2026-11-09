"""dia de inicio del mes por familia (Fase 16: periodos)

Agrega `familias.dia_inicio_mes` (entero de 1 a 28, por defecto 1 = mes calendario). Solo cambia la VISTA
de los periodos; no toca ningun dato, ni `historial` ni `bitacora` ni sus triggers.

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("familias", sa.Column("dia_inicio_mes", sa.Integer(), server_default="1", nullable=False))
    op.create_check_constraint("ck_familias_dia_inicio_mes", "familias", "dia_inicio_mes BETWEEN 1 AND 28")


def downgrade() -> None:
    op.drop_constraint("ck_familias_dia_inicio_mes", "familias", type_="check")
    op.drop_column("familias", "dia_inicio_mes")
