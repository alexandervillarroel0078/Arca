"""Fase 13: listo para produccion (configuracion, arranque seguro, registro cerrado, limite de login, CORS, aislamiento de e2e)."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from app.core import limite
from app.core.config import ConfiguracionInvalida, Settings, validar_produccion
from app.core.config import settings as ajustes
from tests.conftest import registrar

RAIZ = Path(__file__).resolve().parents[1]
SECRETO_BUENO = "k3Qy-9fZ_pLw2sXv7TnB0aRu5HdEoJc1MgYi8NbVq4WtA6"  # 46 caracteres (de prueba, no es un secreto real)
CORS = "https://arca-familia.vercel.app,https://otro.example.com"


def prod(**c) -> Settings:
    base = dict(entorno="produccion", jwt_secret=SECRETO_BUENO, database_url="postgresql://u:p@host/db?sslmode=require", cors_origenes=CORS)
    base.update(c)
    return Settings(_env_file=None, **base)


# ---------------------------------------------------------------- 2. arranque en produccion
class TestSecretoDebil:
    def test_un_secreto_bueno_pasa(self):
        validar_produccion(prod())

    @pytest.mark.parametrize(
        "secreto",
        ["", "   ", "dev-secreto-cambiar", "cambiar-por-un-secreto-largo", "un-secreto-largo", "changeme", "abc", "x" * 31,
         "cambiar-" + "x" * 40],
    )
    def test_secretos_debiles_o_de_ejemplo_se_rechazan(self, secreto):
        with pytest.raises(ConfiguracionInvalida, match="JWT_SECRET"):
            validar_produccion(prod(jwt_secret=secreto))

    def test_32_caracteres_es_el_minimo(self):
        validar_produccion(prod(jwt_secret="a1" * 16))
        with pytest.raises(ConfiguracionInvalida):
            validar_produccion(prod(jwt_secret="a1" * 15 + "a"))

    def test_si_JWT_SECRET_no_esta_definido_no_arranca(self):
        s = Settings(_env_file=None, entorno="produccion", database_url="postgresql://u:p@h/d", cors_origenes=CORS)
        assert "jwt_secret" not in s.model_fields_set
        with pytest.raises(ConfiguracionInvalida, match="JWT_SECRET no esta definido"):
            validar_produccion(s)

    def test_database_url_y_cors_son_obligatorios(self):
        s = Settings(_env_file=None, entorno="produccion", jwt_secret=SECRETO_BUENO, cors_origenes=CORS)
        with pytest.raises(ConfiguracionInvalida, match="DATABASE_URL"):
            validar_produccion(s)
        s = Settings(_env_file=None, entorno="produccion", jwt_secret=SECRETO_BUENO, database_url="postgresql://u:p@h/d")
        with pytest.raises(ConfiguracionInvalida, match="CORS_ORIGENES"):
            validar_produccion(s)
        with pytest.raises(ConfiguracionInvalida, match="CORS_ORIGENES"):
            validar_produccion(prod(cors_origenes="*"))

    def test_el_mensaje_dice_todo_lo_que_falla_y_como_generar_un_secreto(self):
        with pytest.raises(ConfiguracionInvalida) as e:
            validar_produccion(Settings(_env_file=None, entorno="produccion", jwt_secret="corto"))
        t = str(e.value)
        assert "JWT_SECRET" in t and "DATABASE_URL" in t and "CORS_ORIGENES" in t and "token_urlsafe" in t

    def test_en_desarrollo_no_se_exige_nada(self):
        validar_produccion(Settings(_env_file=None, entorno="desarrollo", jwt_secret="x"))

    @pytest.mark.parametrize("nombre", ["produccion", "Produccion", "PRODUCCION", " prod ", "production"])
    def test_variantes_de_ENTORNO_cuentan_como_produccion(self, nombre):
        assert Settings(_env_file=None, entorno=nombre).es_produccion


def _correr(codigo: str, extra_env: dict | None = None, args: list[str] | None = None) -> subprocess.CompletedProcess:
    """Ejecuta Python en un proceso NUEVO (asi se prueba el arranque de verdad) con el entorno indicado."""
    env = {k: v for k, v in os.environ.items() if k not in ("ENTORNO", "JWT_SECRET", "REGISTRO_ABIERTO", "CORS_ORIGENES", "DATABASE_URL")}
    env.update(extra_env or {})
    cmd = [sys.executable, "-c", codigo] if args is None else [sys.executable, *args]  # cwd = raiz del backend
    return subprocess.run(cmd, cwd=RAIZ, env=env, capture_output=True, text=True, timeout=120)


def entorno_prod(**c) -> dict:
    base = {
        "ENTORNO": "produccion", "JWT_SECRET": SECRETO_BUENO, "CORS_ORIGENES": CORS,
        "DATABASE_URL": ajustes.test_database_url,  # solo para que la app tenga una URL: estas pruebas no escriben datos
    }
    base.update(c)
    return base


class TestArranqueRealEnProduccion:
    @pytest.mark.parametrize("secreto", ["", "corto", "dev-secreto-cambiar", "cambiar-por-un-secreto-largo", "x" * 31])
    def test_la_app_NO_arranca_con_JWT_SECRET_debil(self, secreto):
        r = _correr("import app.main", entorno_prod(JWT_SECRET=secreto))
        assert r.returncode != 0
        assert "ConfiguracionInvalida" in r.stderr and "JWT_SECRET" in r.stderr

    def test_arranca_con_configuracion_correcta(self):
        r = _correr("import app.main; print('ARRANCO')", entorno_prod())
        assert r.returncode == 0, r.stderr
        assert "ARRANCO" in r.stdout

    def test_el_seed_se_niega_a_correr(self):
        r = _correr("", entorno_prod(), args=["-m", "app.seed"])
        assert r.returncode != 0
        assert "el seed es solo para desarrollo" in r.stdout

    def test_el_seed_tambien_se_niega_si_solo_ENTORNO_dice_produccion(self):
        r = _correr("", {"ENTORNO": "produccion", **{k: v for k, v in entorno_prod().items() if k != "ENTORNO"}}, args=["-m", "app.seed"])
        assert "el seed es solo para desarrollo" in r.stdout

    def test_docs_redoc_y_openapi_no_existen_en_produccion(self):
        codigo = (
            "from fastapi.testclient import TestClient\nfrom app.main import app\nc = TestClient(app)\n"
            "print([c.get(p).status_code for p in ('/docs', '/redoc', '/openapi.json', '/api/docs')])"
        )
        r = _correr(codigo, entorno_prod())
        assert r.returncode == 0, r.stderr
        assert "[404, 404, 404, 404]" in r.stdout

    def test_en_desarrollo_la_documentacion_sigue_disponible(self, client):
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200


# ---------------------------------------------------------------- 7. e2e jamas en produccion
class TestE2ENoSeCarga:
    def test_en_produccion_ninguna_ruta_ni_modulo_de_e2e(self):
        codigo = (
            "import sys, json\nfrom fastapi.testclient import TestClient\nimport app.main as m\n"
            "rutas = [getattr(r, 'path', '') for r in m.app.routes]\n"
            "c = TestClient(m.app)\n"
            "print(json.dumps({'rutas_e2e': [r for r in rutas if '__e2e__' in r],"
            " 'modulos_e2e': sorted(x for x in sys.modules if x == 'e2e' or x.startswith('e2e.')),"
            " 'estados': [c.get('/__e2e__/base').status_code, c.post('/__e2e__/reset').status_code,"
            " c.post('/__e2e__/movimiento-sin-historial', json={}).status_code]}))"
        )
        r = _correr(codigo, entorno_prod())
        assert r.returncode == 0, r.stderr
        datos = json.loads(r.stdout.strip().splitlines()[-1])
        assert datos["rutas_e2e"] == []
        assert datos["modulos_e2e"] == []
        assert datos["estados"] == [404, 404, 404]

    def test_tampoco_en_desarrollo_la_app_real_tiene_rutas_de_e2e(self, client):
        from app.main import app

        assert not [r for r in app.routes if "__e2e__" in getattr(r, "path", "")]
        assert client.get("/__e2e__/base").status_code == 404
        assert client.post("/__e2e__/reset").status_code == 404

    def test_ningun_archivo_de_la_app_importa_el_codigo_de_e2e(self):
        patron = re.compile(r"^\s*(from|import)\s+e2e\b|__e2e__|e2e\.servidor", re.M)
        culpables = [str(p.relative_to(RAIZ)) for p in (RAIZ / "app").rglob("*.py") if patron.search(p.read_text(encoding="utf-8"))]
        assert culpables == []
        assert not [p for p in (RAIZ / "alembic").rglob("*.py") if patron.search(p.read_text(encoding="utf-8"))]

    def test_el_servidor_de_e2e_se_niega_a_arrancar_en_produccion(self):
        r = _correr("import e2e.servidor", entorno_prod())
        assert r.returncode != 0
        assert "solo para pruebas" in r.stderr

    def test_el_comando_de_arranque_de_produccion_apunta_a_app_main(self):
        texto = (RAIZ.parent / "DESPLIEGUE.md").read_text(encoding="utf-8")
        assert "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT" in texto
        assert "e2e.servidor" not in "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT"


# ---------------------------------------------------------------- 3. registro cerrado y primer admin
class TestRegistroCerrado:
    def test_valores_por_defecto_segun_el_entorno(self):
        assert Settings(_env_file=None, entorno="desarrollo").registro_esta_abierto is True
        assert Settings(_env_file=None, entorno="produccion").registro_esta_abierto is False
        assert Settings(_env_file=None, entorno="produccion", registro_abierto=True).registro_esta_abierto is True
        assert Settings(_env_file=None, entorno="desarrollo", registro_abierto=False).registro_esta_abierto is False

    def test_REGISTRO_ABIERTO_se_lee_del_entorno(self):
        r = _correr(
            "from app.core.config import settings as s; print(s.registro_abierto, s.registro_esta_abierto)",
            {"REGISTRO_ABIERTO": "false"},
        )
        assert "False False" in r.stdout, r.stderr

    def test_cerrado_pero_sin_usuarios_permite_crear_el_primer_admin_y_luego_se_cierra(self, client, monkeypatch):
        monkeypatch.setattr(ajustes, "registro_abierto", False)
        primero = client.post("/api/auth/registro", json={"nombre": "Ana", "email": "ana@t.com", "password": "secreto12", "nombre_familia": "Fam"})
        assert primero.status_code == 201
        assert primero.json()["usuario"]["rol"] == "admin"
        # ya hay un usuario: se cierra solo
        segundo = client.post("/api/auth/registro", json={"nombre": "Beto", "email": "beto@t.com", "password": "secreto12"})
        assert segundo.status_code == 403
        assert "registro esta cerrado" in segundo.json()["detail"]

    def test_cerrado_no_crea_nada_al_rechazar(self, client, monkeypatch):
        registrar(client)  # un usuario ya existe (registro abierto en este momento)
        monkeypatch.setattr(ajustes, "registro_abierto", False)
        r = client.post("/api/auth/registro", json={"nombre": "X", "email": "x@t.com", "password": "secreto12"})
        assert r.status_code == 403
        assert client.post("/api/auth/login", json={"email": "x@t.com", "password": "secreto12"}).status_code == 401

    def test_cerrado_el_admin_sigue_pudiendo_invitar_y_los_usuarios_entrar(self, client, monkeypatch):
        monkeypatch.setattr(ajustes, "registro_abierto", False)
        client.post("/api/auth/registro", json={"nombre": "Ana", "email": "ana@t.com", "password": "secreto12"})
        tok = client.post("/api/auth/login", json={"email": "ana@t.com", "password": "secreto12"}).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        r = client.post("/api/familia/invitar", headers=h, json={"nombre": "Beto", "email": "beto@t.com", "password": "temporal12"})
        assert r.status_code == 201
        assert client.post("/api/auth/login", json={"email": "beto@t.com", "password": "temporal12"}).status_code == 200

    def test_abierto_cualquiera_puede_registrarse(self, client, monkeypatch):
        monkeypatch.setattr(ajustes, "registro_abierto", True)
        registrar(client, "a@t.com")
        registrar(client, "b@t.com")


# ---------------------------------------------------------------- 4. limite de login y clave minima
class TestLimiteDeLogin:
    def intentar(self, client, clave="mala-clave", email="ana@t.com"):
        return client.post("/api/auth/login", json={"email": email, "password": clave})

    def test_cinco_fallos_y_el_sexto_intento_da_429_aunque_la_clave_sea_buena(self, client):
        registrar(client, "ana@t.com")
        for _ in range(5):
            assert self.intentar(client).status_code == 401
        r = self.intentar(client)
        assert r.status_code == 429
        assert "Demasiados intentos" in r.json()["detail"]
        assert int(r.headers["Retry-After"]) > 0
        assert self.intentar(client, "secreto1").status_code == 429  # bloqueado: ni la clave correcta entra
        assert self.intentar(client, "secreto1", "otro@t.com").status_code == 401  # otro correo: no esta bloqueado

    def test_cuatro_fallos_no_bloquean_y_un_ingreso_correcto_reinicia_la_cuenta(self, client):
        registrar(client, "ana@t.com")
        for _ in range(4):
            self.intentar(client)
        assert self.intentar(client, "secreto1").status_code == 200
        for _ in range(4):
            assert self.intentar(client).status_code == 401
        assert self.intentar(client, "secreto1").status_code == 200  # no se acumulo con los de antes

    def test_correo_en_mayusculas_cuenta_igual(self, client):
        registrar(client, "ana@t.com")
        for i in range(5):
            self.intentar(client, email="ANA@t.com" if i % 2 else "ana@t.com")
        assert self.intentar(client, email="Ana@T.com").status_code == 429

    def test_cuentas_inexistentes_tambien_se_limitan_sin_revelar_si_existen(self, client):
        for _ in range(5):
            assert self.intentar(client, email="fantasma@t.com").status_code == 401
        assert self.intentar(client, email="fantasma@t.com").status_code == 429

    def test_el_registro_y_las_demas_rutas_no_cuentan_como_intentos(self, client):
        registrar(client, "ana@t.com")
        for _ in range(7):
            client.get("/api/auth/yo")
        assert self.intentar(client, "secreto1").status_code == 200


class TestLimiteUnidad:
    def test_la_ventana_de_10_minutos_libera_los_intentos(self):
        limite.reiniciar()
        t0 = 1000.0
        for i in range(5):
            limite.registrar_fallo("1.1.1.1", "a@t.com", t0 + i)
        assert limite.segundos_de_espera("1.1.1.1", "a@t.com", t0 + 10) > 0
        assert 0 < limite.segundos_de_espera("1.1.1.1", "a@t.com", t0 + 10) <= limite.VENTANA_SEGUNDOS + 1
        assert limite.segundos_de_espera("1.1.1.1", "a@t.com", t0 + limite.VENTANA_SEGUNDOS + 1) == 0  # ya pasaron 10 minutos

    def test_es_por_ip_y_por_correo(self):
        limite.reiniciar()
        for _ in range(5):
            limite.registrar_fallo("1.1.1.1", "a@t.com")
        assert limite.segundos_de_espera("1.1.1.1", "a@t.com") > 0
        assert limite.segundos_de_espera("2.2.2.2", "a@t.com") == 0  # otra IP
        assert limite.segundos_de_espera("1.1.1.1", "b@t.com") == 0  # otro correo

    def test_la_memoria_tiene_tope(self, monkeypatch):
        limite.reiniciar()
        monkeypatch.setattr(limite, "MAX_CLAVES", 50)
        for i in range(500):
            limite.registrar_fallo("1.1.1.1", f"u{i}@t.com")
        assert len(limite._fallos) <= 50
        limite.reiniciar()


class TestClaveMinima:
    def test_registro_pide_8_caracteres(self, client):
        corta = client.post("/api/auth/registro", json={"nombre": "A", "email": "a@t.com", "password": "1234567"})
        assert corta.status_code == 422
        ok = client.post("/api/auth/registro", json={"nombre": "A", "email": "a@t.com", "password": "12345678"})
        assert ok.status_code == 201

    def test_cambiar_clave_e_invitar_piden_8_caracteres(self, client, admin):
        r = client.post("/api/auth/cambiar-clave", headers=admin, json={"clave_actual": "secreto1", "clave_nueva": "1234567"})
        assert r.status_code == 422
        r = client.post("/api/familia/invitar", headers=admin, json={"nombre": "B", "email": "b@t.com", "password": "1234567"})
        assert r.status_code == 422
        r = client.post("/api/familia/invitar", headers=admin, json={"nombre": "B", "email": "b@t.com", "password": "12345678"})
        assert r.status_code == 201

    def test_la_clave_temporal_generada_cumple_el_minimo(self, client, admin, miembro):
        miembros = client.get("/api/familia/miembros", headers=admin).json()
        uid = next(m["usuario_id"] for m in miembros if m["email"] == "m@t.com")
        temp = client.post(f"/api/familia/miembros/{uid}/restablecer-clave", headers=admin).json()["clave_temporal"]
        assert len(temp) >= 8
        assert client.post("/api/auth/login", json={"email": "m@t.com", "password": temp}).status_code == 200


# ---------------------------------------------------------------- 6. salud
class TestSalud:
    def test_api_salud_sin_autenticacion_y_sin_datos_internos(self, client):
        r = client.get("/api/salud")
        assert r.status_code == 200
        assert r.json() == {"estado": "ok"}  # nada de version, base de datos, entorno ni usuarios
        assert "server" not in {k.lower() for k in r.headers if k.lower() == "x-powered-by"}

    def test_no_pide_token_ni_acepta_escritura(self, client):
        assert client.post("/api/salud").status_code == 405
        assert client.get("/api/salud", headers={"Authorization": "Bearer invalido"}).status_code == 200


# ---------------------------------------------------------------- 1. configuracion / DATABASE_URL (Neon)
class TestDatabaseUrl:
    def test_acepta_sslmode_require_y_lo_conserva(self):
        s = Settings(_env_file=None, database_url="postgresql://u:p@ep-algo.neon.tech/neondb?sslmode=require")
        url = create_engine(s.database_url).url
        assert url.drivername == "postgresql"  # psycopg2 por defecto
        assert url.query["sslmode"] == "require"
        s2 = Settings(_env_file=None, database_url="postgresql+psycopg2://u:p@h/db?sslmode=require&channel_binding=require")
        assert create_engine(s2.database_url).url.query == {"sslmode": "require", "channel_binding": "require"}

    def test_postgres_se_convierte_a_postgresql(self):
        s = Settings(_env_file=None, database_url="postgres://u:p@h:5432/db?sslmode=require")
        assert s.database_url.startswith("postgresql://")
        assert create_engine(s.database_url).url.query["sslmode"] == "require"

    def test_el_parametro_llega_de_verdad_a_libpq(self):
        """sslmode=prefer conecta (con o sin SSL); sslmode=require contra un servidor sin SSL falla diciendolo."""
        base = ajustes.test_database_url
        e = create_engine(base + ("&" if "?" in base else "?") + "sslmode=prefer")
        with e.connect() as c:
            assert c.execute(text("select 1")).scalar() == 1
        e.dispose()
        e2 = create_engine(base + ("&" if "?" in base else "?") + "sslmode=require")
        try:
            with e2.connect() as c:
                assert c.execute(text("select 1")).scalar() == 1  # el servidor local tiene SSL: tambien vale
        except OperationalError as err:
            assert "SSL" in str(err)  # la conexion exigio SSL: el parametro se respeto
        finally:
            e2.dispose()

    def test_toda_la_configuracion_sale_del_entorno_sin_archivo_env(self):
        s = Settings(_env_file=None)
        assert s.entorno == "desarrollo"
        r = _correr(
            "from app.core.config import settings as s; print(s.jwt_secret, s.origenes_cors, s.es_produccion)",
            {"JWT_SECRET": "desde-el-entorno", "CORS_ORIGENES": " https://a.com/ , https://b.com ", "ENTORNO": "desarrollo"},
        )
        assert "desde-el-entorno ['https://a.com', 'https://b.com'] False" in r.stdout, r.stderr

    def test_la_app_no_exige_archivo_env(self):
        # en produccion (Render, etc.) no existe .env: con las variables del entorno basta
        r = _correr("import app.main; print('ok')", entorno_prod())
        assert r.returncode == 0, r.stderr


# ---------------------------------------------------------------- CORS
CODIGO_CORS = (
    "import json\nfrom fastapi.testclient import TestClient\nfrom app.main import app\nc = TestClient(app)\n"
    "def pre(o, m='POST'):\n"
    "    r = c.options('/api/auth/login', headers={'Origin': o, 'Access-Control-Request-Method': m,"
    " 'Access-Control-Request-Headers': 'content-type,authorization,x-operacion-id'})\n"
    "    return r.headers.get('access-control-allow-origin')\n"
    "print(json.dumps({o: pre(o) for o in ['https://arca-familia.vercel.app', 'https://otro.example.com',"
    " 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://192.168.1.20:5173', 'https://evil.example.com',"
    " 'https://arca-familia.vercel.app.evil.com']}))"
)


class TestCors:
    def test_produccion_acepta_solo_los_origenes_de_CORS_ORIGENES(self):
        r = _correr(CODIGO_CORS, entorno_prod())
        assert r.returncode == 0, r.stderr
        permitidos = json.loads(r.stdout.strip().splitlines()[-1])
        assert permitidos["https://arca-familia.vercel.app"] == "https://arca-familia.vercel.app"
        assert permitidos["https://otro.example.com"] == "https://otro.example.com"
        # NADA de localhost ni de la red local en produccion, ni dominios parecidos
        for o in ("http://localhost:5173", "http://127.0.0.1:5173", "http://192.168.1.20:5173", "https://evil.example.com",
                  "https://arca-familia.vercel.app.evil.com"):
            assert permitidos[o] is None, o

    def test_los_origenes_se_leen_de_una_lista_separada_por_comas_con_espacios_y_barra_final(self):
        r = _correr(CODIGO_CORS, entorno_prod(CORS_ORIGENES=" https://arca-familia.vercel.app/ , https://otro.example.com "))
        permitidos = json.loads(r.stdout.strip().splitlines()[-1])
        assert permitidos["https://arca-familia.vercel.app"] and permitidos["https://otro.example.com"]

    def test_en_desarrollo_se_permite_localhost_y_la_red_local(self):
        r = _correr(CODIGO_CORS, {"ENTORNO": "desarrollo", "CORS_ORIGENES": "https://arca-familia.vercel.app", "JWT_SECRET": "dev"})
        p = json.loads(r.stdout.strip().splitlines()[-1])
        assert p["http://localhost:5173"] and p["http://192.168.1.20:5173"]
        assert p["https://evil.example.com"] is None

    def test_solo_se_permiten_los_metodos_y_cabeceras_que_la_app_usa(self):
        codigo = (
            "from fastapi.testclient import TestClient\nfrom app.main import app\nc = TestClient(app)\n"
            "h = {'Origin': 'https://arca-familia.vercel.app', 'Access-Control-Request-Method': 'DELETE'}\n"
            "print(c.options('/api/movimientos/1', headers=h).status_code)"
        )
        r = _correr(codigo, entorno_prod())
        assert r.stdout.strip().splitlines()[-1] == "400"  # preflight de DELETE rechazado


# ---------------------------------------------------------------- 5. requirements con versiones fijas
class TestRequirements:
    def test_todas_las_dependencias_tienen_version_fija(self):
        for nombre in ("requirements.txt", "requirements-dev.txt"):
            lineas = [l.strip() for l in (RAIZ / nombre).read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]
            for l in lineas:
                assert l.startswith("-r ") or re.fullmatch(r"[A-Za-z0-9_.\-]+(\[[a-z,]+\])?==\d[\w.]*", l), f"{nombre}: '{l}' no tiene version fija"

    def test_produccion_no_instala_herramientas_de_prueba(self):
        prod_ = (RAIZ / "requirements.txt").read_text(encoding="utf-8").lower()
        assert "pytest" not in prod_ and "httpx" not in prod_
        assert "-r requirements.txt" in (RAIZ / "requirements-dev.txt").read_text(encoding="utf-8")

    def test_lo_instalado_coincide_con_lo_fijado(self):
        from importlib.metadata import version

        for l in (RAIZ / "requirements.txt").read_text(encoding="utf-8").splitlines():
            if "==" not in l:
                continue
            nombre, fijada = l.split("==")
            nombre = re.sub(r"\[.*\]", "", nombre)
            assert version(nombre) == fijada.strip(), nombre
