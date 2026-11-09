"""Fase 17 - Privacidad: casos concretos (la matriz completa esta en test_fase17_matriz.py)."""
import re
import statistics
import time
import uuid

from sqlalchemy import select, update

from app.modulos.bitacora.models import Bitacora
from app.modulos.familia.models import Miembro
from app.modulos.historial.models import Historial
from tests.conftest import SesionTest
from tests.test_fase17_matriz import construir


def gasto(c, h, cat, monto=100, **extra):
    r = c.post("/api/movimientos", headers=h, json={"tipo": "gasto", "monto": monto, "categoria_id": cat, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def ids_de(r, clave="id"):
    return {x[clave] for x in r.json()}


# ---------------------------------------------------------------- el admin no ve lo privado; totales distintos
def test_el_admin_no_ve_lo_privado_de_un_miembro_y_cada_uno_tiene_sus_totales(client):
    m = construir(client, "solo_yo")
    assert m.mov not in ids_de(client.get("/api/movimientos", headers=m.h["admin"]))
    assert m.mov in ids_de(client.get("/api/movimientos", headers=m.h["dueno"]))
    # el admin tampoco puede leerlo, editarlo ni anularlo: 404
    for r in (
        client.get(f"/api/movimientos/{m.mov}", headers=m.h["admin"]),
        client.patch(f"/api/movimientos/{m.mov}", headers=m.h["admin"], json={"nota": "x"}),
        client.post(f"/api/movimientos/{m.mov}/anular", headers=m.h["admin"], json={}),
    ):
        assert r.status_code == 404
    res = {q: client.get("/api/reportes/resumen", headers=m.h[q]).json() for q in ("dueno", "admin")}
    assert res["dueno"]["gastos"] == 123.45 and res["admin"]["gastos"] == 0
    assert res["dueno"]["saldo"] != res["admin"]["saldo"]


def test_apoyo_privado_y_su_beneficiario_ocultos(client):
    m = construir(client, "solo_yo")
    r = client.get("/api/apoyos/resumen", headers=m.h["admin"]).json()
    assert r["beneficiarios"] == [] and r["total_pendiente"] == 0
    assert "Benef-Secreto" not in client.get("/api/apoyos", headers=m.h["otro"]).text
    # tampoco en el resumen del Inicio
    ini = client.get("/api/reportes/resumen", headers=m.h["otro"]).json()
    assert ini["apoyos_pendientes_cantidad"] == 0 and ini["apoyos_pendientes_total"] == 0


# ---------------------------------------------------------------- el 404 no distingue
def test_el_404_es_identico_para_inexistente_y_para_no_visible(client):
    m = construir(client, "solo_yo")
    h = m.h["admin"]
    for ruta in ("movimientos/{}", "apoyos/{}", "historial?entidad=movimiento&entidad_id={}"):
        invisible = {"movimientos/{}": m.mov, "apoyos/{}": m.apo}.get(ruta, m.mov)
        a = client.get("/api/" + ruta.format(invisible), headers=h)
        b = client.get("/api/" + ruta.format(99999), headers=h)
        assert a.status_code == b.status_code == 404
        assert a.text == b.text and a.headers["content-type"] == b.headers["content-type"]
    for verbo, sufijo in (("patch", ""), ("post", "/anular"), ("post", "/reactivar")):
        a = getattr(client, verbo)(f"/api/movimientos/{m.mov}{sufijo}", headers=h, json={})
        b = getattr(client, verbo)(f"/api/movimientos/99999{sufijo}", headers=h, json={})
        assert a.status_code == b.status_code == 404 and a.text == b.text
    a = client.post(f"/api/apoyos/{m.apo}/devoluciones", headers=h, json={"monto": 1})
    b = client.post("/api/apoyos/99999/devoluciones", headers=h, json={"monto": 1})
    assert a.status_code == b.status_code == 404 and a.text == b.text
    a = client.post(f"/api/apoyos/{m.apo}/consumir", headers=h)
    b = client.post("/api/apoyos/99999/consumir", headers=h)
    assert a.status_code == b.status_code == 404 and a.text == b.text


def test_el_404_tarda_lo_mismo_para_inexistente_y_para_no_visible(client):
    m = construir(client, "solo_yo")

    def mediana(id_):
        tiempos = []
        for _ in range(25):
            t = time.perf_counter()
            client.get(f"/api/movimientos/{id_}", headers=m.h["admin"])
            tiempos.append(time.perf_counter() - t)
        return statistics.median(tiempos)

    existe_pero_oculto, no_existe = mediana(m.mov), mediana(99999)
    assert abs(existe_pero_oculto - no_existe) < max(0.05, no_existe), (existe_pero_oculto, no_existe)


# ---------------------------------------------------------------- compartir, dejar de compartir, cambiar de familia a privado
def test_compartir_y_dejar_de_compartir(client):
    m = construir(client, "solo_yo")
    d, e, o = m.h["dueno"], m.h["elegido"], m.h["otro"]
    assert client.get(f"/api/movimientos/{m.mov}", headers=e).status_code == 404
    r = client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=d, json={"visibilidad": "elegidas", "compartido_con": [m.uid["elegido"]]})
    assert r.status_code == 200 and r.json()["compartido_con"] == [m.uid["elegido"]]
    # el elegido lo ve en solo lectura; el resto sigue sin verlo; el elegido no ve con quien mas se comparte
    ver = client.get(f"/api/movimientos/{m.mov}", headers=e)
    assert ver.status_code == 200 and ver.json()["compartido_con"] == [] and ver.json()["visibilidad"] == "elegidas"
    assert client.patch(f"/api/movimientos/{m.mov}", headers=e, json={"nota": "x"}).status_code == 403
    assert client.post(f"/api/movimientos/{m.mov}/anular", headers=e, json={}).status_code == 403
    assert client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=e, json={"visibilidad": "familia"}).status_code == 403
    assert client.get(f"/api/movimientos/{m.mov}", headers=o).status_code == 404
    assert m.mov in ids_de(client.get("/api/movimientos", headers=e))
    # dejar de compartir
    r = client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=d, json={"visibilidad": "solo_yo"})
    assert r.status_code == 200 and r.json()["compartido_con"] == []
    assert client.get(f"/api/movimientos/{m.mov}", headers=e).status_code == 404
    assert m.mov not in ids_de(client.get("/api/movimientos", headers=e))
    # compartir con otra persona distinta reemplaza a la anterior
    client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=d, json={"visibilidad": "elegidas", "compartido_con": [m.uid["otro"]]})
    assert client.get(f"/api/movimientos/{m.mov}", headers=e).status_code == 404
    assert client.get(f"/api/movimientos/{m.mov}", headers=o).status_code == 200


