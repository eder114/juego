# ⚽ Premier Fantasy

Fantasy Football Manager completo basado en la **Premier League inglesa** (temporada 2026/27) con jugadores, clubes, calendario y estadísticas **reales** obtenidos de la API oficial de Fantasy Premier League.

Los usuarios crean su equipo con £100M, fichan 15 jugadores reales, configuran su once en un campo visual con arrastrar y soltar, compiten en ligas privadas y suman puntos según el rendimiento real de cada jornada.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19 · TypeScript · Vite 7 · Tailwind CSS 4 · React Router 7 · TanStack Query · Recharts · Lucide · dnd-kit |
| Backend | Node.js · Express 5 · TypeScript · Zod |
| Base de datos | Prisma 6 · SQLite (desarrollo) / PostgreSQL (producción) |
| Autenticación | JWT (Bearer) · bcrypt (12 rondas) · tokens de recuperación SHA-256 con caducidad |
| Tests | Vitest (motor de puntuación, alineaciones, sustituciones y precios) |

## Publicar en internet y usar en el teléfono

- **Gratis en internet**: Render (aplicación) + Neon (PostgreSQL). Guía paso a paso en **[DESPLIEGUE.md](DESPLIEGUE.md)**; la configuración está en `render.yaml`.
- **App para teléfono (PWA)**: se instala desde el navegador (Android: *Instalar app*; iPhone: *Compartir → Añadir a pantalla de inicio*). Funciona a pantalla completa con icono propio, con navegación inferior, campos sin zoom en iOS, zonas seguras del notch y fotos de perfil reducidas antes de subirlas.
- **Producción**: el backend sirve la web compilada. Con la base de datos vacía, la temporada se carga sola en el primer arranque. El esquema PostgreSQL se genera desde el mismo `schema.prisma` (`npm run build:render`).

## Puesta en marcha

Requisitos: **Node.js 20+**.

```bash
npm run setup      # instala dependencias, crea la BD, carga datos reales y usuarios demo
npm run dev        # API en http://localhost:4000 · web en http://localhost:5173
```

El archivo `server/.env` se crea a partir de `server/.env.example` (cambia `JWT_SECRET` en producción).

### Cuentas iniciales

| Rol | Email | Contraseña |
|---|---|---|
| Administrador | `admin@premierfantasy.local` | `Admin12345!` |
| Mánager demo (equipo completo y ligas) | `demo@premierfantasy.local` | `Demo12345!` |

Los 12 mánagers demo son usuarios ficticios (`npm run db:demo`); **jugadores, clubes, partidos y resultados son reales**. Para una instalación limpia sin demo ejecuta solo `npm run db:push -w server && npm run db:seed -w server`.

### Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | API + frontend en modo desarrollo |
| `npm run build` / `npm start` | Compila ambos; en producción el backend sirve el frontend |
| `npm test` | Tests del dominio (21 casos) |
| `npm run typecheck` | Comprobación de tipos de servidor y cliente |
| `npm run data:fetch` | Descarga los datos reales de la temporada desde la API de FPL a `server/data/season-2026-27` |
| `npm run db:reset -w server` | ⚠️ Borra la base de datos y la vuelve a cargar (solo desarrollo) |

## Datos reales

- **Fuente**: API pública de Fantasy Premier League (`bootstrap-static`, `fixtures`, `element-summary`, `event/{n}/live`).
- **Snapshot incluido** en `server/data/season-2026-27/` (JSON normalizado): 20 clubes, 658 jugadores, 38 jornadas, 380 partidos, estadísticas por partido e historial de precios.
- **Clubes 2026/27**: Arsenal, Aston Villa, Bournemouth, Brentford, Brighton, Chelsea, **Coventry City**, Crystal Palace, Everton, Fulham, **Hull City**, **Ipswich Town**, Leeds, Liverpool, Man City, Man Utd, Newcastle, Nottingham Forest, Tottenham y Sunderland. West Ham, Wolves y Burnley no están porque descendieron en 2025/26.
- `clubs.json` contiene los metadatos locales (ciudad, estadio, colores); el resto se genera con `data:fetch`.
- **Actualización** por cuatro vías: API (panel admin → *Datos* → *Sincronizar*, o automática activando `provider_auto_sync`), JSON, CSV y edición manual en el panel.
- **Cambio de temporada**: `npm run data:fetch -- --out data/season-2027-28`, ajusta `clubs.json` con ascendidos, apunta `DATA_DIR` a la nueva carpeta y ejecuta el seed. Los clubes que no están en el dataset quedan inactivos.

