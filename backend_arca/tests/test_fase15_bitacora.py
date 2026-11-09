"""Fase 15: bitacora unificada (accesos y seguridad + cambios de datos del historial)."""
import csv
import io
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.main import app
from app.modulos.bitacora import registro
from app.modulos.bitacora.models import Bitacora
from app.modulos.historial.models import Historial
from tests.conftest import SesionTest, engine_test, registrar

UTC = timezone.utc
AGENTE = "Mozilla/5.0 (Pruebas) Arca/1.0"


# ---------------------------------------------------------------- ayudas
def filas(**filtro) -> list[Bitacora]:
    with SesionTest() as db:
        q = select(Bitacora).order_by(Bitacora.id)
        for k, v in filtro.items():
            q = q.where(getattr(Bitacora, k) == v)
        return list(db.scalars(q))


def eventos(**filtro) -> list[str]:
    return [f.evento for f in filas(**filtro)]


def op(h, **extra):
    return {**h, "X-Operacion-Id": str(uuid.uuid4()), **extra}


def yo(client, h) -> dict:
    return client.get("/api/auth/yo", headers=h).json()


def login(client, email, clave="secreto1", **h):
    return client.post("/api/auth/login", json={"email": email, "password": clave}, headers={"User-Agent": AGENTE, **h})


def bit(client, h, **params):
    r = client.get("/api/bitacora", headers=h, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def gasto(client, h, cat, monto=50, **extra):
    r = client.post("/api/movimientos", headers=h, json={"tipo": "gasto", "monto": monto, "categoria_id": cat, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def insertar(familia_id, evento="login_ok", fecha=None, usuario_id=None, correo=None, ip="9.9.9.9", resultado="ok",
             dispositivo=None, detalle=None):
    with SesionTest() as db:
        db.add(Bitacora(
            familia_id=familia_id, usuario_id=usuario_id, correo_intentado=correo, evento=evento, resultado=resultado,
            ip=ip, dispositivo=dispositivo, fecha=fecha or datetime.now(UTC), detalle=detalle or {},
        ))
        db.commit()


# ---------------------------------------------------------------- cada evento deja su entrada
def test_registro_deja_su_entrada(client):
    h = registrar(client, email="Ana@T.com", nombre="Ana")
    f = filas(evento="registro")
    assert len(f) == 1 and f[0].resultado == "ok"
    assert f[0].usuario_id == yo(client, h)["id"] and f[0].familia_id == yo(client, h)["familia_id"]


def test_login_ok_y_fallido_con_ip_y_dispositivo(client, admin):
    assert login(client, "admin@t.com").status_code == 200
    ok = filas(evento="login_ok")[0]
    assert ok.resultado == "ok" and ok.correo_intentado == "admin@t.com"
    assert ok.ip == "testclient" and ok.dispositivo == AGENTE and ok.familia_id and ok.usuario_id
    assert (ok.fecha - datetime.now(UTC)).total_seconds() < 60 and ok.fecha.tzinfo is not None

    assert login(client, "ADMIN@t.com", "mala-clave").status_code == 401  # correo existente, clave mala
    assert login(client, "Nadie@Nada.com", "mala-clave").status_code == 401  # correo que no existe
    f = filas(evento="login_fallido")
    assert [x.resultado for x in f] == ["fallo", "fallo"]
    existente, inexistente = f
    assert existente.correo_intentado == "admin@t.com" and existente.usuario_id and existente.familia_id
    assert existente.detalle == {"motivo": "clave_incorrecta"}
    assert inexistente.correo_intentado == "nadie@nada.com"  # en minusculas
    assert inexistente.usuario_id is None and inexistente.familia_id is None
    assert inexistente.detalle == {"motivo": "usuario_inexistente"}


def test_dispositivo_se_recorta_a_200_caracteres(client, admin):
    login(client, "admin@t.com", **{"User-Agent": "X" * 500})
    assert len(filas(evento="login_ok")[-1].dispositivo) == 200


def test_la_ip_sale_del_socket_y_no_de_x_forwarded_for(client, admin):
    """La IP real la resuelve uvicorn con FORWARDED_ALLOW_IPS; la app jamas lee X-Forwarded-For a mano."""
    login(client, "admin@t.com", **{"X-Forwarded-For": "6.6.6.6", "X-Real-IP": "7.7.7.7"})
    assert filas(evento="login_ok")[-1].ip == "testclient"


def test_login_bloqueado_por_limite_de_intentos(client, admin):
    for _ in range(5):
        assert login(client, "admin@t.com", "mala-clave").status_code == 401
    assert login(client, "admin@t.com", "secreto1").status_code == 429  # bloquea hasta la clave correcta
    b = filas(evento="login_bloqueado")
    assert len(b) == 1 and b[0].resultado == "fallo" and b[0].usuario_id and b[0].correo_intentado == "admin@t.com"
    assert b[0].detalle["espera_segundos"] > 0
    # un ataque insistente no llena la bitacora: otro intento bloqueado en el mismo minuto no agrega fila
    assert login(client, "admin@t.com", "secreto1").status_code == 429
    assert len(filas(evento="login_bloqueado")) == 1


def test_logout(client, admin):
    assert client.post("/api/auth/logout", headers=admin).status_code == 204
    f = filas(evento="logout")
    assert len(f) == 1 and f[0].resultado == "ok" and f[0].usuario_id and f[0].familia_id
    assert client.post("/api/auth/logout").status_code == 401  # sin sesion no hay logout


def test_cambio_de_clave_ok_y_fallido(client, admin):
    r = client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "equivocada", "clave_nueva": "Nueva12345"})
    assert r.status_code == 400
    assert eventos() .count("cambio_clave_fallido") == 1 and filas(evento="cambio_clave_fallido")[0].resultado == "fallo"
    r = client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "secreto1", "clave_nueva": "Nueva12345"})
    assert r.status_code == 204
    ok = filas(evento="cambio_clave_ok")
    assert len(ok) == 1 and ok[0].resultado == "ok" and ok[0].usuario_id


