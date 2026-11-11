"""Fase 17 - MATRIZ DE VISIBILIDAD.

Para cada endpoint que devuelve o modifica datos de registros, por cada tipo de usuario (dueno, admin, miembro de la
familia, persona elegida y usuario de OTRA familia) y por cada visibilidad (solo_yo, elegidas, familia) se verifica el
codigo (200 o 404, o 403 si lo ves pero no es tuyo) y que ningun total ni lista contenga datos que no corresponden.

`test_todas_las_rutas_estan_en_la_matriz` recorre TODAS las rutas de la app y falla si alguna no esta clasificada: un
endpoint nuevo no puede olvidarse del filtro de visibilidad.
"""
import pytest
from fastapi.routing import APIRoute
from sqlalchemy import select

from app.core.security import crear_token
from app.main import app
from app.modulos.auth.models import Usuario
from app.modulos.categorias.service import crear_iniciales
from app.modulos.familia.models import Familia, Miembro
from tests.conftest import SesionTest

USUARIOS = ["dueno", "admin", "otro", "elegido", "ajeno"]
VISIBILIDADES = ["solo_yo", "elegidas", "familia"]
MONTO_GASTO, MONTO_APOYO, MONTO_DEV = 123.45, 777.77, 50.55
MARCAS = ["SECRETO", "Benef-Secreto", "123.45", "777.77", "50.55"]


# ------------------------------------------------------------------ el mundo de la prueba
class Mundo:
    def __init__(self):
        self.h: dict[str, dict] = {}
        self.uid: dict[str, int] = {}
        self.v = ""
        self.mov = self.apo = self.dev = 0
        self.cat = 0


def _usuario(db, nombre, familia_id, rol):
    u = Usuario(nombre=nombre, email=f"{nombre}@t.com", password_hash="no-se-usa-en-esta-prueba")
    db.add(u)
    db.flush()
    db.add(Miembro(usuario_id=u.id, familia_id=familia_id, rol=rol, activo=True))
    return u


def construir(client, v: str) -> Mundo:
    """Dos familias: la de siempre (admin, dueno, otro, elegido) y otra (ajeno). El dueno registra un gasto, un apoyo y
    una devolucion con la visibilidad `v` (si es 'elegidas', compartidos con `elegido`)."""
    m = Mundo()
    m.v = v
    with SesionTest() as db:
        f1, f2 = Familia(nombre="Fam"), Familia(nombre="Otra")
        db.add_all([f1, f2])
        db.flush()
        us = {
            "admin": _usuario(db, "admin", f1.id, "admin"),
            "dueno": _usuario(db, "dueno", f1.id, "miembro"),
            "otro": _usuario(db, "otro", f1.id, "miembro"),
            "elegido": _usuario(db, "elegido", f1.id, "miembro"),
            "ajeno": _usuario(db, "ajeno", f2.id, "admin"),
        }
        crear_iniciales(db, f1.id, us["admin"].id)
        crear_iniciales(db, f2.id, us["ajeno"].id)
        db.commit()
        m.uid = {k: u.id for k, u in us.items()}
    m.h = {k: {"Authorization": f"Bearer {crear_token(i)}"} for k, i in m.uid.items()}
    m.cat = client.get("/api/categorias", headers=m.h["dueno"]).json()[0]["id"]
    extra = {"visibilidad": v}
    if v == "elegidas":
        extra["compartido_con"] = [m.uid["elegido"]]
    d = m.h["dueno"]
    r = client.post("/api/movimientos", headers=d, json={
        "tipo": "gasto", "monto": MONTO_GASTO, "categoria_id": m.cat, "nota": "SECRETO-gasto", **extra})
    assert r.status_code == 201, r.text
    m.mov = r.json()["id"]
    r = client.post("/api/apoyos", headers=d, json={
        "beneficiario": "Benef-Secreto", "monto": MONTO_APOYO, "nota": "SECRETO-apoyo", **extra})
    assert r.status_code == 201, r.text
    m.apo = r.json()["id"]
    r = client.post(f"/api/apoyos/{m.apo}/devoluciones", headers=d, json={"monto": MONTO_DEV, "nota": "SECRETO-dev"})
    assert r.status_code == 201, r.text
    m.dev = r.json()["devoluciones"][0]["id"]
    return m


