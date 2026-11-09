# Despliegue de Arca

Arquitectura sugerida (todo con plan gratuito): **Neon** (PostgreSQL) + **Render** (backend FastAPI) + **Vercel** (frontend, PWA).
Nada de esto guarda secretos en el repositorio: todos los valores se escriben en el panel de cada servicio.
En la lista de abajo los valores son **marcadores**, nunca valores reales.

Orden recomendado: 1) base de datos, 2) backend, 3) frontend, 4) volver al backend a poner la URL del frontend en `CORS_ORIGENES`.

---

## 1. Base de datos (Neon)

1. Crea un proyecto y una base (por ejemplo `arca`).
2. Copia la cadena de conexion que da Neon. Debe terminar en `?sslmode=require` (Neon exige SSL):
   `postgresql://USUARIO:CLAVE@HOST.neon.tech/arca?sslmode=require`
3. No hace falta crear tablas: el backend las crea con `alembic upgrade head` en cada arranque.

## 2. Backend (Render, "Web Service")

| Ajuste | Valor |
|---|---|
| Directorio raiz | `backend_arca` |
| Entorno | Python 3 |
| Build command | `pip install -r requirements.txt` |
| **Comando de arranque** | `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/api/salud` |

### Variables de entorno del backend

| Variable | Obligatoria | Que es |
|---|---|---|
| `ENTORNO` | si | `produccion`. Activa las protecciones: la app **no arranca** con un `JWT_SECRET` debil, el seed se niega a correr, `/docs`, `/redoc` y `/openapi.json` desaparecen y el CORS usa solo `CORS_ORIGENES`. |
| `DATABASE_URL` | si | Cadena de conexion de Neon, con `?sslmode=require`. Se aceptan `postgresql://...` y `postgres://...`. |
| `JWT_SECRET` | si | Secreto aleatorio de **32 caracteres o mas**. Generalo con `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Si lo cambias, todas las sesiones se cierran. |
| `CORS_ORIGENES` | si | URL(s) del frontend separadas por comas, sin barra final: `https://TU-APP.vercel.app` (puedes agregar el dominio propio: `https://a.com,https://b.com`). |
| `REGISTRO_ABIERTO` | no | `false` por defecto en produccion: `/auth/registro` responde 403, **salvo** que no exista ningun usuario (asi se crea el primer admin y despues se cierra sola). Pon `true` solo si quieres registro libre. |
| `JWT_EXPIRA_MINUTOS` | no | Duracion de la sesion; por defecto `1440` (24 h). |
| `FORWARDED_ALLOW_IPS` | recomendada | `*`. Detras del proxy de Render hace que uvicorn lea la IP real del cliente (el limite de intentos de login es por IP y correo). |
| `PYTHON_VERSION` | si Render lo pide | Version de Python (por ejemplo `3.11.9`). |

`TEST_DATABASE_URL` es **solo para pruebas locales**: no se configura en produccion.

### Primer uso: crear el primer admin

Con `REGISTRO_ABIERTO` sin definir (cerrado) y la base vacia, abre la app y registrate: esa cuenta queda como **admin** y desde ese
momento el registro se cierra solo. Los demas miembros los crea el admin desde Familia > Agregar miembro (clave temporal).
Claves de **8 caracteres o mas**. Tras 5 intentos de login fallidos (misma IP y correo) en 10 minutos la app responde 429.

### Arranque en frio

En el plan gratuito de Render el servicio se duerme tras unos 15 minutos sin uso y tarda hasta ~1 minuto en despertar. La app lo
tolera: espera hasta 90 s la primera respuesta, muestra "Despertando el servidor..." y los cambios sin conexion se reintentan solos.

## 3. Frontend (Vercel)

| Ajuste | Valor |
|---|---|
| Directorio raiz | `web_arca` |
| Framework | Vite |
| Build command | `npm run build` |
| Directorio de salida | `dist` |