def test_eventos_de_miembros_rol_desactivar_reactivar_y_restablecer(client, admin, miembro):
    uid = next(m["usuario_id"] for m in client.get("/api/familia/miembros", headers=admin).json() if m["email"] == "m@t.com")
    adm = yo(client, admin)["id"]
    assert client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"rol": "admin"}).status_code == 200
    assert client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"activo": False}).status_code == 200
    assert client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"activo": True}).status_code == 200
    assert client.post(f"/api/familia/miembros/{uid}/restablecer-clave", headers=admin).status_code == 200
    rol = filas(evento="cambio_rol")[0]
    assert rol.usuario_id == adm and rol.detalle["objetivo_id"] == uid
    assert (rol.detalle["rol_antes"], rol.detalle["rol_despues"]) == ("miembro", "admin")
    assert len(filas(evento="usuario_desactivado")) == 1 and len(filas(evento="usuario_reactivado")) == 1
    assert len(filas(evento="restablecer_clave")) == 1
    # un PATCH sin cambio real no registra nada
    antes = len(filas())
    client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"rol": "admin", "activo": True})
    assert len(filas()) == antes


def test_acceso_denegado_por_permisos(client, admin, miembro):
    r = client.get("/api/bitacora", headers=miembro)
    assert r.status_code == 403
    f = filas(evento="acceso_denegado")
    assert len(f) == 1 and f[0].resultado == "fallo" and f[0].usuario_id == yo(client, miembro)["id"]
    assert f[0].detalle["ruta"] == "/api/bitacora" and f[0].detalle["status"] == 403
    # tambien lo ve el admin en la pantalla
    assert any(i["evento"] == "acceso_denegado" for i in bit(client, admin)["items"])


def test_acceso_denegado_de_usuario_desactivado_en_login_y_con_token_viejo(client, admin, miembro):
    uid = yo(client, miembro)["id"]
    client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"activo": False})
    entradas_antes = len(filas(evento="login_ok", usuario_id=uid))
    r = login(client, "m@t.com")
    assert r.status_code == 403
    d = filas(evento="acceso_denegado")
    assert len(d) == 1 and d[0].usuario_id == uid and d[0].detalle["motivo"] == "usuario_desactivado"  # una sola vez
    assert len(filas(evento="login_ok", usuario_id=uid)) == entradas_antes  # entrar desactivado no es un login_ok
    # con el token anterior (401 "cuenta desactivada")
    assert client.get("/api/auth/yo", headers=miembro).status_code == 401
    assert len(filas(evento="acceso_denegado")) == 2


def test_token_invalido_o_vencido_como_mucho_uno_por_ip_cada_minuto(client, admin):
    mal = {"Authorization": "Bearer esto.no.es.un.jwt"}
    for _ in range(4):
        assert client.get("/api/auth/yo", headers=mal).status_code == 401
    t = filas(evento="token_invalido")
    assert len(t) == 1 and t[0].resultado == "fallo" and t[0].ip == "testclient" and t[0].detalle["motivo"] == "invalido"
    # sin cabecera Authorization no es un token invalido: no se registra
    registro.reiniciar()
    assert client.get("/api/auth/yo").status_code == 401
    assert len(filas(evento="token_invalido")) == 1
    # vencido
    from jose import jwt
    from app.core.config import settings

    vencido = jwt.encode({"sub": "1", "exp": datetime.now(UTC) - timedelta(hours=1)}, settings.jwt_secret, algorithm="HS256")
    registro.reiniciar()
    assert client.get("/api/auth/yo", headers={"Authorization": f"Bearer {vencido}"}).status_code == 401
    assert filas(evento="token_invalido")[-1].detalle["motivo"] == "vencido"
    # pasado el minuto vuelve a registrar (se simula quitando la marca)
    registro.reiniciar()
    client.get("/api/auth/yo", headers=mal)
    assert len(filas(evento="token_invalido")) == 3