def ve(quien: str, v: str) -> bool:
    """Quien ve = el dueno, mas la familia si es 'familia', mas los elegidos si es 'elegidas'. El admin NO ve lo privado."""
    if quien == "ajeno":
        return False
    if quien == "dueno":
        return True
    if v == "familia":
        return True
    return v == "elegidas" and quien == "elegido"


def edita(quien: str, v: str) -> bool:
    return quien == "dueno" or (quien == "admin" and v == "familia")


def devuelve(quien: str, v: str) -> bool:
    return quien == "dueno" or (v == "familia" and ve(quien, v))


def solo_dueno(quien: str, v: str) -> bool:
    return quien == "dueno"


def sin_fuga(r, quien, v):
    """Si no lo ves, ninguna marca de los datos puede aparecer en la respuesta."""
    if not ve(quien, v):
        for marca in MARCAS:
            assert marca not in r.text, f"{quien}/{v}: la respuesta contiene {marca!r}: {r.text[:300]}"


# ------------------------------------------------------------------ endpoints de UN registro
# Cada escenario: (descripcion, permiso, preparar(c, m) | None, llamar(c, m, h) -> Response)
def _p(c, m, ruta, cuerpo=None, quien="dueno"):
    r = c.post(ruta, headers=m.h[quien], json=cuerpo or {})
    assert r.status_code in (200, 201), r.text


MOV = "/api/movimientos/{id}"
E: dict[tuple[str, str], list] = {}


def reg(metodo, ruta, permiso, llamar, preparar=None):
    E.setdefault((metodo, ruta), []).append((permiso, preparar, llamar))


def para(m):
    return {"mov": f"/api/movimientos/{m.mov}", "apo": f"/api/apoyos/{m.apo}", "dev": f"/api/apoyos/{m.apo}/devoluciones/{m.dev}"}


# movimientos
reg("GET", "/api/movimientos/{movimiento_id}", ve, lambda c, m, h: c.get(para(m)["mov"], headers=h))
reg("PATCH", "/api/movimientos/{movimiento_id}", edita, lambda c, m, h: c.patch(para(m)["mov"], headers=h, json={"nota": "cambio"}))
reg("POST", "/api/movimientos/{movimiento_id}/anular", edita, lambda c, m, h: c.post(para(m)["mov"] + "/anular", headers=h, json={}))
reg("POST", "/api/movimientos/{movimiento_id}/reactivar", edita, lambda c, m, h: c.post(para(m)["mov"] + "/reactivar", headers=h),
    preparar=lambda c, m: _p(c, m, para(m)["mov"] + "/anular"))
reg("PATCH", "/api/movimientos/{movimiento_id}/visibilidad", solo_dueno,
    lambda c, m, h: c.patch(para(m)["mov"] + "/visibilidad", headers=h, json={"visibilidad": "solo_yo"}))
# apoyos
reg("GET", "/api/apoyos/{apoyo_id}", ve, lambda c, m, h: c.get(para(m)["apo"], headers=h))
reg("PATCH", "/api/apoyos/{apoyo_id}", edita, lambda c, m, h: c.patch(para(m)["apo"], headers=h, json={"nota": "cambio"}))
reg("POST", "/api/apoyos/{apoyo_id}/anular", edita, lambda c, m, h: c.post(para(m)["apo"] + "/anular", headers=h, json={}))
reg("POST", "/api/apoyos/{apoyo_id}/reactivar", edita, lambda c, m, h: c.post(para(m)["apo"] + "/reactivar", headers=h),
    preparar=lambda c, m: _p(c, m, para(m)["apo"] + "/anular"))
reg("PATCH", "/api/apoyos/{apoyo_id}/visibilidad", solo_dueno,
    lambda c, m, h: c.patch(para(m)["apo"] + "/visibilidad", headers=h, json={"visibilidad": "solo_yo"}))
reg("POST", "/api/apoyos/{apoyo_id}/consumir", edita, lambda c, m, h: c.post(para(m)["apo"] + "/consumir", headers=h))
reg("POST", "/api/apoyos/{apoyo_id}/reabrir", edita, lambda c, m, h: c.post(para(m)["apo"] + "/reabrir", headers=h),
    preparar=lambda c, m: _p(c, m, para(m)["apo"] + "/consumir"))
