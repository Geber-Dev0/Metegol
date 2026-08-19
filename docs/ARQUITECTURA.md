# Arquitectura de MeteGol

## Cadena de datos

```mermaid
flowchart TD
    A[Stremio] -->|catalog/tv/deportes| B[defineCatalogHandler]
    A -->|meta/tv/metegol_xxx| M[defineMetaHandler]
    A -->|stream/tv/metegol_xxx| C[defineStreamHandler]

    B --> D[scraper.getEvents]
    D -->|GET agenda.php| E1[(alangulotv.si/agenda.php)]
    D -->|GET eventos.js| E2[(futbollibretv.sx/eventos.js)]
    D -->|GET agenda.json| E3[(agenda18.com/agenda.json)]
    D -->|GET WP REST + admin-ajax| E4[(deporflix.pe partidos vs)]
    E1 -->|HTML| D
    E2 -->|EVENTOS_DATA| D
    E3 -->|JSON Strapi| D
    E4 -->|embed la18hd/fubo18| D
    D -->|merge + dedupe + prioridad| B
    B -->|metas con portada PNG| A
    A -->|GET poster/:id.png| P2[lib/teamlogos.js]
    P2 -->|escudos| S[(thesportsdb.com)]
    P2 -->|opentype + sharp| A

    M --> D2[scraper.getEventByTitle]
    D2 --> D
    D2 -->|evento| M
    M -->|meta| A

    C --> F[scraper.getEventByTitle]
    F --> D
    F -->|evento + enlaces| C
    C --> G[extractor.getStreamUrl]
    G -->|GET endpoint 3º| H[(la18hd.su / streamtp-golden1.click / streamx488.sbs)]
    H -->|HTML con playbackURL| G
    G -->|m3u8| C
    C -->|streams (proxy seg.m3u8)| A
    A -->|reproduce m3u8 via /proxy| P[lib/proxy.js]
    P -->|vía 1: URL tokenizada directa| I[(fubo18.com / tudeporteshoy.xyz)]
    P -->|vía 2: re-extrae la página y toma el segmento por idx| I
    I -->|m3u8 + .ts| P
    P -->|m3u8 reescrito + segmentos| A
```

## Capas

1. **Fuentes de datos**
   - `alangulotv.si/agenda.php` — HTML con la agenda del día. Cada evento es un
     `<li class="XX">` con título, hora (`<span class="t">`) y canales
     (`<li class="subitem1/2">`). Cada canal tiene `/eventos.html?r=<BASE64>`.
   - `futbollibretv.sx/eventos.js` — archivo JS con `const EVENTOS_DATA = [...]` en el
     mismo formato (`clase`, `titulo`, `hora`, `canales`). Los enlaces también son
     `/eventos.html?r=<BASE64>`.
- `agenda18.com/agenda.json` — JSON estilo Strapi compartido por futbollibre.mx y
     rojadirectaa.net. Eventos con `diary_hour`, `diary_description`, `deportes`,
     `embeds` (iframe con `r=<BASE64>`) y `country` (con bandera). Se descartan los
     embeds de `tarjetarojita.xyz`/`proveseat` (DRM cifrado) y `la10tv.com` (DRM).
   - `deporflix.pe` — WordPress con tema **Dooplay**; los partidos puntuales ("X vs Y")
     se listan vía `wp-json/wp/v2/search?search=vs&per_page=20&_embed=1` (cada uno es
     una página bajo `/canales/` con `data-post` = id del post). El embed se obtiene
     con un POST a `/wp-admin/admin-ajax.php` (`action=doo_player_ajax&post=<id>&nume=1&type=movie`)
     con header `X-Requested-With: XMLHttpRequest`, que devuelve
     `{"embed_url":"https://la18hd.su/vivo/canales.php?stream=..."}` — el mismo formato
     `canal.php` que ya maneja el proxy. Se filtran los resultados sin formato de
     partido (p. ej. `/destacado/`).

2. **Scraper — `lib/scraper.js`**
   - Descarga las **cuatro** fuentes en paralelo (`Promise.allSettled`, si una falla no
     tumba al resto) y las fusiona con `mergeEvents()`.
   - `mergeEvents()` deduplica por **título normalizado** (sin acentos, mayúsculas ni
     guiones) y combina los enlaces del mismo partido (`mergeStreams`).
   - `sortStreams()` ordena los enlaces de cada evento por **prioridad de proveedor**
     (`PROVIDER_PRIORITY`): `la18hd.su` primero, luego `fubo18.com`,
     `tudeporteshoy.xyz`, `streamtp-golden1.click`, `streamx488.sbs`; los hosts
     desconocidos al final. Prefiere `720p/1080p` y `Español`.
   - `titleToId()` / `idToTitle()` convierten el título en un `id` estable
     (`metegol:<base64url>`), de modo que el stream no se rompe entre refrescos del
     catálogo (el token no entra en el id).
   - `classify()` mapea la clase del `<li>` (ES, AR, IT, UFC...) a un deporte con emoji.