def test_pasar_de_familia_a_privado_lo_oculta_a_todos_y_sube_la_version(client):
    m = construir(client, "familia")
    d = m.h["dueno"]
    antes = client.get(f"/api/movimientos/{m.mov}", headers=m.h["otro"]).json()
    assert client.get("/api/reportes/resumen", headers=m.h["otro"]).json()["gastos"] == 123.45
    r = client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=d, json={"visibilidad": "solo_yo", "version_base": antes["version"]})
    assert r.status_code == 200 and r.json()["version"] == antes["version"] + 1  # otros dispositivos lo notan
    for q in ("admin", "otro", "elegido"):
        assert client.get(f"/api/movimientos/{m.mov}", headers=m.h[q]).status_code == 404
        assert m.mov not in ids_de(client.get("/api/movimientos", headers=m.h[q]))
        assert client.get("/api/reportes/resumen", headers=m.h[q]).json()["gastos"] == 0
    # el dueno lo sigue viendo y cuenta en sus totales
    assert client.get("/api/reportes/resumen", headers=d).json()["gastos"] == 123.45
    # version vieja del dueno: 409 (el dueno si puede ver el registro)
    assert client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=d, json={"visibilidad": "familia", "version_base": antes["version"]}).status_code == 409


def test_cambiar_visibilidad_deja_historial_que_solo_ve_el_dueno(client):
    m = construir(client, "familia")
    d = m.h["dueno"]
    client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=d, json={"visibilidad": "elegidas", "compartido_con": [m.uid["admin"], m.uid["otro"]]})
    cadena = f"/api/historial?entidad=movimiento&entidad_id={m.mov}"
    del_dueno = [i["accion"] for i in client.get(cadena, headers=d).json()["items"]]
    assert del_dueno == ["crear", "cambiar_visibilidad"]
    # una persona con la que se comparto ve el registro y su cadena, pero NO la entrada de visibilidad
    assert [i["accion"] for i in client.get(cadena, headers=m.h["otro"]).json()["items"]] == ["crear"]
    # el admin (con quien se comparte) tampoco la ve en la actividad global ni en la bitacora
    glob = client.get("/api/historial?limite=100", headers=m.h["admin"]).json()["items"]
    assert "cambiar_visibilidad" not in {i["accion"] for i in glob}
    bit = client.get("/api/bitacora?origen=datos&limite=100", headers=m.h["admin"]).json()["items"]
    assert "cambiar_visibilidad" not in {i["evento"] for i in bit}
    # el cambio a 'solo_yo' hace que la cadena entera desaparezca para los demas
    client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=d, json={"visibilidad": "solo_yo"})
    assert client.get(cadena, headers=m.h["otro"]).status_code == 404
    entradas = [i for i in client.get(cadena, headers=d).json()["items"] if i["accion"] == "cambiar_visibilidad"]
    assert entradas[-1]["cambios"]["visibilidad"] == {"antes": "elegidas", "despues": "solo_yo"}