def test_sincronizacion_rechazada_por_403_409_y_regla_de_negocio(client, admin, miembro, categoria_id):
    m = gasto(client, admin, categoria_id, 50)
    # 403: un miembro intenta editar lo del admin desde la cola
    r = client.patch(f"/api/movimientos/{m['id']}", headers=op(miembro), json={"monto": 1, "version_base": m["version"]})
    assert r.status_code == 403
    # 409: version vieja
    client.patch(f"/api/movimientos/{m['id']}", headers=op(admin), json={"monto": 60, "version_base": m["version"]})
    r = client.patch(f"/api/movimientos/{m['id']}", headers=op(admin), json={"monto": 70, "version_base": m["version"]})
    assert r.status_code == 409
    # regla de negocio: devolucion mayor al pendiente (400)
    a = client.post("/api/apoyos", headers=admin, json={"beneficiario": "Tia", "monto": 10}).json()
    r = client.post(f"/api/apoyos/{a['id']}/devoluciones", headers=op(admin), json={"monto": 999})
    assert r.status_code == 400
    # datos invalidos (422)
    r = client.post("/api/movimientos", headers=op(admin), json={"tipo": "gasto", "monto": -5, "categoria_id": categoria_id})
    assert r.status_code == 422
    estados = [f.detalle["status"] for f in filas(evento="sincronizacion_rechazada")]
    assert sorted(estados) == [400, 403, 409, 422]
    assert all(f.resultado == "fallo" for f in filas(evento="sincronizacion_rechazada"))
    # el 403 tambien es un acceso denegado
    assert len(filas(evento="acceso_denegado")) == 1
    # lo que NO viene de la cola (sin X-Operacion-Id) no es una sincronizacion rechazada
    n = len(filas(evento="sincronizacion_rechazada"))
    client.post(f"/api/apoyos/{a['id']}/devoluciones", headers=admin, json={"monto": 999})
    assert len(filas(evento="sincronizacion_rechazada")) == n
    # el detalle no guarda el cuerpo ni el registro del servidor (409)
    for f in filas(evento="sincronizacion_rechazada"):
        assert set(f.detalle) <= registro.DETALLE_PERMITIDO and "actual" not in json.dumps(f.detalle)


# ---------------------------------------------------------------- solo agregar
def test_la_base_impide_editar_y_borrar_la_bitacora(client, admin):
    login(client, "admin@t.com")
    n = len(filas())
    assert n > 0
    for sql in ("UPDATE bitacora SET evento = 'trampa'", "UPDATE bitacora SET ip = '0.0.0.0' WHERE id = 1",
                "DELETE FROM bitacora", "DELETE FROM bitacora WHERE id = 1"):
        with engine_test.begin() as c:
            with pytest.raises(DBAPIError, match="solo agregar"):
                c.execute(text(sql))
    assert len(filas()) == n and all(f.evento != "trampa" for f in filas())


def test_ninguna_ruta_edita_ni_borra_la_bitacora(client, admin):
    rutas = [r for r in app.routes if "bitacora" in getattr(r, "path", "")]
    assert len(rutas) >= 3
    for r in rutas:
        assert getattr(r, "methods", set()) <= {"GET", "HEAD"}, (r.path, r.methods)
    for metodo in (client.post, client.put, client.patch, client.delete):
        assert metodo("/api/bitacora", headers=admin).status_code == 405
        assert metodo("/api/bitacora/1", headers=admin).status_code in (404, 405)
    assert client.delete("/api/bitacora/resumen", headers=admin).status_code == 405


# ---------------------------------------------------------------- sin secretos
def test_ninguna_columna_ni_detalle_contiene_claves_hashes_ni_tokens(client, admin, miembro):
    uid = yo(client, miembro)["id"]
    r = login(client, "admin@t.com")
    token = r.json()["access_token"]
    login(client, "admin@t.com", "ClaveEquivocada77")
    client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "NoEsLaClave1", "clave_nueva": "OtraClave789"})
    client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "secreto1", "clave_nueva": "ClaveNueva555"})
    temporal = client.post(f"/api/familia/miembros/{uid}/restablecer-clave", headers=admin).json()["clave_temporal"]
    client.get("/api/auth/yo", headers={"Authorization": "Bearer abc.def.ghi"})
    client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    client.get("/api/bitacora", headers=miembro)
    with SesionTest() as db:
        volcado = json.dumps(
            [
                [str(getattr(f, c.name)) for c in Bitacora.__table__.columns]
                for f in db.scalars(select(Bitacora))
            ]
        )
    for prohibido in ("secreto1", "ClaveEquivocada77", "NoEsLaClave1", "OtraClave789", "ClaveNueva555", temporal, token,
                      "$2b$", "$2a$", "eyJ", "password", "Bearer"):
        assert prohibido not in volcado, prohibido
    # y por la API (pantalla y CSV) tampoco
    api = json.dumps(bit(client, admin, limite=100)) + client.get("/api/bitacora/exportar.csv", headers=admin).text
    for prohibido in ("secreto1", "ClaveEquivocada77", "ClaveNueva555", temporal, token, "$2b$", "eyJ"):
        assert prohibido not in api, prohibido