reg("POST", "/api/apoyos/{apoyo_id}/devoluciones", devuelve,
    lambda c, m, h: c.post(para(m)["apo"] + "/devoluciones", headers=h, json={"monto": 10, "nota": "otra"}))
reg("PATCH", "/api/apoyos/{apoyo_id}/devoluciones/{devolucion_id}", edita,
    lambda c, m, h: c.patch(para(m)["dev"], headers=h, json={"nota": "cambio"}))
reg("POST", "/api/apoyos/{apoyo_id}/devoluciones/{devolucion_id}/anular", edita,
    lambda c, m, h: c.post(para(m)["dev"] + "/anular", headers=h, json={}))
reg("POST", "/api/apoyos/{apoyo_id}/devoluciones/{devolucion_id}/reactivar", edita,
    lambda c, m, h: c.post(para(m)["dev"] + "/reactivar", headers=h),
    preparar=lambda c, m: _p(c, m, para(m)["dev"] + "/anular"))
# historial de un registro (los tres tipos)
for _clave in ("movimiento", "apoyo", "devolucion"):
    reg("GET", "/api/historial", ve,
        (lambda k: lambda c, m, h: c.get(
            f"/api/historial?entidad={k}&entidad_id={ {'movimiento': m.mov, 'apoyo': m.apo, 'devolucion': m.dev}[k] }", headers=h
        ))(_clave))


def _codigo_esperado(permiso, quien, v):
    if not ve(quien, v):
        return {404}
    return {200, 201} if permiso(quien, v) else {403}


def _casos_registro():
    for (metodo, ruta), escenarios in E.items():
        for i, esc in enumerate(escenarios):
            for v in VISIBILIDADES:
                for quien in USUARIOS:
                    yield pytest.param(metodo, ruta, i, v, quien, id=f"{metodo} {ruta} #{i} {v} {quien}")


@pytest.mark.parametrize("metodo,ruta,i,v,quien", list(_casos_registro()))
def test_matriz_endpoints_de_un_registro(client, metodo, ruta, i, v, quien):
    permiso, preparar, llamar = E[(metodo, ruta)][i]
    m = construir(client, v)
    if preparar:
        preparar(client, m)
    r = llamar(client, m, m.h[quien])
    esperado = _codigo_esperado(permiso, quien, v)
    assert r.status_code in esperado, f"{metodo} {ruta} {quien}/{v}: {r.status_code} {r.text[:300]}"
    if r.status_code == 404:
        assert "SECRETO" not in r.text
        assert r.json()["detail"] in ("Movimiento no encontrado", "Apoyo no encontrado", "Devolución no encontrado", "Devolución no encontrada")
    sin_fuga(r, quien, v)


# ------------------------------------------------------------------ listas y totales
def _num(x):
    return round(float(x), 2)


def _ids(r, clave="id"):
    return {i[clave] for i in r.json()}


def l_movimientos(c, m, quien, v, r):
    assert (m.mov in _ids(r)) == ve(quien, v)


def l_actividad(c, m, quien, v, r):
    items = r.json()["items"]
    assert ({(i["clase"], i["id"]) for i in items} >= {("movimiento", m.mov), ("apoyo", m.apo)}) == ve(quien, v)
    assert r.json()["total"] == (2 if ve(quien, v) else 0)


def l_apoyos(c, m, quien, v, r):
    assert (m.apo in _ids(r)) == ve(quien, v)


def l_apoyos_resumen(c, m, quien, v, r):
    j = r.json()
    assert [b["beneficiario"] for b in j["beneficiarios"]] == (["Benef-Secreto"] if ve(quien, v) else [])
    assert _num(j["total_pendiente"]) == (_num(MONTO_APOYO - MONTO_DEV) if ve(quien, v) else 0)
    assert _num(j["total_entregado"]) == (MONTO_APOYO if ve(quien, v) else 0)
    assert j["incluye_privados"] == (1 if quien == "dueno" and v != "familia" else 0)