def test_historial_con_la_visibilidad_actual_no_la_de_cuando_se_escribio(client):
    """Un registro que fue privado y ahora es de la familia muestra TODA su cadena (menos la entrada de visibilidad)."""
    m = construir(client, "solo_yo")
    d = m.h["dueno"]
    client.patch(f"/api/movimientos/{m.mov}", headers=d, json={"monto": 200})
    client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=d, json={"visibilidad": "familia"})
    acciones = [i["accion"] for i in client.get(f"/api/historial?entidad=movimiento&entidad_id={m.mov}", headers=m.h["admin"]).json()["items"]]
    assert acciones == ["crear", "editar"]


# ---------------------------------------------------------------- devoluciones heredan
def test_las_devoluciones_heredan_la_visibilidad_del_apoyo(client):
    m = construir(client, "elegidas")
    e, o, a = m.h["elegido"], m.h["otro"], m.h["admin"]
    apoyo = client.get(f"/api/apoyos/{m.apo}", headers=e).json()
    assert [d["id"] for d in apoyo["devoluciones"]] == [m.dev]
    assert client.get(f"/api/historial?entidad=devolucion&entidad_id={m.dev}", headers=e).status_code == 200
    for q in (o, a):
        assert client.get(f"/api/historial?entidad=devolucion&entidad_id={m.dev}", headers=q).status_code == 404
        assert client.patch(f"/api/apoyos/{m.apo}/devoluciones/{m.dev}", headers=q, json={"nota": "x"}).status_code == 404
    # al volverlo 'familia' las devoluciones se ven para todos; al volverlo 'solo_yo' desaparecen con el apoyo
    client.patch(f"/api/apoyos/{m.apo}/visibilidad", headers=m.h["dueno"], json={"visibilidad": "familia"})
    assert client.get(f"/api/historial?entidad=devolucion&entidad_id={m.dev}", headers=o).status_code == 200
    client.patch(f"/api/apoyos/{m.apo}/visibilidad", headers=m.h["dueno"], json={"visibilidad": "solo_yo"})
    assert client.get(f"/api/historial?entidad=devolucion&entidad_id={m.dev}", headers=o).status_code == 404
    assert "SECRETO-dev" not in client.get("/api/apoyos?ver_anulados=true", headers=o).text