def test_el_correo_intentado_solo_se_guarda_si_parece_un_correo():
    assert registro._correo("  Ana@Correo.COM ") == "ana@correo.com"
    assert registro._correo("mi-clave-secreta") is None  # alguien escribio su clave en el campo del correo
    assert registro._correo("con espacios@x.com") is None
    assert registro._correo(None) is None


def test_el_detalle_descarta_llaves_no_permitidas_y_recorta_textos():
    d = registro.limpiar_detalle({"password": "x", "token": "y", "motivo": "m" * 1000, "ruta": "/api/x", "cuerpo": {"a": 1}})
    assert set(d) == {"motivo", "ruta"} and len(d["motivo"]) == registro.MAX_TEXTO


# ---------------------------------------------------------------- GET /bitacora: permisos y aislamiento
def test_solo_el_admin_ve_la_bitacora(client, admin, miembro):
    for ruta in ("/api/bitacora", "/api/bitacora/resumen", "/api/bitacora/exportar.csv"):
        assert client.get(ruta, headers=admin).status_code == 200, ruta
        assert client.get(ruta, headers=miembro).status_code == 403, ruta
        assert client.get(ruta).status_code == 401, ruta


def test_aislamiento_entre_familias(client, admin, categoria_id):
    gasto(client, admin, categoria_id, 11)
    login(client, "admin@t.com")
    otro = registrar(client, email="otro@t.com", nombre="Otro", familia="Otra")
    login(client, "otro@t.com")
    login(client, "admin@t.com", "mala-clave")
    propios = bit(client, otro, limite=100)["items"]
    assert propios and all(i["usuario_nombre"] == "Otro" or i["usuario_nombre"] is None for i in propios)
    textos = json.dumps(propios) + client.get("/api/bitacora/exportar.csv", headers=otro).text
    assert "admin@t.com" not in textos and "Admin" not in textos and "Bs 11.00" not in textos
    assert json.dumps(client.get("/api/bitacora/resumen", headers=otro).json()).count("Admin") == 0
    # y al reves
    assert "otro@t.com" not in json.dumps(bit(client, admin, limite=100))


def test_eventos_sin_familia_solo_los_ve_el_admin_cuando_el_correo_es_de_su_familia(client, admin, miembro):
    fam = yo(client, admin)["familia_id"]
    # login fallido de un correo que no existe: sin familia ni usuario -> no lo ve nadie
    login(client, "fantasma@x.com", "mala-clave")
    f = filas(evento="login_fallido")[-1]
    assert f.familia_id is None and f.usuario_id is None
    assert all(i["correo_intentado"] != "fantasma@x.com" for i in bit(client, admin, limite=100)["items"])
    # fila sin familia cuyo correo intentado es de un miembro de la familia: la ve el admin de esa familia
    insertar(None, "login_fallido", correo="m@t.com", resultado="fallo", ip="5.5.5.5")
    visibles = [i for i in bit(client, admin, limite=100)["items"] if i["ip"] == "5.5.5.5"]
    assert len(visibles) == 1
    # ...pero no el de otra familia
    otro = registrar(client, email="otro@t.com", familia="Otra")
    assert all(i["ip"] != "5.5.5.5" for i in bit(client, otro, limite=100)["items"])
    assert fam


# ---------------------------------------------------------------- filtros
def test_filtros(client, admin, miembro, categoria_id):
    adm = yo(client, admin)["id"]
    mie = yo(client, miembro)["id"]
    m = gasto(client, admin, categoria_id, 50)
    client.post(f"/api/movimientos/{m['id']}/anular", headers=admin, json={"motivo": "duplicado"})
    login(client, "admin@t.com", **{"X-Forwarded-For": "1.1.1.1"})
    login(client, "m@t.com", "mala-clave")

    todos = bit(client, admin, limite=100)["items"]
    assert {i["origen"] for i in todos} == {"acceso", "datos"}
    assert all(i["origen"] == "datos" for i in bit(client, admin, origen="datos", limite=100)["items"])
    assert all(i["origen"] == "acceso" for i in bit(client, admin, origen="acceso", limite=100)["items"])
    # evento: de acceso y accion de datos
    assert {i["evento"] for i in bit(client, admin, evento="login_fallido", limite=100)["items"]} == {"login_fallido"}
    anul = bit(client, admin, evento="anular", limite=100)["items"]
    assert [i["origen"] for i in anul] == ["datos"] and anul[0]["evento"] == "anular"
    # resultado: el historial solo tiene "ok"
    fallos = bit(client, admin, resultado="fallo", limite=100)["items"]
    assert fallos and all(i["resultado"] == "fallo" and i["origen"] == "acceso" for i in fallos)
    assert all(i["resultado"] == "ok" for i in bit(client, admin, resultado="ok", limite=100)["items"])
    # persona
    de_mie = bit(client, admin, persona=mie, limite=100)["items"]
    assert de_mie and all(i["usuario_id"] == mie for i in de_mie)
    assert any(i["evento"] == "login_fallido" for i in de_mie)
    assert any(i["origen"] == "datos" for i in bit(client, admin, persona=adm, limite=100)["items"])
    # ip: solo accesos
    por_ip = bit(client, admin, ip="testclient", limite=100)["items"]
    assert por_ip and all(i["origen"] == "acceso" and i["ip"] == "testclient" for i in por_ip)
    assert bit(client, admin, ip="8.8.8.8")["items"] == []