def l_resumen(c, m, quien, v, r):
    j = r.json()
    visto = ve(quien, v)
    assert _num(j["gastos"]) == (MONTO_GASTO if visto else 0)
    assert _num(j["apoyos_entregados"]) == (MONTO_APOYO if visto else 0)
    assert _num(j["devoluciones"]) == (MONTO_DEV if visto else 0)
    assert _num(j["saldo"]) == (_num(-MONTO_GASTO - MONTO_APOYO + MONTO_DEV) if visto else 0)
    assert _num(j["apoyos_pendientes_total"]) == (_num(MONTO_APOYO - MONTO_DEV) if visto else 0)
    assert j["incluye_privados"] == (2 if quien == "dueno" and v != "familia" else 0)


def l_por_categoria(c, m, quien, v, r):
    j = r.json()
    assert _num(j["total_gastos"]) == (MONTO_GASTO if ve(quien, v) else 0)
    assert len(j["categorias"]) == (1 if ve(quien, v) else 0)
    assert j["incluye_privados"] == (2 if quien == "dueno" and v != "familia" else 0)


def l_por_miembro(c, m, quien, v, r):
    j = r.json()
    por = {x["usuario_id"]: x for x in j["miembros"]}
    visto = ve(quien, v)
    assert _num(por[m.uid["dueno"]]["gastos"]) == (MONTO_GASTO if visto else 0) if quien != "ajeno" else True
    assert sum(_num(x["gastos"]) for x in j["miembros"]) == (MONTO_GASTO if visto else 0)
    assert sum(_num(x["apoyos_entregados"]) for x in j["miembros"]) == (MONTO_APOYO if visto else 0)
    # nunca un renglon "Privado": los miembros son siempre los de la familia de quien consulta
    assert all(x["nombre"] != "Privado" for x in j["miembros"])
    assert j["incluye_privados"] == (2 if quien == "dueno" and v != "familia" else 0)


def l_tendencia(c, m, quien, v, r):
    j = r.json()
    assert sum(_num(x["gastos"]) for x in j["meses"]) == (MONTO_GASTO if ve(quien, v) else 0)
    assert j["incluye_privados"] == (2 if quien == "dueno" and v != "familia" else 0)


def l_visibles(c, m, quien, v, r):
    j = r.json()
    assert (m.mov in j["movimientos"]) == ve(quien, v)
    assert (m.apo in j["apoyos"]) == ve(quien, v)


def l_privacidad(c, m, quien, v, r):
    assert r.json()["visibilidad_defecto"] == "familia"


def _solo_admin(fn):
    """Los endpoints solo-admin responden 403 al resto; al admin le muestran solo lo que el admin puede ver."""
    def comprobar(c, m, quien, v, r):
        if quien in ("admin", "ajeno"):
            assert r.status_code == 200
            fn(c, m, quien, v, r)
        else:
            assert r.status_code == 403
    return comprobar


def h_global(c, m, quien, v, r):
    vistos = {(i["entidad"], i["entidad_id"]) for i in r.json()["items"]}
    visto = ve(quien, v)
    assert (("movimiento", m.mov) in vistos) == visto
    assert (("apoyo", m.apo) in vistos) == visto
    assert (("devolucion", m.dev) in vistos) == visto


def b_lista(c, m, quien, v, r):
    titulos = " | ".join(i["titulo"] + " " + " ".join(i["detalle"]) for i in r.json()["items"])
    assert ("123.45" in titulos) == ve(quien, v)
    assert ("Benef-Secreto" in titulos) == ve(quien, v)


def b_csv(c, m, quien, v, r):
    assert ("123.45" in r.text) == ve(quien, v)
    assert ("Benef-Secreto" in r.text) == ve(quien, v)


def b_resumen(c, m, quien, v, r):
    pass  # solo accesos por persona: sin datos de registros