## Estructura

```
Fantasy/
├── server/
│   ├── prisma/            schema.prisma · seed.ts (datos reales) · demo.ts
│   ├── data/season-2026-27/  dataset normalizado (JSON)
│   ├── scripts/fetch-fpl.ts
│   ├── tests/domain.test.ts
│   └── src/
│       ├── domain/        reglas puras: puntuación, alineación/sustituciones, precios, constantes
│       ├── providers/     formato de dataset (zod) y conector FPL
│       ├── services/      mercado, alineaciones, jornadas, puntuación, precios, ligas,
│       │                  rankings, notificaciones, logros, importación, estadísticas, scheduler
│       ├── routes/        auth · catálogo · juego · usuario · admin
│       ├── middleware/    autenticación y roles
│       └── lib/           prisma, errores, validación, DTOs
└── client/src/
    ├── components/        UI, campo (Pitch), tarjetas, gráficos, escudo personalizable
    ├── pages/             inicio, mercado, jugador, comparador, equipo, alineación, ligas,
    │                      clasificación, calendario, partido, clubes, estadísticas, noticias, perfil
    └── pages/admin/       resumen, usuarios, jugadores, clubes, jornadas, partidos,
                           puntuación, ligas, noticias, datos, configuración
```

## Base de datos

Tablas: `users`, `password_reset_tokens`, `clubs`, `players`, `player_prices`, `player_injuries`, `player_statistics`, `gameweeks`, `fixtures`, `fantasy_teams`, `fantasy_team_players`, `lineups`, `lineup_players`, `transfers`, `transactions`, `leagues`, `league_members`, `league_invites`, `scoring_rules`, `settings`, `notifications`, `news`, `favorite_players`, `user_achievements`.

- El dinero se guarda en **enteros de décimas de millón** (`130` = £13.0M), sin errores de coma flotante.
- Claves foráneas con `onDelete` explícito, índices únicos compuestos (p. ej. un jugador una sola vez por plantilla y una alineación por equipo y jornada).
- Los jugadores con historial no se borran: se desactivan.
- **PostgreSQL**: cambia `provider = "postgresql"` en `schema.prisma` y `DATABASE_URL`, y ejecuta `prisma db push`.

## Reglas del juego

**Plantilla**: 2 porteros, 5 defensas, 5 centrocampistas y 3 delanteros; máximo 3 por club; £100M iniciales. Todo es configurable. Los jugadores **no son exclusivos**: varios mánagers pueden tener al mismo jugador, como en FPL, lo que permite ligas y ranking global simultáneos.

**Mercado**: se vende al precio actual (configurable a precio de compra). Cada operación queda en `transfers` y en el libro de `transactions`.

**Precios**: al cerrar cada jornada. **Rendimiento**: ≥6 pts +£0.1M, ≥10 pts +£0.2M, sin minutos o ≤1 pt −£0.1M. **Demanda**: fichajes netos de 7 días / equipos activos ≥ 10 % → ±£0.1M. Hay un tope por jornada y un rango mínimo/máximo, así que un precio nunca puede ser negativo. Todo se registra en `player_prices`.

**Alineación**: 7 formaciones, 11 titulares, 4 suplentes ordenados, capitán obligatorio y vicecapitán. Se valida la formación, que los jugadores pertenezcan a la plantilla y la disponibilidad: un lesionado o sancionado bloquea el guardado si tienes un suplente disponible en su posición.

**Bloqueos** (`lock_mode`):
- `PER_MATCH` (por defecto): cada jugador se bloquea cuando empieza el partido de su club.
- `DEADLINE`: toda la alineación se bloquea al cierre de la jornada.

Un jugador fichado después de empezar su partido **no cuenta** para esa jornada.

**Capitán**: sus puntos se multiplican ×2. Si no juega, el vicecapitán hereda el multiplicador (configurable).

**Sustituciones automáticas**: si un titular no juega ningún minuto y su partido ha terminado, entra el primer suplente válido que haya jugado, respetando la formación (un portero solo por otro portero).

**Puntuación** (editable en *Admin → Puntuación*; al guardar se recalcula toda la temporada):