def test_filtro_por_rango_de_fechas(client, admin, categoria_id):
    fam = yo(client, admin)["familia_id"]
    ahora = datetime.now(UTC)
    insertar(fam, "login_ok", fecha=ahora - timedelta(days=10), ip="10.0.0.1")
    insertar(fam, "login_ok", fecha=ahora - timedelta(days=3), ip="10.0.0.3")
    d = lambda dias: (ahora - timedelta(days=dias)).date().isoformat()  # noqa: E731
    ips = lambda **p: sorted(i["ip"] for i in bit(client, admin, origen="acceso", limite=100, **p)["items"] if i["ip"] and i["ip"].startswith("10."))  # noqa: E731
    assert ips() == ["10.0.0.1", "10.0.0.3"]
    assert ips(desde=d(5)) == ["10.0.0.3"]
    assert ips(hasta=d(5)) == ["10.0.0.1"]
    assert ips(desde=d(4), hasta=d(2)) == ["10.0.0.3"]  # el dia de "hasta" se incluye entero
    assert ips(desde=(ahora - timedelta(days=3, minutes=1)).isoformat(), hasta=(ahora - timedelta(days=2)).isoformat()) == ["10.0.0.3"]
    assert ips(desde=d(0)) == []
    assert client.get("/api/bitacora", headers=admin, params={"desde": "ayer"}).status_code == 422


# ---------------------------------------------------------------- mezcla ordenada y paginacion
def _paginar(client, h, limite, **params):
    vistos, cursor, paginas = [], None, 0
    while True:
        p = {"limite": limite, **params, **({"cursor": cursor} if cursor else {})}
        pag = bit(client, h, **p)
        paginas += 1
        vistos += pag["items"]
        assert len(pag["items"]) <= limite
        if not pag["hay_mas"]:
            assert pag["siguiente"] is None
            return vistos, paginas
        assert pag["siguiente"]
        cursor = pag["siguiente"]
        assert paginas < 200


def test_mezcla_ordenada_y_paginacion_sin_repetidos_ni_saltos(client, admin, miembro, categoria_id):
    fam = yo(client, admin)["familia_id"]
    for i in range(7):
        gasto(client, admin, categoria_id, 10 + i)
        login(client, "admin@t.com")
    # empates de fecha ENTRE las dos tablas y dentro de la misma: lo mas dificil para una paginacion
    with SesionTest() as db:
        misma = db.scalar(select(Historial.fecha).order_by(Historial.id.desc()).limit(1))
    for _ in range(4):
        insertar(fam, "login_fallido", fecha=misma, resultado="fallo", ip="3.3.3.3")
    completo = bit(client, admin, limite=100)["items"]
    assert len(completo) > 25
    claves = [i["clave"] for i in completo]
    assert len(set(claves)) == len(claves)
    # orden: fecha descendente y, a igual fecha, un orden total estable (datos antes que acceso, id descendente)
    llave = lambda i: (i["fecha"], 1 if i["origen"] == "datos" else 0, int(i["clave"].split("-")[1]))  # noqa: E731
    assert [llave(i) for i in completo] == sorted((llave(i) for i in completo), reverse=True)
    fechas = [datetime.fromisoformat(i["fecha"]) for i in completo]
    assert fechas == sorted(fechas, reverse=True)
    for limite in (1, 2, 3, 5, 7, 30):
        vistos, _ = _paginar(client, admin, limite)
        assert [i["clave"] for i in vistos] == claves, f"limite={limite}"  # ni repetidos ni saltos, mismo orden
    # tambien dentro de un solo origen y con filtros
    solo, _ = _paginar(client, admin, 3, origen="acceso")
    assert [i["clave"] for i in solo] == [i["clave"] for i in bit(client, admin, origen="acceso", limite=100)["items"]]
    assert client.get("/api/bitacora", headers=admin, params={"cursor": "basura"}).status_code == 422
    assert client.get("/api/bitacora", headers=admin, params={"limite": 101}).status_code == 422