L: dict[tuple[str, str], tuple[str, object]] = {
    ("GET", "/api/movimientos"): ("/api/movimientos?limite=100", l_movimientos),
    ("GET", "/api/actividad"): ("/api/actividad?limite=100", l_actividad),
    ("GET", "/api/apoyos"): ("/api/apoyos", l_apoyos),
    ("GET", "/api/apoyos/resumen"): ("/api/apoyos/resumen", l_apoyos_resumen),
    ("GET", "/api/reportes/resumen"): ("/api/reportes/resumen", l_resumen),
    ("GET", "/api/reportes/por-categoria"): ("/api/reportes/por-categoria", l_por_categoria),
    ("GET", "/api/reportes/por-miembro"): ("/api/reportes/por-miembro", l_por_miembro),
    ("GET", "/api/reportes/tendencia-mensual"): ("/api/reportes/tendencia-mensual", l_tendencia),
    ("GET", "/api/privacidad"): ("/api/privacidad", l_privacidad),
    ("GET", "/api/sincronizacion/visibles"): ("/api/sincronizacion/visibles", l_visibles),
    ("GET", "/api/bitacora"): ("/api/bitacora?origen=datos&limite=100", _solo_admin(b_lista)),
    ("GET", "/api/bitacora/exportar.csv"): ("/api/bitacora/exportar.csv", _solo_admin(b_csv)),
    ("GET", "/api/bitacora/resumen"): ("/api/bitacora/resumen", _solo_admin(b_resumen)),
}
# el historial global (sin entidad_id) es solo admin; se prueba con su propia ruta
L_HISTORIAL = ("/api/historial?limite=100", _solo_admin(h_global))


@pytest.mark.parametrize(
    "clave,v,quien",
    [pytest.param(k, v, q, id=f"{k[0]} {k[1]} {v} {q}") for k in L for v in VISIBILIDADES for q in USUARIOS],
)
def test_matriz_listas_y_totales(client, clave, v, quien):
    m = construir(client, v)
    url, comprobar = L[clave]
    r = client.get(url, headers=m.h[quien])
    if comprobar.__name__ == "comprobar":  # solo-admin
        comprobar(client, m, quien, v, r)
    else:
        assert r.status_code == 200, r.text
        comprobar(client, m, quien, v, r)
    if r.status_code == 200:
        sin_fuga(r, quien, v)


@pytest.mark.parametrize("v", VISIBILIDADES)
@pytest.mark.parametrize("quien", USUARIOS)
def test_matriz_historial_global(client, v, quien):
    m = construir(client, v)
    url, comprobar = L_HISTORIAL
    r = client.get(url, headers=m.h[quien])
    comprobar(client, m, quien, v, r)
    if r.status_code == 200:
        sin_fuga(r, quien, v)


@pytest.mark.parametrize("v", VISIBILIDADES)
@pytest.mark.parametrize("quien", USUARIOS)
def test_matriz_crear_movimiento_y_apoyo(client, v, quien):
    """Cualquiera crea lo suyo; con 'elegidas' solo puede elegir miembros activos de SU familia."""
    m = construir(client, v)
    h = m.h[quien]
    otro_de_otra_familia = m.uid["ajeno"] if quien != "ajeno" else m.uid["dueno"]
    for ruta, cuerpo in (
        ("/api/movimientos", {"tipo": "ingreso", "monto": 5}),
        ("/api/apoyos", {"beneficiario": "X", "monto": 5}),
    ):
        r = client.post(ruta, headers=h, json={**cuerpo, "visibilidad": "elegidas", "compartido_con": [otro_de_otra_familia]})
        assert r.status_code == 422, r.text
        r = client.post(ruta, headers=h, json={**cuerpo, "visibilidad": "solo_yo"})
        assert r.status_code == 201 and r.json()["visibilidad"] == "solo_yo"


