"""Monedas de las cuentas: matriz tipo/moneda, decimales por moneda, validacion y formato de montos.

Reglas: 2 decimales en BS y USD; hasta 8 en USDT y BTC. Si sobran decimales se rechaza (422): JAMAS se redondea.
Los montos viajan como TEXTO en el JSON ("0.00012345"): un float perderia precision con 8 decimales.
"""
from decimal import Decimal

from fastapi import HTTPException

MONEDAS = ("BS", "USD", "USDT", "BTC")
DECIMALES = {"BS": 2, "USD": 2, "USDT": 8, "BTC": 8}
TIPOS = ("ahorro", "corriente", "cripto", "efectivo")
MONEDAS_POR_TIPO = {
    "ahorro": ("BS", "USD"), "corriente": ("BS", "USD"), "efectivo": ("BS", "USD"), "cripto": ("USDT", "BTC"),
}
OTRO = "Otro"
BANCOS = (
    "Banco Nacional de Bolivia", "Banco Mercantil Santa Cruz", "Banco de Crédito de Bolivia", "Banco Unión",
    "Banco BISA", "Banco Ganadero", "Banco Económico", "Banco Fassil", "Banco Sol", "Banco FIE", "Banco Prodem", OTRO,
)
PLATAFORMAS = ("Binance", "Bybit", "Coinbase", "Kraken", "OKX", "Trust Wallet", "Ledger", "MetaMask", OTRO)
AVISO_NOTA = (
    "Las notas se copian al historial y a la bitácora. No escribas claves, contraseñas, frases semilla ni números "
    "completos de cuenta o billetera."
)
MAX_ENTEROS = 16  # Numeric(24,8): 16 digitos enteros


def _error(mensaje: str) -> HTTPException:
    return HTTPException(status_code=422, detail=mensaje)


def decimales_de(valor: Decimal) -> int:
    """Cantidad de decimales significativos (sin contar ceros finales)."""
    exp = valor.normalize().as_tuple().exponent
    return max(0, -exp) if isinstance(exp, int) else 0


def validar_monto(
    valor: Decimal, moneda: str, campo: str = "monto", *, positivo: bool = True, permitir_negativo: bool = False
) -> Decimal:
    """Devuelve el valor tal cual si es valido; si no, 422. `positivo`: > 0 (si no, >= 0)."""
    if not valor.is_finite():
        raise _error(f"{campo}: no es un número válido")
    if valor < 0 and not permitir_negativo:
        raise _error(f"{campo}: no puede ser negativo")
    if positivo and valor <= 0:
        raise _error(f"{campo}: debe ser mayor que cero")
    n = DECIMALES[moneda]
    if decimales_de(valor) > n:
        raise _error(f"{campo}: {moneda} admite hasta {n} decimales")
    if valor != 0 and valor.adjusted() >= MAX_ENTEROS:
        raise _error(f"{campo}: es demasiado grande")
    return valor


def texto(valor: Decimal | None, moneda: str) -> str | None:
    """Texto con la escala de la moneda: '100.00' (BS/USD), '0.00012345' (BTC). Nunca notacion cientifica."""
    if valor is None:
        return None
    return format(valor.quantize(Decimal(1).scaleb(-DECIMALES[moneda])), "f")


def con_moneda(valor: Decimal | None, moneda: str) -> str | None:
    """'Bs 100.00' / '100.00 USD' / '0.00012345 BTC' (para historial y bitacora)."""
    t = texto(valor, moneda)
    if t is None:
        return None
    return f"Bs {t}" if moneda == "BS" else f"{t} {moneda}"


def validar_cuenta(tipo: str, moneda: str, banco: str | None, banco_otro: str | None, ultimos4: str | None) -> None:
    """Matriz tipo/moneda y datos bancarios coherentes con el tipo (422 si no)."""
    if moneda not in MONEDAS_POR_TIPO[tipo]:
        raise _error("Una cuenta cripto solo admite USDT o BTC; las bancarias y el efectivo, Bs o USD")
    if tipo == "efectivo":
        if banco or banco_otro or ultimos4:
            raise _error("El efectivo no lleva banco ni últimos 4 dígitos")
        return
    lista = PLATAFORMAS if tipo == "cripto" else BANCOS
    if not banco or banco not in lista:
        raise _error("Elige el banco o la plataforma de la lista (o «Otro»)")
    if banco == OTRO and not (banco_otro or "").strip():
        raise _error("Escribe el nombre del banco o la plataforma")
    if banco != OTRO and banco_otro:
        raise _error("«Otro banco» solo se usa cuando eliges «Otro»")