def test_la_paginacion_sigue_estable_si_llegan_eventos_nuevos(client, admin, categoria_id):
    for _ in range(6):
        login(client, "admin@t.com")
    pag1 = bit(client, admin, limite=3)
    login(client, "admin@t.com")  # llega algo nuevo entre pagina y pagina: queda arriba, no rompe lo que sigue
    pag2 = bit(client, admin, limite=3, cursor=pag1["siguiente"])
    claves = [i["clave"] for i in pag1["items"] + pag2["items"]]
    assert len(set(claves)) == len(claves)


def test_no_carga_todo_en_memoria_pide_un_tope_a_cada_tabla(client, admin, monkeypatch):
    """Cada consulta lleva LIMIT (limite + 1); nunca se pide la tabla entera."""
    from sqlalchemy import event

    fam = yo(client, admin)["familia_id"]
    for _ in range(40):
        insertar(fam)
    sqls = []

    @event.listens_for(engine_test, "before_cursor_execute")
    def _capturar(conn, cursor, statement, parameters, context, executemany):
        sqls.append(statement)

    try:
        bit(client, admin, limite=5)
    finally:
        event.remove(engine_test, "before_cursor_execute", _capturar)
    de_listas = [s for s in sqls if "FROM bitacora" in s or "FROM historial" in s]
    assert de_listas and all("LIMIT" in s for s in de_listas)


# ---------------------------------------------------------------- datos legibles, fecha real y "Anulado"
def test_eventos_de_datos_legibles_con_quien_y_fecha_real(client, admin, miembro, categoria_id):
    cats = client.get("/api/categorias", headers=admin).json()
    transporte = next(c for c in cats if c["nombre"] == "Transporte")["id"]
    m = gasto(client, miembro, transporte, 45)
    client.patch(f"/api/movimientos/{m['id']}", headers=miembro, json={"monto": 60, "version_base": m["version"]})
    client.post(f"/api/movimientos/{m['id']}/anular", headers=admin, json={"motivo": "Se pago dos veces"})
    items = {i["evento"]: i for i in bit(client, admin, origen="datos", limite=100)["items"] if i["entidad"] == "movimiento"}
    assert items["crear"]["titulo"] == "Creo gasto Transporte Bs 60.00" and items["crear"]["usuario_nombre"] == "Miembro"
    assert "Monto: Bs 45.00 -> Bs 60.00" in items["editar"]["detalle"]
    anul = items["anular"]
    assert anul["etiqueta"] == "Anulado" and anul["motivo"] == "Se pago dos veces"
    assert anul["titulo"] == "Anulo gasto Transporte Bs 60.00" and anul["usuario_nombre"] == "Admin"
    # al crear una categoria el titulo ya lo dice todo: sin lineas de ruido (icono, activa...)
    cat = next(i for i in bit(client, admin, origen="datos", limite=100)["items"] if i["entidad"] == "categoria")
    assert cat["titulo"].startswith("Creo categoria ") and cat["detalle"] == [] and cat["motivo"] == "Categoria inicial"
    assert "borr" not in json.dumps(anul).lower() and "elimin" not in json.dumps(anul).lower()  # nada se borra


def test_un_cambio_hecho_sin_internet_muestra_su_fecha_real(client, admin, categoria_id):
    hace_dos_dias = datetime.now(UTC) - timedelta(days=2)
    r = client.post(
        "/api/movimientos", headers=op(admin, **{"X-Fecha-Cliente": hace_dos_dias.isoformat()}),
        json={"tipo": "gasto", "monto": 33, "categoria_id": categoria_id},
    )
    assert r.status_code == 201
    crear = next(i for i in bit(client, admin, origen="datos", limite=100)["items"] if i["evento"] == "crear" and i["entidad"] == "movimiento")
    real = datetime.fromisoformat(crear["fecha_real"])
    assert abs((real - hace_dos_dias).total_seconds()) < 1
    sync = datetime.fromisoformat(crear["fecha_sincronizacion"])
    assert abs((sync - datetime.now(UTC)).total_seconds()) < 60  # la de sincronizacion va aparte
    # un cambio hecho con conexion no muestra dos fechas
    gasto(client, admin, categoria_id, 5)
    ultimo = next(i for i in bit(client, admin, origen="datos", limite=100)["items"] if i["entidad"] == "movimiento")
    assert ultimo["fecha_sincronizacion"] is None and ultimo["fecha_real"] == ultimo["fecha"]


def test_los_eventos_de_acceso_tienen_titulo_legible(client, admin):
    login(client, "admin@t.com")
    login(client, "nadie@x.com", "mala")
    t = {i["evento"]: i["titulo"] for i in bit(client, admin, origen="acceso", limite=100)["items"]}
    assert t["login_ok"] == "Admin inicio sesion" and t["registro"].startswith("Admin creo")
    # el login fallido de un correo inexistente no es visible; el de uno existente si
    login(client, "admin@t.com", "mala")
    fallido = next(i for i in bit(client, admin, evento="login_fallido")["items"])
    assert "admin@t.com" in fallido["titulo"] and fallido["etiqueta"] == "Entrada fallida"
    assert fallido["titulo"].endswith("(clave incorrecta)") and fallido["detalle"] == []  # sin repetir el motivo