3. **Scrapers específicos**
   - `lib/scraper-futbollibre.js` — extrae el array `EVENTOS_DATA` del JS (regex sobre
     el literal JSON) y decodifica los `r`.
   - `lib/scraper-agenda18.js` — parsea el JSON de Strapi, convierte la hora de
     `America/Lima` (UTC-5) a hora local y agrega la bandera de país
     (`img.agenda18.com/uploads/...`).
   - `lib/scraper-deporflix.js` — consulta la búsqueda de WordPress, filtra los items
     con formato de partido, hace el POST AJAX por cada uno (en paralelo) para obtener
     el `embed_url`, y los agrega al merge con `source: 'DF'`. `classifyTitle()` mapea
     nombres de competiciones conocidas (conferencias CONMEBOL, Liga MX, Serie A, etc.)
     a un deporte/emoji; el resto se etiqueta como genérico.

4. **Portadas — `lib/teamlogos.js`**
   - `parseTeams()` extrae hasta dos equipos del título (tras el primer `:` y separados
     por `vs`/`-`/`@`).
   - `searchTeam()` consulta **TheSportsDB** (`/api/v1/json/3/searchteams.php?t=`), con
     caché en memoria (TTL 6 h) para respetar el rate-limit.
- `eventPoster()` compone un **PNG** (`sharp`) de 500×280. En serverless no hay
     fuentes (fontconfig roto), así que el texto se convierte a **trazas SVG** con `opentype.js`
     sobre la fuente embebida `assets/DejaVuSans-Bold.ttf` (`textToPath()`). Cada glifo
     se genera con `charToGlyph` + `getPath` por separado (DejaVu dispara lookups de
     ligaduras no soportadas si se procesa el texto entero).
   - **Clave:** `getPath` de opentype entrega los contornos espejados en vertical, así
     que `textToPath()` invierte el eje Y (`scale(1,-1)`) alrededor del **centro
     vertical del texto** (calculado del rango de `y` de los paths) para dejarlo al
     derecho sin moverlo de su posición.
   - El texto se **normaliza sin tildes/diacríticos** (`removeDiacritics`: á→a, ñ→n,
     ü→u) para no depender de glifos especiales.
   - Layout del poster: deporte arriba (dorado), **escudos en el medio** (si
     TheSportsDB los tiene) + "VS", y **nombres de los equipos siempre abajo**. Si el
     evento está en vivo, badge rojo "EN VIVO" arriba a la derecha. El texto grande
     centrado del deporte solo se usa como **último recurso** (cuando no hay escudos ni
     nombres).
   - Se sirve por `/poster/:id.png` (no SVG data-URI: Stremio Android no los renderiza).
     Caché en memoria 30 min (`POSTER_TTL_MS`) + `Cache-Control` en CDN.

5. **Extractor — `lib/extractor.js`**
   - Consulta el endpoint del tercero con headers de navegador (y `Referer`).
   - `extractPlaybackUrl()` busca la variable `playbackURL` (tolera barras escapadas)
     y, como fallback, el **formato ofuscado** (`kv`/`jY` = pares `[idx, base64]` con
     clave `k = fnA()+fnB()`, ver `extractObfuscatedPlaybackUrl`) o la primera URL
     `.m3u8` del HTML.
   - Devuelve el `.m3u8` real.

6. **Proxy HLS — `lib/proxy.js`**
   - **Motivo:** los proveedores generan tokens **ligados a la IP del fetch**. En
     serverless el fetch sale con IP de datacenter, y el reproductor (IP del usuario)
     no coincide → el proveedor responde 403. El proxy resuelve esto haciendo que
     TODOS los requests (m3u8 y segmentos) salgan desde la misma IP que generó el token.
   - `GET /proxy?url=<m3u8|.ts>` descarga el recurso desde la IP del servidor y:
     - Si es una playlist (`#EXTM3U`), reescribe cada segmento/variante/`URI=` para que
       también pase por `/proxy` (`rewritePlaylist()`).
     - Si es un segmento `.ts`, lo sirve tal cual (`video/mp2t`).
   - **Fuentes tipo `canal.php`** (la18hd/streamtp): el m3u8 embebido en la página
     expira en **~2 s** (fubo18) y la página **alterna nodos CDN** (`bmf0aw9u` vs
     `b2ZmaWNpYWw`) con ventanas de segmentos distintas, así que el matching por nombre
     de segmento es frágil. Por eso `rewritePlaylist()` reescribe los segmentos **por
     índice** (`idx`) contra la URL de la página:
     `/proxy/seg.<ext>?url=<tokenizada>&page=<canal>&idx=<N>[&v=<M>]`.
   - `handlePageSegment` intenta **dos vías**: ① la URL tokenizada directa (funciona si
     la instancia coincide con la IP del token, inmune a la rotación) y ② si falla
     (403/404), **re-extrae la página fresca dentro de la misma invocación** (misma IP =
     token válido) → m3u8 → segmento por `idx` (con fallback caminando desde el más
     nuevo). Las playlists media **nunca se cachean**; solo hay caché de página 10 s por
     instancia.
   - En `defineStreamHandler` el m3u8 se devuelve envuelto en la URL del proxy **con
     extensión forzada `.m3u8`** (`proxiedUrl(proxyBase, s.url, 'm3u8')`): la URL real
     termina en `.php` y los players internos de Stremio Android (ExoPlayer/Media3) no
     la reconocen como HLS, fallan y "switchean" a VLC. En local se devuelve directo.

