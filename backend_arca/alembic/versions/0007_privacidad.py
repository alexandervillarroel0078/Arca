"""privacidad: visibilidad de movimientos y apoyos, preferencia por miembro y personas elegidas (Fase 17)

- `movimientos.visibilidad` y `apoyos.visibilidad` (solo_yo | familia | elegidas), por defecto 'familia': todo lo
  existente sigue siendo visible para la familia. Las devoluciones heredan la de su apoyo (sin columna propia).
- `miembros.visibilidad_defecto` (solo_yo | familia), por defecto 'familia'.
- Tabla `compartidos` (entidad, entidad_id, usuario_id) para 'elegidas'.
No toca `historial` ni `bitacora` ni sus triggers.

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

CHECK = "visibilidad in ('solo_yo','familia','elegidas')"


def upgrade() -> None:
    for tabla, nombre in (("movimientos", "ck_movimiento_visibilidad"), ("apoyos", "ck_apoyo_visibilidad")):
        op.add_column(tabla, sa.Column("visibilidad", sa.String(10), server_default="familia", nullable=False))
        op.create_check_constraint(nombre, tabla, CHECK)
    op.add_column("miembros", sa.Column("visibilidad_defecto", sa.String(10), server_default="familia", nullable=False))
    op.create_check_constraint(
        "ck_miembro_visibilidad_defecto", "miembros", "visibilidad_defecto in ('solo_yo','familia')"
    )
    op.create_table(
        "compartidos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("familia_id", sa.Integer(), sa.ForeignKey("familias.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entidad", sa.String(20), nullable=False),
        sa.Column("entidad_id", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("creado_en", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("entidad", "entidad_id", "usuario_id", name="uq_compartido"),
    )
    op.create_index("ix_compartidos_familia_id", "compartidos", ["familia_id"])
    op.create_index("ix_compartidos_usuario", "compartidos", ["usuario_id", "entidad"])


def downgrade() -> None:
    op.drop_table("compartidos")
    op.drop_constraint("ck_miembro_visibilidad_defecto", "miembros", type_="check")
    op.drop_column("miembros", "visibilidad_defecto")
    op.drop_constraint("ck_apoyo_visibilidad", "apoyos", type_="check")
    op.drop_column("apoyos", "visibilidad")
    op.drop_constraint("ck_movimiento_visibilidad", "movimientos", type_="check")
    op.drop_column("movimientos", "visibilidad")