def test_en_un_apoyo_de_la_familia_cualquiera_registra_devolucion(client):
    """(en uno privado o compartido con personas solo su dueno: lo cubre la matriz)"""
    m = construir(client, "familia")
    assert client.post(f"/api/apoyos/{m.apo}/devoluciones", headers=m.h["otro"], json={"monto": 10}).status_code == 201


# ---------------------------------------------------------------- aplicar la preferencia a los anteriores
def test_preferencia_por_defecto_y_aplicar_a_los_anteriores(client):
    m = construir(client, "familia")
    d = m.h["dueno"]
    assert client.get("/api/auth/yo", headers=d).json()["visibilidad_defecto"] == "familia"
    p = client.get("/api/privacidad", headers=d).json()
    assert p == {"visibilidad_defecto": "familia", "registros_distintos": 0}
    # cambiar la preferencia NO toca lo anterior
    assert client.patch("/api/privacidad", headers=d, json={"visibilidad_defecto": "solo_yo"}).json() == {
        "visibilidad_defecto": "solo_yo", "registros_distintos": 2}
    assert client.get(f"/api/movimientos/{m.mov}", headers=m.h["otro"]).status_code == 200
    # un registro nuevo hereda la preferencia; el usuario puede cambiarla en el momento
    nuevo = gasto(client, d, m.cat, 5)
    assert nuevo["visibilidad"] == "solo_yo"
    assert gasto(client, d, m.cat, 6, visibilidad="familia")["visibilidad"] == "familia"
    # aplicar exige confirmacion explicita y que la cantidad coincida
    assert client.post("/api/privacidad/aplicar-defecto", headers=d, json={}).status_code == 400
    r = client.post("/api/privacidad/aplicar-defecto", headers=d, json={"confirmar": True, "cantidad": 99})
    assert r.status_code == 409
    n = client.get("/api/privacidad", headers=d).json()["registros_distintos"]
    assert n == 3  # el gasto, el apoyo y el gasto nuevo en 'familia'
    r = client.post("/api/privacidad/aplicar-defecto", headers=d, json={"confirmar": True, "cantidad": n})
    assert r.status_code == 200 and r.json() == {"afectados": 3, "visibilidad": "solo_yo"}
    assert client.get("/api/privacidad", headers=d).json()["registros_distintos"] == 0
    assert client.get(f"/api/movimientos/{m.mov}", headers=m.h["otro"]).status_code == 404
    assert client.get(f"/api/apoyos/{m.apo}", headers=m.h["admin"]).status_code == 404
    # solo toca lo del propio usuario
    otro_mov = gasto(client, m.h["otro"], m.cat, 7)
    assert client.get(f"/api/movimientos/{otro_mov['id']}", headers=m.h["admin"]).status_code == 200
    with SesionTest() as db:
        n_hist = len(list(db.scalars(select(Historial).where(Historial.accion == "cambiar_visibilidad"))))
    assert n_hist == 3


def test_aplicar_el_defecto_familia_a_lo_privado(client):
    m = construir(client, "solo_yo")
    d = m.h["dueno"]
    r = client.post("/api/privacidad/aplicar-defecto", headers=d, json={"confirmar": True})
    assert r.status_code == 200 and r.json()["afectados"] == 2
    assert client.get(f"/api/movimientos/{m.mov}", headers=m.h["otro"]).status_code == 200


def test_las_preferencias_validas(client):
    m = construir(client, "familia")
    assert client.patch("/api/privacidad", headers=m.h["dueno"], json={"visibilidad_defecto": "elegidas"}).status_code == 422
    assert client.patch("/api/privacidad", headers=m.h["dueno"], json={"visibilidad_defecto": "x"}).status_code == 422
    assert client.patch("/api/privacidad", headers=m.h["dueno"], json={}).status_code == 422