7. **Addon — `addon.js`**
   - `addonBuilder(manifest)` declara recursos `catalog` + `meta` + `stream`, tipo `tv`.
   - `manifest.js`: id `com.metegol.live.v5`, **config de zona horaria** (`behaviorHints.configurable`),
     elegida una vez por usuario y guardada en la URL por Stremio.
   - `defineCatalogHandler` → `metas` (uno por evento) con **portada PNG** (`/poster/:id.png`).
   - `defineMetaHandler` → devuelve la meta del evento (necesario para que Stremio
     trate el ítem como canal de TV jugable).
   - `defineStreamHandler` → por cada enlace del evento, extrae el m3u8 en paralelo y
     lo devuelve como stream (a través del proxy, forzando extensión `.m3u8`).
   - `createApp()` monta Express + las rutas `/proxy` + `/poster/:id` + `/configure`
     (página de instalación con botones INSTALL / INSTALL EN WEB / COPIAR URL) + el
     **router** (`getRouter`) para serverless. Si se ejecuta `node addon.js`, usa
     `serveHTTP` para el servidor local.

## Modelo de datos de un evento

```js
{
  title:   'Primera División: Deportes Limache vs Universidad Chile',
  time:    '22:30',
  sport:   'Chile',
  emoji:   '🇨🇱',
  flagUrl: 'https://img.agenda18.com/uploads/chile_86c07a7b38.png', // solo agenda18
  streams: [
    { source: 'A18', label: 'TNT Sports Premium CL · Español', url: 'https://la18hd.su/vivo/canal.php?stream=tntsportschile' },
    { source: 'OP1', label: 'TNT Sports Premium Calidad 720p', url: 'https://streamx488.sbs/global1.php?channel=tntsportscl' }
  ]
}
```

## Clave técnica: tokens efímeros

Los `.m3u8` de los servidores de terceros llevan un `?token=...` que **expira en
pocos minutos** (los timestamps embebidos en la propia URL marcan inicio/fin de
validez). Por eso:

- El fetch al endpoint de 3º y la extracción del m3u8 ocurren **dentro de
  `defineStreamHandler`**, en el instante en que el usuario abre el evento.
- **No se cachea** el m3u8; cada solicitud de stream obtiene una URL nueva.
- El `id` del evento usa solo el título (sin token), para que el catálogo y el stream
  coincidan aunque pase el tiempo.

## Despliegue serverless (Netlify)

- `netlify.toml`: `publish = "public"`, funciones en `netlify/functions`, bundler
  `esbuild` con `sharp` como `external` (por los binarios nativos), redirect `/*` →
  `/.netlify/functions/addon`.
- `netlify/functions/addon.js` envuelve `createApp()` con **`serverless-http`**
  (los media se marcan como `binary` para que Netlify los sirva crudos: `image/png`,
  `video/mp2t`, `application/octet-stream`).
- Env vars del sitio: `PUBLIC_BASE_URL` (URL pública del addon), `FOOTBALL_API_KEY`
  (portadas). `PROXY_BASE_URL` opcional: si no está, el proxy usa `PUBLIC_BASE_URL`.
- **Clave:** en Netlify (igual que en Vercel) los tokens quedan ligados a la IP del
  datacenter, por eso el `defineStreamHandler` devuelve el m3u8 **envuelto en `/proxy`**
  (`lib/proxy.js`), que descarga m3u8 y segmentos desde la misma IP del token y los
  reescribe para el reproductor. Sin el proxy, el TV recibiría 403 (IP distinta a la
  del token).
- Consideraciones de Netlify: cada segmento `.ts` es una invocación de la función; el
  plan free (deploy de funciones) alcanza holgado para uso personal.
- **Por qué no Cloudflare Workers como proxy:** fubo18 **bloquea los rangos IP
  compartidos de Workers** (403 al pedir el m3u8; el mismo flujo da 200 desde
  Netlify/Vercel o una IP residencial). El port `workers/proxy/` queda desplegado como
  respaldo para hosts que no bloqueen a Cloudflare; se activaría seteando
  `PROXY_BASE_URL` a su URL.
- **Por qué se dejó Vercel:** el plan free de Vercel agota el **Fast Origin Transfer**
  (~10 GB/mes) por el streaming del proxy, así que el addon pasa a Netlify.
  `api/index.js`/`vercel.json` quedan por compatibilidad.