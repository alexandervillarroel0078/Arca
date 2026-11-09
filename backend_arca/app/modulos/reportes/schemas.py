from datetime import date

from pydantic import BaseModel

from app.core.tipos import Monto


class Comparacion(BaseModel):
    """Un valor frente al mismo valor del periodo anterior (mismo largo, inmediatamente antes)."""

    anterior: Monto
    diferencia: Monto  # actual - anterior (en Bs)
    porcentaje: float | None  # diferencia / |anterior| * 100; nulo si el anterior es 0 (no se divide por cero)


class PeriodoAnterior(BaseModel):
    desde: date
    hasta: date
    etiqueta: str  # "vs octubre 2026", "vs 28 sep - 27 oct"


class ComparacionResumen(BaseModel):
    desde: date  # el periodo con el que se compara
    hasta: date
    etiqueta: str  # "vs octubre 2026"
    ingresos: Comparacion
    gastos: Comparacion
    saldo: Comparacion


class ResumenOut(BaseModel):
    mes: str
    desde: date
    hasta: date
    comparacion: ComparacionResumen
    ingresos: Monto
    gastos: Monto
    apoyos_entregados: Monto
    devoluciones: Monto
    saldo: Monto  # ingresos - gastos - apoyos entregados + devoluciones
    consumido: Monto  # apoyos consumidos: gasto familiar en linea aparte
    gasto_familiar_total: Monto  # gastos + consumido
    apoyos_pendientes_total: Monto
    apoyos_pendientes_cantidad: int  # beneficiarios con saldo pendiente
    incluye_privados: int = 0  # "Incluye tus N registros privados": tus registros propios que no son de toda la familia


class CategoriaTotal(BaseModel):
    categoria_id: int
    categoria: str
    icono: str
    total: Monto
    porcentaje: float
    comparacion: Comparacion


class PorCategoriaOut(BaseModel):
    mes: str
    desde: date
    hasta: date
    comparacion: Comparacion  # total de gastos frente al periodo anterior
    periodo_anterior: PeriodoAnterior
    categorias: list[CategoriaTotal]
    total_gastos: Monto
    apoyos_consumidos: Monto  # linea aparte
    incluye_privados: int = 0  # "Incluye tus N registros privados": tus registros propios que no son de toda la familia


class MiembroTotal(BaseModel):
    usuario_id: int
    nombre: str
    ingresos: Monto
    gastos: Monto
    apoyos_entregados: Monto


class PorMiembroOut(BaseModel):
    mes: str
    desde: date
    hasta: date
    miembros: list[MiembroTotal]
    incluye_privados: int = 0  # "Incluye tus N registros privados": tus registros propios que no son de toda la familia


class MesTotal(BaseModel):
    mes: str
    ingresos: Monto
    gastos: Monto
    apoyos_entregados: Monto
    devoluciones: Monto
    consumido: Monto
    saldo: Monto


class TendenciaOut(BaseModel):
    meses: list[MesTotal]
    incluye_privados: int = 0  # "Incluye tus N registros privados": tus registros propios que no son de toda la familia