# ---------------------------------------------------------------- con quien se puede compartir
def test_solo_se_comparte_con_miembros_activos_de_la_misma_familia(client):
    m = construir(client, "familia")
    d = m.h["dueno"]
    url = f"/api/movimientos/{m.mov}/visibilidad"
    assert client.patch(url, headers=d, json={"visibilidad": "elegidas", "compartido_con": [m.uid["ajeno"]]}).status_code == 422
    assert client.patch(url, headers=d, json={"visibilidad": "elegidas", "compartido_con": []}).status_code == 422
    assert client.patch(url, headers=d, json={"visibilidad": "elegidas"}).status_code == 422
    assert client.patch(url, headers=d, json={"visibilidad": "elegidas", "compartido_con": [m.uid["dueno"]]}).status_code == 422
    assert client.patch(url, headers=d, json={"visibilidad": "elegidas", "compartido_con": [999999]}).status_code == 422
    with SesionTest() as db:
        db.execute(update(Miembro).where(Miembro.usuario_id == m.uid["otro"]).values(activo=False))
        db.commit()
    assert client.patch(url, headers=d, json={"visibilidad": "elegidas", "compartido_con": [m.uid["otro"]]}).status_code == 422
    # no cambio nada
    assert client.get(f"/api/movimientos/{m.mov}", headers=d).json()["visibilidad"] == "familia"


# ---------------------------------------------------------------- usuario desactivado
def test_si_el_dueno_se_desactiva_lo_oculto_sigue_oculto(client):
    m = construir(client, "solo_yo")
    gasto_familia = gasto(client, m.h["dueno"], m.cat, 9, visibilidad="familia")
    r = client.patch(f"/api/familia/miembros/{m.uid['dueno']}", headers=m.h["admin"], json={"activo": False})
    assert r.status_code == 200
    assert client.get(f"/api/movimientos/{m.mov}", headers=m.h["admin"]).status_code == 404
    assert m.mov not in ids_de(client.get("/api/movimientos?limite=100", headers=m.h["admin"]))
    assert client.get("/api/reportes/resumen", headers=m.h["admin"]).json()["gastos"] == 9  # solo lo de la familia
    assert client.get(f"/api/movimientos/{gasto_familia['id']}", headers=m.h["otro"]).status_code == 200
    # su sesion ya no sirve
    assert client.get("/api/movimientos", headers=m.h["dueno"]).status_code == 401


def test_lo_compartido_con_elegidos_sigue_visible_si_el_dueno_se_desactiva(client):
    m = construir(client, "elegidas")
    client.patch(f"/api/familia/miembros/{m.uid['dueno']}", headers=m.h["admin"], json={"activo": False})
    assert client.get(f"/api/movimientos/{m.mov}", headers=m.h["elegido"]).status_code == 200
    assert client.get(f"/api/movimientos/{m.mov}", headers=m.h["admin"]).status_code == 404


