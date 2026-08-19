# Mantenimiento

El addon depende de varias capas externas que **no están bajo nuestro control**. Cuando
deje de funcionar, seguí esta guía para diagnosticar y arreglar.

## Capas involucradas

| Capa | Ejemplo | Riesgo |
|------|---------|--------|
| Origen de la agenda | `alangulotv.si/agenda.php`, `futbollibretv.sx/eventos.js`, `agenda18.com/agenda.json` (fuentes que crean eventos); `deporflix.pe` (WP REST + admin-ajax) como fuente complementaria | Cambian estructura o caen |
| Endpoint de reproducción | `la18hd.su`, `streamtp-golden1.click`, `streamx488.sbs` | Caen, cambian de dominio, anti-hotlink |
| Host del m3u8 | `fubo18.com`, `tudeporteshoy.xyz` | Tokens efímeros, bloqueos por IP |
| Portadas | `thesportsdb.com` | Rate-limit, cambio de API |

## Síntomas y diagnóstico

### A. El catálogo aparece vacío
- Posible: cambiaron las fuentes de agenda.
- Probar: `npm test` → si muestra `Eventos encontrados: 0`, inspeccioná cada fuente:
  - `curl -A "Mozilla/5.0" https://alangulotv.si/agenda.php` y revisá `parseAgenda()`.
  - `curl -A "Mozilla/5.0" https://futbollibretv.sx/eventos.js` y revisá el regex de
    `EVENTOS_DATA` en `lib/scraper-futbollibre.js`.
  - `curl -A "Mozilla/5.0" https://agenda18.com/agenda.json?v=1.1` y revisá
    `parseAgendaJson()` en `lib/scraper-agenda18.js` (estructura Strapi).
- Si solo una fuente falla, las otras siguen alimentando el catálogo (uso de
  `Promise.allSettled`).

### B. El catálogo carga pero los streams no reproducen
- Posible 1: el endpoint de 3º cambió el nombre de la variable del m3u8.
  - Probar: abrir en el navegador la URL decodificada del `r` y buscar `playbackURL`.
  - Si ahora usa otro nombre (ej. `sourceUrl`) o cambió el formato ofuscado
    (`kv`/`jY`), actualizá los regex en `lib/extractor.js`.
- Posible 2: anti-hotlink / referer. Algunos endpoints devuelven un HTML distinto o
  redirigen si no viene el `Referer` adecuado. En `lib/extractor.js` se envía
  `Referer` alagulotv; para `la18hd.su` conviene `https://agenda18.com/`. Si un host
  nuevo lo exige, ajustá el referer por dominio.
- Posible 3: el dominio del m3u8 bloquea la IP que descarga el contenido. En la
  arquitectura actual el streaming sale del **PC local** (IP residencial) vía el proxy
  de `127.0.0.1:7000` (expuesto por el túnel de Cloudflare), y Netlify solo sirve
  catálogo/portadas/streams con `PROXY_BASE_URL` apuntando al túnel. Como la IP
  residencial coincide con la del token, el reproductor siempre recibe segmentos
  válidos. Si un proveedor nuevo bloqueara esa IP por completo (no solo el token),
  no hay fix salvo cambiar de IP/red.
- Posible 3b: **el PC servidor está apagado o el túnel caído.** El streaming depende
  del PC local (ver sección "El server no reproduce" abajo).
- Posible 4: **DRM**. Los embeds de `tarjetarojita.xyz`/`proveseat.net` y `la10tv.com`
  usan cifrado/DRM y ya se descartan en `lib/scraper-agenda18.js`. Si aparece un
  proveedor nuevo con `_econfig`, `license` o `.mpd`, descartalo igual.

### C. "token expired" / el m3u8 devuelve 403
- Esperado si el m3u8 se reutilizó tras unos minutos. El addon ya genera el token en
  el momento del `stream`, así que no debería pasar salvo que el servidor de 3º tenga
  un reloj desincronizado. No cachear los `url` de stream.
- En fuentes tipo `canal.php` (la18hd/streamtp), los segmentos de fubo18 expiran en
  **~2 s** y la página **rota nodos CDN** (`bmf0aw9u` / `b2ZmaWNpYWw`) con ventanas de
  segmentos distintas. Por eso el proxy reescribe por **índice** (`idx`) y, si la URL
  directa falla, **re-extrae la playlist fresca dentro de la misma invocación** (misma
  IP = token válido). Si un segmento sigue dando 404, es que el índice quedó viejo; el
  proxy ya camina hacia atrás desde el segmento más nuevo.

### C2. Los posters salen "de cabeza" o viejos (texto girado 180°)
- El texto del poster se genera al derecho desde el servidor (verifique
  `/poster/:id.png` en el navegador). Si en Stremio sigue saliendo girado o antiguo,
  es **caché**: tanto Stremio como la CDN (`s-maxage=1800`, ~30 min) cachean las
  imágenes. Desinstalá los addons viejos (cada `id` tiene su propia caché), instalá el
  actual y esperá ~30 min o reiniciá Stremio.
