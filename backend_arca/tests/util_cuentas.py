"""Ayudas de las pruebas de Cuentas (no es un archivo de pruebas)."""
from tests.test_fase17_matriz import construir

OTRA = "otra cuenta"


def mundo(client):
    """Dos familias: admin, dueno, otro, elegido (familia 1) y ajeno (familia 2). Ver test_fase17_matriz.construir."""
    return construir(client, "familia")


def cuenta(client, h, expect=201, **kw) -> dict:
    cuerpo = {"nombre": "Caja", "tipo": "efectivo", "moneda": "BS", "saldo_inicial": "0", **kw}
    r = client.post("/api/cuentas", headers=h, json=cuerpo)
    assert r.status_code == expect, r.text
    return r.json()


def mov(client, h, cuenta_id, que, expect=201, **kw) -> dict:
    """que: depositos | retiros | ajustes"""
    r = client.post(f"/api/cuentas/{cuenta_id}/{que}", headers=h, json=kw)
    assert r.status_code == expect, r.text
    return r.json()


def traspaso(client, h, origen, destino, monto, expect=201, **kw) -> dict:
    r = client.post(
        "/api/cuentas/traspasos", headers=h,
        json={"cuenta_id": origen, "cuenta_destino_id": destino, "monto": monto, **kw},
    )
    assert r.status_code == expect, r.text
    return r.json()


def saldo(client, h, cuenta_id) -> str:
    return client.get(f"/api/cuentas/{cuenta_id}", headers=h).json()["saldo"]