# ---------------------------------------------------------------- 409 sin fuga
def test_el_409_no_devuelve_datos_que_el_usuario_ya_no_puede_ver(client):
    m = construir(client, "familia")
    vista_admin = client.get(f"/api/movimientos/{m.mov}", headers=m.h["admin"]).json()
    client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=m.h["dueno"], json={"visibilidad": "solo_yo"})
    client.patch(f"/api/apoyos/{m.apo}/visibilidad", headers=m.h["dueno"], json={"visibilidad": "solo_yo"})
    # el admin edita con la version que conocia: 404 (no un 409 con el registro actual dentro)
    for ruta, cuerpo, verbo in (
        (f"/api/movimientos/{m.mov}", {"nota": "x", "version_base": vista_admin["version"]}, "patch"),
        (f"/api/movimientos/{m.mov}/anular", {"version_base": vista_admin["version"]}, "post"),
        (f"/api/apoyos/{m.apo}/anular", {"version_base": 1}, "post"),
    ):
        r = getattr(client, verbo)(ruta, headers=m.h["admin"], json=cuerpo)
        assert r.status_code == 404 and "SECRETO" not in r.text and "123.45" not in r.text
    # alguien con quien se comparte no puede editar: 403 aunque mande una version vieja, sin datos del registro
    client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=m.h["dueno"], json={"visibilidad": "elegidas", "compartido_con": [m.uid["elegido"]]})
    r = client.patch(f"/api/movimientos/{m.mov}", headers=m.h["elegido"], json={"nota": "x", "version_base": 1})
    assert r.status_code == 403 and "SECRETO" not in r.text and "123.45" not in r.text
    # y el 409 para un editor legitimo sigue funcionando
    r = client.patch(f"/api/movimientos/{m.mov}", headers=m.h["dueno"], json={"nota": "x", "version_base": 1})
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "conflicto_version"


# ---------------------------------------------------------------- la bitacora no guarda montos ni nombres ajenos
def test_el_detalle_de_las_sincronizaciones_rechazadas_no_lleva_montos_ni_nombres(client):
    m = construir(client, "familia")
    h = {**m.h["dueno"], "X-Operacion-Id": str(uuid.uuid4())}
    # regla de negocio: la devolucion supera lo pendiente (el mensaje del servidor menciona un monto)
    r = client.post(f"/api/apoyos/{m.apo}/devoluciones", headers=h, json={"monto": 5000})
    assert r.status_code == 400 and "Bs" in r.text
    # otro registro que no ve: 404 con operacion
    r2 = client.patch(f"/api/movimientos/{m.mov}", headers={**m.h["ajeno"], "X-Operacion-Id": str(uuid.uuid4())}, json={"nota": "x"})
    assert r2.status_code == 404
    with SesionTest() as db:
        filas = list(db.scalars(select(Bitacora).where(Bitacora.evento == "sincronizacion_rechazada")))
    assert len(filas) == 2
    for f in filas:
        texto = str(f.detalle)
        assert not re.search(r"\d+\.\d\d", texto), texto  # ningun monto
        assert "Bs" not in texto and "Benef-Secreto" not in texto and "SECRETO" not in texto
        assert set(f.detalle) <= {"ruta", "metodo", "status", "motivo", "campos"}


# ---------------------------------------------------------------- bitacora: exportacion y paginacion filtradas
def test_el_csv_de_la_bitacora_y_la_paginacion_no_filtran_lo_privado_al_admin(client):
    m = construir(client, "solo_yo")
    for _ in range(4):
        gasto(client, m.h["otro"], m.cat, 11)
    csv = client.get("/api/bitacora/exportar.csv", headers=m.h["admin"]).text
    assert "123.45" not in csv and "Benef-Secreto" not in csv and "777.77" not in csv
    pagina, cursor, vistos = None, None, []
    while True:
        url = "/api/bitacora?origen=datos&limite=2" + (f"&cursor={cursor}" if cursor else "")
        pagina = client.get(url, headers=m.h["admin"]).json()
        vistos += [i["clave"] for i in pagina["items"]]
        assert "123.45" not in str(pagina) and "Benef-Secreto" not in str(pagina)
        cursor = pagina["siguiente"]
        if not pagina["hay_mas"]:
            break
    assert len(vistos) == len(set(vistos))  # sin repetidos aunque se filtre