# ------------------------------------------------------------------ todas las rutas estan clasificadas
SIN_DATOS_DE_REGISTROS = {
    # autenticacion y perfil (no devuelven movimientos, apoyos ni devoluciones)
    ("POST", "/api/auth/registro"), ("POST", "/api/auth/login"), ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/yo"), ("PATCH", "/api/auth/yo"), ("POST", "/api/auth/cambiar-clave"),
    # familia, miembros y categorias (no dependen de la visibilidad)
    ("GET", "/api/familia"), ("PATCH", "/api/familia"), ("GET", "/api/familia/miembros"),
    ("POST", "/api/familia/invitar"), ("PATCH", "/api/familia/miembros/{usuario_id}"),
    ("POST", "/api/familia/miembros/{usuario_id}/restablecer-clave"),
    ("GET", "/api/categorias"), ("POST", "/api/categorias"), ("PATCH", "/api/categorias/{categoria_id}"),
    # periodos (solo fechas) y salud
    ("GET", "/api/periodos/actual"), ("GET", "/api/salud"), ("GET", "/salud"),
    # privacidad del propio usuario (su preferencia; 'aplicar' solo toca lo suyo)
    ("PATCH", "/api/privacidad"), ("POST", "/api/privacidad/aplicar-defecto"),
}
CON_FILTRO_PROPIO = {  # rutas de listas/totales/creacion cubiertas por los otros tests de este archivo
    ("GET", "/api/movimientos"), ("POST", "/api/movimientos"), ("GET", "/api/apoyos"), ("POST", "/api/apoyos"),
    ("GET", "/api/apoyos/resumen"), ("GET", "/api/actividad"), ("GET", "/api/historial"),
    ("GET", "/api/bitacora"), ("GET", "/api/bitacora/resumen"), ("GET", "/api/bitacora/exportar.csv"),
    ("GET", "/api/reportes/resumen"), ("GET", "/api/reportes/por-categoria"), ("GET", "/api/reportes/por-miembro"),
    ("GET", "/api/reportes/tendencia-mensual"), ("GET", "/api/privacidad"),
    ("GET", "/api/sincronizacion/visibles"),
}
# Cuentas (etapa 2): su visibilidad es POR CUENTA y se prueba ruta por ruta en test_etapa2_cuentas_aislamiento.py
# (404 para admin, otro miembro, elegido y otra familia; ver `test_toda_ruta_de_cuentas_esta_cubierta...`).
CUENTAS_RUTAS = {
    ("GET", "/api/cuentas"), ("POST", "/api/cuentas"), ("GET", "/api/cuentas/catalogo"),
    ("GET", "/api/cuentas/movimientos"), ("POST", "/api/cuentas/traspasos"),
    ("GET", "/api/cuentas/movimientos/{movimiento_id}"), ("POST", "/api/cuentas/movimientos/{movimiento_id}/anular"),
    ("POST", "/api/cuentas/movimientos/{movimiento_id}/reactivar"),
    ("GET", "/api/cuentas/{cuenta_id}"), ("PATCH", "/api/cuentas/{cuenta_id}"),
    ("POST", "/api/cuentas/{cuenta_id}/anular"), ("POST", "/api/cuentas/{cuenta_id}/reactivar"),
    ("PATCH", "/api/cuentas/{cuenta_id}/visibilidad"), ("GET", "/api/cuentas/{cuenta_id}/movimientos"),
    ("POST", "/api/cuentas/{cuenta_id}/depositos"), ("POST", "/api/cuentas/{cuenta_id}/retiros"),
    ("POST", "/api/cuentas/{cuenta_id}/ajustes"),
}


def _rutas_de_la_app():
    rutas = set()
    for r in app.routes:
        if isinstance(r, APIRoute):
            for metodo in r.methods - {"HEAD", "OPTIONS"}:
                rutas.add((metodo, r.path))
    return rutas


def test_todas_las_rutas_estan_en_la_matriz():
    """Un endpoint nuevo que devuelva datos de registros DEBE agregarse a la matriz (E, L o SIN_DATOS_DE_REGISTROS)."""
    clasificadas = set(E) | CON_FILTRO_PROPIO | SIN_DATOS_DE_REGISTROS | CUENTAS_RUTAS
    reales = _rutas_de_la_app()
    sin_clasificar = reales - clasificadas
    assert not sin_clasificar, (
        f"Rutas sin clasificar en la matriz de visibilidad (agregalas a la matriz con su prueba de filtro): {sorted(sin_clasificar)}"
    )
    obsoletas = clasificadas - reales
    assert not obsoletas, f"La matriz menciona rutas que ya no existen: {sorted(obsoletas)}"
    # y las listas/totales estan en la matriz de listas
    assert set(L) | {("GET", "/api/historial"), ("POST", "/api/movimientos"), ("POST", "/api/apoyos")} >= CON_FILTRO_PROPIO


def test_las_rutas_sin_datos_de_registros_no_devuelven_marcas(client):
    """Defensa extra: los GET 'sin datos' no filtran las marcas de un registro privado ni a admin ni a otra familia."""
    m = construir(client, "solo_yo")
    for metodo, ruta in sorted(SIN_DATOS_DE_REGISTROS):
        if metodo != "GET" or "{" in ruta:
            continue
        for quien in ("admin", "otro", "elegido", "ajeno"):
            r = client.get(ruta, headers=m.h[quien])
            for marca in MARCAS:
                assert marca not in r.text, f"{ruta} ({quien}) contiene {marca!r}"