### Variables de entorno del frontend (se leen **al compilar**)

| Variable | Obligatoria | Que es |
|---|---|---|
| `VITE_API_URL` | si | URL del backend, sin barra final: `https://TU-API.onrender.com`. Si falta, la app compilada muestra un aviso de configuracion en lugar de intentar adivinar una URL. |

`vercel.json` ya incluye: reescritura de las rutas de la SPA (recargar `/apoyos` funciona), `sw.js` y `manifest.webmanifest`
sin cache largo y los archivos con hash (`/assets/*`) con cache de un ano.
Al publicar una version nueva los usuarios ven el aviso **"Hay una version nueva, actualizar"**.

## 4. Respaldo de la base

Neon conserva un historial corto de restauracion, pero **haz tu propio respaldo** con `pg_dump` (viene con PostgreSQL; usa la misma
version mayor que el servidor o una mas nueva). La cadena debe ser la de Neon **sin** `+psycopg2` (`postgresql://...?sslmode=require`).

```bash
# Respaldo (formato comprimido; guarda tambien el trigger que protege el historial)
pg_dump "postgresql://USUARIO:CLAVE@HOST.neon.tech/arca?sslmode=require" \
  --format=custom --no-owner --file="arca-$(date +%F).dump"

# Comprobar que el archivo es legible
pg_restore --list "arca-AAAA-MM-DD.dump" | head
```

En PowerShell: `pg_dump "<cadena>" --format=custom --no-owner --file="arca-$(Get-Date -Format yyyy-MM-dd).dump"`.

**Restaurar en una base NUEVA y vacia** (por ejemplo otro proyecto de Neon). Nunca restaures encima de la base en uso:

```bash
pg_restore --no-owner --dbname "postgresql://USUARIO:CLAVE@HOST-NUEVO.neon.tech/arca?sslmode=require" "arca-AAAA-MM-DD.dump"
```

Despues apunta `DATABASE_URL` del backend a la base nueva. Recomendado: un respaldo semanal, guardado **fuera** de tu computadora
principal y fuera del repositorio (los respaldos contienen todos los datos y los hashes de clave).

## 4b. Bitacora (Fase 15)
- La migracion `0005` (parte de `alembic upgrade head`, que ya corre al arrancar) crea la tabla `bitacora` y su trigger de solo agregar. Nada que configurar.
- La **IP** que se anota es la del socket que resuelve uvicorn: en Render hay que tener `FORWARDED_ALLOW_IPS=*` (ver la tabla de variables); sin ella todos los accesos aparecerian con la IP del proxy. La app no lee `X-Forwarded-For` por su cuenta.
- La bitacora y el historial **solo crecen** (el trigger impide borrar o editar) y entran en el respaldo (seccion 4). No hay purga automatica: si algun dia hace falta, se decide con el respaldo en la mano y hay que desactivar el trigger a proposito.
- Los registros de bitacora no incluyen claves, hashes ni tokens; si un respaldo se comparte, contiene correos, IP y navegadores de los usuarios (datos personales): tratarlo como confidencial.

## 5. Lista de comprobacion antes de abrir a la familia

- [ ] `ENTORNO=produccion`, `JWT_SECRET` de 32+ caracteres generado al azar, `CORS_ORIGENES` con la URL real del frontend.
- [ ] `https://TU-API.onrender.com/api/salud` responde `{"estado":"ok"}` y `/docs` da 404.
- [ ] La app abre en `https://TU-APP.vercel.app`, se crea el primer admin y `Registro` queda cerrado.
- [ ] Un respaldo hecho y comprobado con `pg_restore --list`.
- [ ] Ningun `.env` en el repositorio (`.gitignore` ya excluye `.env`, `.venv` y `node_modules`).
- [ ] Con `FORWARDED_ALLOW_IPS=*` puesta: entrar una vez y comprobar en Familia > Bitacora que la IP del acceso es la tuya y no la del proxy.