# ---------------------------------------------------------------- creacion offline con visibilidad
def test_crear_con_uuid_es_idempotente_y_conserva_la_visibilidad(client):
    m = construir(client, "familia")
    d = m.h["dueno"]
    u = str(uuid.uuid4())
    cuerpo = {"tipo": "gasto", "monto": 8, "categoria_id": m.cat, "uuid_cliente": u, "visibilidad": "elegidas", "compartido_con": [m.uid["elegido"]]}
    a = client.post("/api/movimientos", headers=d, json=cuerpo)
    b = client.post("/api/movimientos", headers=d, json=cuerpo)
    assert a.status_code == 201 and b.status_code == 200 and a.json()["id"] == b.json()["id"]
    assert b.json()["visibilidad"] == "elegidas" and b.json()["compartido_con"] == [m.uid["elegido"]]
    # el UUID de otra persona que no puedes ver no revela el registro
    r = client.post("/api/movimientos", headers=m.h["admin"], json={**cuerpo, "compartido_con": []})
    assert r.status_code == 409 and "8" not in r.json()["detail"]


def test_editar_incluye_cambiar_la_visibilidad_en_la_misma_operacion(client):
    m = construir(client, "familia")
    d = m.h["dueno"]
    r = client.patch(f"/api/movimientos/{m.mov}", headers={**d, "X-Operacion-Id": str(uuid.uuid4())},
                     json={"monto": 50, "visibilidad": "elegidas", "compartido_con": [m.uid["otro"]]})
    assert r.status_code == 200
    assert r.json()["monto"] == 50 and r.json()["visibilidad"] == "elegidas"
    assert client.get(f"/api/movimientos/{m.mov}", headers=m.h["otro"]).status_code == 200
    assert client.get(f"/api/movimientos/{m.mov}", headers=m.h["elegido"]).status_code == 404
    # un miembro que ve el registro no puede cambiar su visibilidad por la ruta de edicion
    r = client.patch(f"/api/movimientos/{m.mov}", headers=m.h["otro"], json={"visibilidad": "familia"})
    assert r.status_code == 403
    # cambiar solo la visibilidad de algo anulado esta permitido
    client.post(f"/api/movimientos/{m.mov}/anular", headers=d, json={})
    assert client.patch(f"/api/movimientos/{m.mov}/visibilidad", headers=d, json={"visibilidad": "solo_yo"}).status_code == 200


def test_todo_lo_existente_es_familia(client):
    """Registros sin visibilidad (como los anteriores a la Fase 17) son de la familia."""
    m = construir(client, "familia")
    r = client.post("/api/movimientos", headers=m.h["dueno"], json={"tipo": "ingreso", "monto": 3})
    assert r.json()["visibilidad"] == "familia"
    assert client.get(f"/api/movimientos/{r.json()['id']}", headers=m.h["ajeno"]).status_code == 404  # otra familia, siempre
    assert client.get(f"/api/movimientos/{r.json()['id']}", headers=m.h["otro"]).status_code == 200


def test_devolucion_con_uuid_repetido_en_un_apoyo_ajeno_no_revela_nada(client):
    """Un UUID de devolucion ya usado en OTRO apoyo (que no ves) responde 409 generico, sin datos de ese apoyo."""
    m = construir(client, "solo_yo")
    d = m.h["dueno"]
    u = str(uuid.uuid4())
    r = client.post(f"/api/apoyos/{m.apo}/devoluciones", headers=d, json={"monto": 3, "uuid_cliente": u})
    assert r.status_code == 201, r.text
    # el admin tiene su propio apoyo de la familia y reutiliza (por error o a proposito) el UUID de la devolucion privada
    propio = client.post("/api/apoyos", headers=m.h["admin"], json={"beneficiario": "Mio", "monto": 50, "visibilidad": "familia"})
    assert propio.status_code == 201, propio.text
    r = client.post(
        f"/api/apoyos/{propio.json()['id']}/devoluciones", headers=m.h["admin"], json={"monto": 3, "uuid_cliente": u}
    )
    assert r.status_code == 409, r.text
    assert "Secreto" not in r.text and "SECRETO" not in r.text
    # y el dueno repitiendo SU operacion sigue siendo idempotente
    r = client.post(f"/api/apoyos/{m.apo}/devoluciones", headers=d, json={"monto": 3, "uuid_cliente": u})
    assert r.status_code == 200, r.text
