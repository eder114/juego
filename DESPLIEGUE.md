# 🌍 Publicar Premier Fantasy en internet (gratis)

Resultado final: una página web con dirección tipo `https://premier-fantasy.onrender.com` que cualquiera puede abrir desde el navegador del computador, la tablet o el celular. No hay que descargar ni instalar nada: se entra con el enlace, como a cualquier página.

| Pieza | Servicio gratuito | Qué hace |
|---|---|---|
| Código | **GitHub** | Guarda el proyecto; Render lo lee desde aquí |
| Base de datos | **Neon** (PostgreSQL) | Usuarios, equipos, ligas y puntos. No caduca |
| Página web | **Render** (Web Service Free) | Publica la página web y su API |

Tiempo total: unos 20 minutos. No hace falta tarjeta de crédito.

---

## Paso 1 · Subir el código a GitHub

El proyecto ya tiene un repositorio Git local con todo el código confirmado. Solo falta publicarlo en tu cuenta.

**Opción A: con la terminal (recomendada)**

1. Instala GitHub CLI (una sola vez) y **cierra y vuelve a abrir la terminal**:
   ```bash
   winget install --id GitHub.cli
   ```
2. Inicia sesión: elige *GitHub.com → HTTPS → Login with a web browser* y sigue las instrucciones en el navegador.
   ```bash
   gh auth login
   ```
3. Crea el repositorio **privado** y súbelo:
   ```bash
   gh repo create premier-fantasy --private --source "C:\Users\ederf\OneDrive\Desktop\Fantasy" --push
   ```

**Opción B: con GitHub Desktop (sin terminal)**

1. Descarga GitHub Desktop desde https://desktop.github.com e inicia sesión.
2. *File → Add local repository* → elige la carpeta `C:\Users\ederf\OneDrive\Desktop\Fantasy`.
3. Pulsa **Publish repository**, deja marcado *Keep this code private* y confirma.

> El archivo `server/.env`, que contiene tus secretos locales, y la base de datos local **no** se suben: están excluidos en `.gitignore`.

---

## Paso 2 · Crear la base de datos en Neon

1. Entra en https://neon.tech y regístrate con **Continue with GitHub**.
2. **Create project**:
   - Name: `premier-fantasy`
   - Postgres version: la que venga por defecto
   - Region: **AWS US East (N. Virginia)**, la misma zona que Render en el paso 3, para que vaya rápido
3. En el panel del proyecto pulsa **Connect**:
   - Desactiva **Connection pooling**: la app necesita la conexión directa.
   - Copia la cadena que empieza por `postgresql://…` y termina en `sslmode=require`.
4. Guárdala a mano un momento. **Es una contraseña: no la compartas.**

---

## Paso 3 · Publicar la app en Render

1. Entra en https://render.com y regístrate con **GitHub**.
2. Arriba a la derecha: **New → Blueprint**.
3. Conecta tu cuenta de GitHub si te lo pide y elige el repositorio **premier-fantasy**. Render detecta el archivo `render.yaml` del proyecto.
4. Te pedirá 3 valores:

   | Variable | Qué poner |
   |---|---|
   | `DATABASE_URL` | La cadena de Neon del paso 2 |
   | `ADMIN_EMAIL` | Tu email, que será la cuenta de administrador de la app |
   | `ADMIN_PASSWORD` | Una contraseña nueva y segura, de al menos 8 caracteres con letras y números |

   El resto se configura solo: `JWT_SECRET` se genera aleatoriamente y la sincronización automática con los datos reales de la Premier queda activada.
5. Pulsa **Deploy Blueprint**.
6. Espera:
   - **Compilación:** 5-10 minutos. Verás el progreso en *Logs*.
   - **Primer arranque:** 1-3 minutos más, mientras carga la temporada completa (clubes, jugadores, calendario y estadísticas). Durante ese tiempo la app muestra *«Estamos cargando los datos de la temporada»*.
7. Cuando el servicio aparezca como **Live**, abre la dirección que Render muestra arriba (`https://premier-fantasy.onrender.com` o similar).

**Comprobación rápida**: abre `https://TU-DIRECCION.onrender.com/api/health`. Debe mostrar `"status":"ok"` y `"seeding":false`.

Entra con tu `ADMIN_EMAIL` y `ADMIN_PASSWORD` para acceder al panel de administración, y regístrate con otro email para jugar como mánager.

---

## Paso 4 · Compartir la página

Envía la dirección a tus amigos por WhatsApp, correo o redes. Cada uno:

1. Abre el enlace en el navegador que use (Chrome, Safari, Edge, Firefox…), en computador o celular.
2. Pulsa **Crear equipo**, se registra y empieza a fichar.

En el celular la página se adapta sola a la pantalla, con menú inferior y botones grandes. No hay nada que descargar.

---

## Cosas a saber del plan gratuito

- **Render se «duerme»** tras 15 minutos sin visitas. La primera visita después tarda unos 50 segundos en despertar; luego va normal. Para mantenerla siempre despierta, crea una cuenta gratis en https://cron-job.org y programa una visita cada 10 minutos a `https://TU-DIRECCION.onrender.com/api/health`. Render da 750 horas gratis al mes, suficiente para tenerla encendida todo el mes.
- **Neon gratis**: 0,5 GB de almacenamiento, de sobra para miles de usuarios. Se pausa sola cuando no hay uso y se reactiva en menos de un segundo.
- **Datos reales automáticos**: cada 15 minutos la app descarga resultados, estadísticas y lesiones de la API oficial de Fantasy Premier League, cierra las jornadas, reparte los puntos y actualiza precios. También puedes forzarlo en *Admin → Datos → Sincronizar ahora*.
- **Correo de recuperación de contraseña**: sin configurar, el enlace solo aparece en los *Logs* de Render. Para enviar emails de verdad, añade en Render (*Environment*) las variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM` de un proveedor gratuito como Brevo o una contraseña de aplicación de Gmail.
- **Datos de demostración**: la versión pública arranca **sin** mánagers ficticios. Si quieres verla con los 12 mánagers y ligas de ejemplo, pon `SEED_DEMO` en `true` **antes del primer despliegue**.

---

## Actualizar la app

Cada vez que se cambie el código, basta con subirlo a GitHub y Render lo vuelve a publicar solo.

```bash
cd "C:\Users\ederf\OneDrive\Desktop\Fantasy"
```
```bash
git add -A
```
```bash
git commit -m "Descripción del cambio"
```
```bash
git push
```

Los datos de la base de datos (usuarios, equipos, ligas, puntos) se conservan entre despliegues.

---

## Si algo falla

| Síntoma | Solución |
|---|---|
| La compilación falla en Render | Abre *Logs*, copia el error y revisa que el repositorio subido esté completo |
| `ADMIN_PASSWORD` rechazada al arrancar | No se permite la contraseña de ejemplo `Admin12345!`: pon una propia en *Environment* y pulsa *Manual Deploy* |
| Error de conexión a la base de datos | Revisa que `DATABASE_URL` sea la cadena **directa** de Neon (sin pooling) y termine en `sslmode=require` |
| `/api/health` muestra `bootstrapError` | La carga inicial falló. Corrige la causa y reinicia el servicio (*Manual Deploy → Restart*): la carga se reintenta sola |
| Tarda mucho en abrir | Estaba dormida (plan gratuito): espera unos 50 s o configura cron-job.org |