- Si hay que forzar limpieza global: cambiar el `id` del addon en `manifest.js`
  (ej. `com.metegol.live.v5` → `v6`) invalida toda la caché de Stremio (addon nuevo),
  aunque la CDN tarda hasta ~30 min en refrescarse.

### D. Las portadas no muestran escudos
- TheSportsDB tiene rate-limit (~30 req/min). El addon cachea resultados en memoria
  (TTL 6 h), pero en el primer arranque puede tardar. Sin escudo, el poster igual
  muestra el **deporte arriba y los nombres de los equipos abajo** (texto normalizado,
  sin tildes). El texto grande centrado del deporte solo aparece si no se pudo extraer
  ningún nombre de equipo del título.

## Checklist periódico

- [ ] `npm test` devuelve eventos y al menos un m3u8 válido.
- [ ] El primer evento reproduce en Stremio.
- [ ] Las tres fuentes principales de agenda devuelven datos (verificar en catálogo).
- [ ] Deporflix solo agrega streams dentro de eventos existentes (nunca eventos solos
      "fijos"); verificar que no aparezcan partidos de días anteriores.
- [ ] Los endpoints de 3º conocidos siguen activos (ver abajo).

## Dominios conocidos (a agosto 2026)

- Origen de agenda: `alangulotv.si`, `futbollibretv.sx`, `agenda18.com`, `img.agenda18.com`,
  `deporflix.pe` (WP REST `/wp-json/wp/v2/search` + `admin-ajax.php` con `doo_player_ajax`)
- Endpoints de reproducción: `la18hd.su/vivo/canales.php`, `streamtp-golden1.click/global1.php`,
  `streamx488.sbs/global1.php`
- Hosts m3u8: `*.fubo18.com`, `*.tudeporteshoy.xyz`
- Descartados (DRM/cifrado): `tarjetarojita.xyz` (`proveseat.net`), `la10tv.com`
- Portadas: `thesportsdb.com` (API v1, key de test `3`)

> Si alguno desaparece, el addon seguirá funcionando para los demás; solo hay que
> actualizar los patrones del extractor si cambian la forma de exponer el m3u8.

## Prioridad de proveedores

`PROVIDER_PRIORITY` en `lib/scraper.js` ordena los streams por estabilidad. Si un
proveedor empieza a fallar seguido, subí su número (mayor = va después):

```js
const PROVIDER_PRIORITY = {
  'la18hd.su': 1,            // más estable, primero
  'fubo18.com': 2,
  'tudeporteshoy.xyz': 3,
  'streamtp-golden1.click': 4,
  'streamx488.sbs': 5        // menos estable, al final
}
```

## El server no reproduce (PC servidor 24/7)

El streaming sale del **PC local** vía el proxy de `127.0.0.1:7000` y el túnel de
Cloudflare. Si el catálogo carga (Netlify responde) pero los streams no reproducen,
el problema está en el PC/túnel. Diagnóstico en orden:

1. **¿Está encendido el PC servidor?** Si hiberna/dormita, el túnel se cae.
   - Configurar plan de energía: nunca dormir.
2. **¿Están corriendo los servicios?**
   ```powershell
   Get-Service cloudflared, MeteGol
   ```
   - `MeteGol` (addon local): debe estar `Running`. Si no, `nssm start MeteGol`.
   - `cloudflared`: debe estar `Running`. Si no, `net start cloudflared`.
3. **¿Responde el proxy local?**
   ```powershell
   Invoke-WebRequest http://127.0.0.1:7000/manifest.json
   ```
4. **¿Responde el túnel?**
   ```powershell
   Invoke-WebRequest https://stream.metegol-live.eu.org/manifest.json
   ```
5. **¿Está el proxy local haciendo requests?** Revisar `addon.log`/`addon.err.log`
   (configurados con NSSM): si el reproductor pide segmentos y el log crece, el
   streaming fluye.

### URLs que cambian (quick tunnel)

Si se usa un *quick tunnel* (`trycloudflare`), la URL es aleatoria y **cambia en cada
reinicio** de cloudflared. Eso rompe el streaming aunque el PC esté bien. Fix:

1. Tomar la nueva URL del log de cloudflared.
2. `npx netlify-cli env:set PROXY_BASE_URL https://nueva-url.trycloudflare.com --site <site-id>`
3. Redeploy (los cambios de env no aplican sin redeploy).

> Para evitar esto, usar el **túnel nombrado** con dominio propio
> (`stream.metegol-live.eu.org`) — la URL nunca cambia. Ver `SERVIDOR.md`.

## Actualizar el addon

```bash
git pull        # o editar archivos
npm install     # si cambian dependencias
npm start
```

Para Netlify, cada deploy publica la última versión:

```bash
npx netlify-cli deploy --prod --dir public --functions netlify/functions --site <site-id>
```

(antes: Vercel con `npm run vercel:deploy` — legacy, ya no se usa).