# ---------------------------------------------------------------- CSV
def _leer_csv(texto: str) -> list[list[str]]:
    assert texto.startswith("﻿")
    return list(csv.reader(io.StringIO(texto.lstrip("﻿"))))


def test_csv_mismos_filtros_columna_origen_y_cabeceras(client, admin, categoria_id):
    gasto(client, admin, categoria_id, 20)
    login(client, "admin@t.com")
    r = client.get("/api/bitacora/exportar.csv", headers=admin)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"] and r.headers["x-truncado"] == "false"
    filas_csv = _leer_csv(r.text)
    assert filas_csv[0][0] == "origen"
    assert {f[0] for f in filas_csv[1:]} == {"acceso", "datos"}
    solo = _leer_csv(client.get("/api/bitacora/exportar.csv", headers=admin, params={"origen": "datos"}).text)
    assert {f[0] for f in solo[1:]} == {"datos"}
    ev = _leer_csv(client.get("/api/bitacora/exportar.csv", headers=admin, params={"evento": "login_ok"}).text)
    assert {f[3] for f in ev[1:]} == {"login_ok"}


def test_csv_tope_de_5000_filas(client, admin, categoria_id):
    fam = yo(client, admin)["familia_id"]
    with engine_test.begin() as c:
        c.execute(
            text("INSERT INTO bitacora (familia_id, evento, resultado, ip, detalle) "
                 "SELECT :f, 'login_ok', 'ok', '1.1.1.1', '{}'::jsonb FROM generate_series(1, 5100)"),
            {"f": fam},
        )
    r = client.get("/api/bitacora/exportar.csv", headers=admin)
    assert len(_leer_csv(r.text)) - 1 == 5000 and r.headers["x-truncado"] == "true"
    # con un filtro que deja pocas filas no se trunca
    poco = client.get("/api/bitacora/exportar.csv", headers=admin, params={"evento": "registro"})
    assert len(_leer_csv(poco.text)) - 1 == 1 and poco.headers["x-truncado"] == "false"


@pytest.mark.parametrize("peligroso", ["=1+1", "+cmd", "-2+3", "@SUMA(A1)"])
def test_csv_escapa_formulas(client, peligroso):
    h = registrar(client, email="f@t.com", nombre=peligroso)
    login(client, "f@t.com")
    texto = client.get("/api/bitacora/exportar.csv", headers=h).text
    filas_csv = _leer_csv(texto)
    celdas = [c for f in filas_csv[1:] for c in f]
    assert ("'" + peligroso) in celdas  # la columna de persona
    assert any(c.startswith("'" + peligroso) for c in celdas)
    # ninguna celda empieza con un caracter de formula
    assert not [c for c in celdas if c and c[0] in "=+-@\t\r"]


def test_csv_celda_sin_peligro_no_se_modifica():
    from app.modulos.bitacora.service import _celda

    assert _celda("Ana inicio sesion") == "Ana inicio sesion" and _celda(None) == "" and _celda(5) == "5"
    assert _celda("=A1") == "'=A1" and _celda("\t=A1") == "'\t=A1"


# ---------------------------------------------------------------- un fallo de la bitacora no rompe nada
def test_un_fallo_al_escribir_la_bitacora_no_rompe_el_login_y_queda_en_el_log(client, admin, monkeypatch, caplog):
    def roto(*a, **k):
        raise RuntimeError("falla simulada de la bitacora")

    monkeypatch.setattr(registro, "_construir", roto)
    with caplog.at_level(logging.ERROR, logger="arca.bitacora"):
        ok = login(client, "admin@t.com")
        malo = login(client, "admin@t.com", "mala-clave")
        out = client.post("/api/auth/logout", headers=admin)
    assert ok.status_code == 200 and "access_token" in ok.json()
    assert malo.status_code == 401  # la respuesta correcta, no un 500
    assert out.status_code == 204
    errores = [r for r in caplog.records if r.name == "arca.bitacora" and r.levelno >= logging.ERROR]
    assert len(errores) >= 3 and all("falla simulada" in (r.exc_text or "") for r in errores)  # nunca en silencio
    assert filas(evento="login_ok") == []


def test_un_fallo_de_base_de_datos_en_la_bitacora_no_tumba_el_cambio_de_clave(client, admin, monkeypatch, caplog):
    original = registro._construir

    def invalida(*a, **k):
        fila = original(*a, **k)
        fila.evento = "x" * 100  # no cabe en la columna: la base de datos rechaza la fila
        return fila

    monkeypatch.setattr(registro, "_construir", invalida)
    with caplog.at_level(logging.ERROR, logger="arca.bitacora"):
        r = client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "secreto1", "clave_nueva": "Nueva12345"})
        malo = client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "NoEs", "clave_nueva": "Nueva12345"})
    assert r.status_code == 204 and malo.status_code == 400
    assert [x for x in caplog.records if x.name == "arca.bitacora" and x.levelno >= logging.ERROR]
    monkeypatch.undo()
    assert login(client, "admin@t.com", "Nueva12345").status_code == 200  # el cambio de clave SI quedo
    # y el historial (misma transaccion) tambien: el fallo de la bitacora no se lo llevo
    with SesionTest() as db:
        assert db.scalar(select(Historial.id).where(Historial.accion == "cambiar_clave")) is not None