| | POR | DEF | MED | DEL |
|---|---|---|---|---|
| Partido jugado | +2 (60+ min) | +2 | +2 | +2 |
| Gol | +10 | +6 | +5 | +4 |
| Asistencia | +3 | +3 | +3 | +3 |
| Portería a cero (60+ min) | +4 | +4 | +1 | – |
| Gol recibido | −1 | – | – | – |
| Penalti atajado | +5 | – | – | – |
| Amarilla / Roja | −1 / −3 | −1 / −3 | −1 / −3 | −1 / −3 |
| Gol en propia | −2 | −2 | – | – |

Hay acciones adicionales (paradas, bonus, penalti fallado…) disponibles pero desactivadas por defecto.

**Jornadas**: su estado (Próxima / En curso / Finalizada) se calcula con horarios y resultados. El *scheduler* cierra y puntúa automáticamente cada jornada al terminar todos sus partidos, actualiza los precios y envía recordatorios 24 h antes del cierre.

**Ligas**: global (automática), pública, privada (código y contraseña opcional), entre amigos (cualquier miembro invita) y por invitación (solo el administrador invita). Clasificación con variación de posición, puntos por jornada e historial.

**Clasificaciones**: temporada, semanal, mensual, global y de liga.

**Extras**: comparador de hasta 4 jugadores, favoritos, más seleccionados/fichados/vendidos, subidas y bajadas de precio, equipo y jugador de la jornada, tabla de la Premier, fichas de club, logros, noticias automáticas (resultados y partes médicos reales), notificaciones y escudo de equipo personalizable.

## API (resumen)

Todas bajo `/api`, en JSON y con `Authorization: Bearer <token>` salvo las públicas.

| Área | Endpoints |
|---|---|
| Auth | `POST auth/register · auth/login · auth/forgot-password · auth/reset-password · auth/change-password`, `GET auth/me` |
| Catálogo | `GET clubs · clubs/table · clubs/:id · players · players/:id · players/compare · gameweeks · fixtures · fixtures/:id · news · stats/team-of-the-week · stats/trends` |
| Juego | `GET dashboard · team · team/transfers · team/history · team/lineup`, `POST/DELETE team/players/:id`, `PUT team/lineup/:gw`, `GET teams/:id · teams/:id/lineup/:gw · rankings` |
| Ligas | `GET/POST leagues`, `GET leagues/public · leagues/invites · leagues/:id`, `POST leagues/join · leagues/:id/join · leagues/:id/leave · leagues/:id/invite · leagues/invites/:id`, `PATCH/DELETE leagues/:id`, `DELETE leagues/:id/members/:userId` |
| Usuario | `PATCH users/me`, `POST/DELETE users/me/avatar`, `GET users/me/stats · users/me/achievements`, notificaciones, favoritos |
| Admin | `admin/overview · users · clubs · players (+price, injuries, recover) · import/players · import/template · sync · gameweeks (+process, prices) · fixtures (+stats) · scoring-rules (+reset, preview) · leagues · news · settings · notifications` |

## Seguridad

- Validación de todas las entradas con **Zod** en el backend, con mensajes de error por campo.
- **Prisma** usa consultas parametrizadas (sin SQL concatenado), lo que protege contra inyección SQL.
- Contraseñas con bcrypt, política de 8+ caracteres con letras y números, y comparación en tiempo constante en el login.
- JWT con expiración. En cada petición se comprueba el usuario en la base de datos, así que desactivarlo o cambiarle el rol tiene efecto inmediato.
- Control de roles (`USER` / `ADMIN`) en rutas y en la interfaz. Rutas privadas protegidas en el frontend.
- `helmet` (con CSP), CORS restringido, *rate limiting* global y más estricto en autenticación, límite de tamaño de peticiones.
- Recuperación de contraseña sin revelar si el email existe. Los tokens se guardan hasheados, caducan en 1 hora y son de un solo uso.
- Subida de avatar limitada a PNG/JPG/WEBP de hasta 2 MB con nombres aleatorios.
- Errores centralizados que no exponen detalles internos en producción.

## Notas

- Sin `SMTP_HOST`, el enlace de recuperación de contraseña se imprime en la consola del servidor.
- La sincronización automática con FPL viene **desactivada** (`provider_auto_sync`). Actívala en *Admin → Configuración* para seguir la temporada en vivo, o desactívala si prefieres registrar los resultados a mano, porque la sincronización los sobrescribiría.
- Los datos proceden de la API no oficial pública de FPL, que puede cambiar su formato. El conector está aislado en `server/src/providers/fpl.provider.ts`.