def test_eventos_que_cambian_datos_van_en_la_misma_transaccion(client, admin, miembro, monkeypatch):
    """Si el cambio se revierte, la entrada de bitacora tambien (a diferencia de los fallos, que van aparte)."""
    from sqlalchemy.orm import Session

    uid = yo(client, miembro)["id"]
    original = Session.commit

    def commit_roto(self):
        raise RuntimeError("commit simulado roto")

    monkeypatch.setattr(Session, "commit", commit_roto)
    with pytest.raises(RuntimeError):
        client.patch(f"/api/familia/miembros/{uid}", headers=admin, json={"rol": "admin"})
    monkeypatch.setattr(Session, "commit", original)
    assert filas(evento="cambio_rol") == []
    miembros = client.get("/api/familia/miembros", headers=admin).json()
    assert next(m for m in miembros if m["usuario_id"] == uid)["rol"] == "miembro"
    # y los fallos (aparte) quedan aunque la peticion falle
    assert login(client, "m@t.com", "mala").status_code == 401
    assert len(filas(evento="login_fallido")) == 1


# ---------------------------------------------------------------- resumen
def test_resumen_ultimo_login_fallos_7_dias_y_novedades(client, admin, miembro):
    fam = yo(client, admin)["familia_id"]
    adm, mie = yo(client, admin)["id"], yo(client, miembro)["id"]
    ahora = datetime.now(UTC)
    # el admin entro hace 20 dias desde un equipo, y hoy desde otro
    insertar(fam, "login_ok", fecha=ahora - timedelta(days=20), usuario_id=adm, ip="1.1.1.1", dispositivo="PC viejo")
    insertar(fam, "login_ok", fecha=ahora - timedelta(days=1), usuario_id=adm, ip="2.2.2.2", dispositivo="PC viejo")
    insertar(fam, "login_ok", fecha=ahora - timedelta(hours=1), usuario_id=adm, ip="2.2.2.2", dispositivo="Telefono nuevo")
    # fallos: 2 recientes y 1 de hace 10 dias (no cuenta); 1 bloqueo
    insertar(fam, "login_fallido", fecha=ahora - timedelta(days=2), usuario_id=mie, resultado="fallo")
    insertar(fam, "login_fallido", fecha=ahora - timedelta(days=1), usuario_id=mie, resultado="fallo")
    insertar(fam, "login_fallido", fecha=ahora - timedelta(days=10), usuario_id=mie, resultado="fallo")
    insertar(fam, "login_bloqueado", fecha=ahora - timedelta(days=1), usuario_id=mie, resultado="fallo")
    # otra familia: no cuenta
    otro = registrar(client, email="otro@t.com", familia="Otra")
    insertar(yo(client, otro)["familia_id"], "login_fallido", resultado="fallo", usuario_id=yo(client, otro)["id"])

    r = client.get("/api/bitacora/resumen", headers=admin).json()
    ult = {u["usuario_id"]: u for u in r["ultimos_accesos"]}
    # (el miembro entro una vez al prepararse la fixture: su ultimo login es de hace instantes)
    assert set(ult) == {adm, mie} and ult[mie]["ip"] == "testclient"
    assert abs((datetime.fromisoformat(ult[mie]["ultimo_login"]) - ahora).total_seconds()) < 120
    assert ult[adm]["ip"] == "2.2.2.2" and ult[adm]["dispositivo"] == "Telefono nuevo"
    assert abs((datetime.fromisoformat(ult[adm]["ultimo_login"]) - (ahora - timedelta(hours=1))).total_seconds()) < 2
    assert r["fallos_login_7d"] == 2 and r["bloqueos_login_7d"] == 1
    assert r["fallos_por_usuario"] == [{"usuario_id": mie, "nombre": "Miembro", "fallos": 2}]
    nuevas = {(n["tipo"], n["valor"]) for n in r["novedades"]}
    # 2.2.2.2 y "Telefono nuevo" aparecieron por primera vez esta semana, habiendo entrado antes (hace 20 dias)
    assert nuevas == {("ip", "2.2.2.2"), ("dispositivo", "Telefono nuevo")}
    assert all(n["usuario_id"] == adm for n in r["novedades"])


def test_el_primer_ingreso_no_cuenta_como_novedad(client, admin):
    adm, fam = yo(client, admin)["id"], yo(client, admin)["familia_id"]
    insertar(fam, "login_ok", usuario_id=adm, ip="4.4.4.4", dispositivo="Primero")
    assert client.get("/api/bitacora/resumen", headers=admin).json()["novedades"] == []
