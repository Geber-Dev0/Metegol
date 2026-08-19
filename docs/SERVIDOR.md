# MeteGol en modo servidor (PC dedicado 24/7)

Guía para dejar el addon corriendo en un PC que queda encendido como servidor
de streaming, con URL estable y sin depender de una máquina específica.

> ⚠️ **Seguridad:** el repositorio es **público**. Nunca commitees `.env`,
> tokens, API keys ni secretos. Esta guía usa valores de ejemplo; los secretos
> reales solo viven en archivos locales o en el panel de cada servicio.

## Arquitectura final

| Qué | Dónde corre | Para qué |
|-----|-------------|----------|
| Catálogo, portadas, manifest, `/stream` | **Netlify** (`metegol-887.netlify.app`) | Interfaz con Stremio (HTTPS público) |
| Addon local + proxy HLS | **Tu PC** (`127.0.0.1:7000`) | Descarga m3u8 y segmentos desde tu IP |
| Túnel Cloudflare | **Tu PC** (cloudflared) | Expone el proxy local con URL HTTPS estable |

**Por qué el proxy corre en tu PC:** los proveedores de streams generan tokens
**ligados a la IP** que pide la playlist. Las IPs de datacenter (Netlify, Vercel)
están bloqueadas o dan 403 (fubo18 bloquea incluso los rangos de Cloudflare
Workers). Desde tu IP residencial el flujo completo da 200. Por eso:

- Netlify solo sirve catálogo/portadas/streams (**sin descargar contenido**).
- Los `.m3u8` y `.ts` los descarga **tu PC** vía el proxy en `127.0.0.1:7000`.
- El túnel cloudflared reenvía HTTPS público → `127.0.0.1:7000`.

## Requisitos del PC servidor

- Windows 10/11 (64 bits).
- Node.js 18+ (probado con v24): <https://nodejs.org>
- Git: <https://git-scm.com>
- Conexión a internet estable (no hace falta abrir puertos: el túnel es saliente).
- **El PC debe quedar encendido** (configurar plan de energía para que no hiberne).

## Instalación desde cero

### 1. Node.js y Git

Instalar Node.js (LTS) y Git desde los links de arriba. Verificar:

```powershell
node --version   # v18 o superior
git --version
```

### 2. Clonar el repositorio

```powershell
cd $HOME\Desktop
git clone https://github.com/Geber-Dev0/Metegol.git
cd Metegol
npm install
```

> `npm install` puede tardar varios minutos (descarga sharp y dependencias).

### 3. Crear el `.env` local

El archivo `.env` **no está en el repo** (gitignored). Crearlo con el editor:

```powershell
notepad .env
```

Contenido (reemplazar el valor por la key real de API-Football):

```
FOOTBALL_API_KEY=TU_KEY_DE_API_FOOTBALL
```

### 4. Probar el addon local

```powershell
node addon.js
```

Debe aparecer:

```
MeteGol addon corriendo en http://127.0.0.1:7000/manifest.json
```

Verificar en el navegador:

- <http://127.0.0.1:7000/manifest.json>
- <http://127.0.0.1:7000/catalog/tv/deportes.json> → debe tener `metas`

Probar también el flujo sin servidor:

```powershell
npm test
```

> Dejar el `node addon.js` corriendo en una terminal (o pasar al paso de
> servicios de Windows, sección 7).

## 5. Instalar cloudflared (túnel Cloudflare)

1. Descargar: <https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe>
2. Crear carpeta `C:\cloudflared\` y mover ahí el exe con nombre `cloudflared.exe`.
3. Agregar a PATH (sesión actual):

```powershell
$env:Path += ";C:\cloudflared"
cloudflared --version
```

Para que quede permanente, agregar `C:\cloudflared` a las variables de entorno
del sistema (Configuración → Sistema → Acerca de → Configuración avanzada del
sistema → Variables de entorno → Path).

## 6. Túnel nombrado (URL estable)

El túnel nombrado da una URL fija (`https://stream.metegol-live.eu.org`) que no
cambia al reiniciar. Requiere un dominio en Cloudflare (ver `.eu.org` abajo).

```powershell
# 1. Login (abre el navegador; elegir el dominio metegol-live.eu.org)
cloudflared tunnel login

# 2. Crear el túnel (guarda el UUID y el archivo .json en ~\.cloudflared)
cloudflared tunnel create metegol

# 3. Ruta DNS: crea el CNAME hacia el túnel
cloudflared tunnel route dns metegol stream.metegol-live.eu.org

# 4. Configurar ingress
notepad $HOME\.cloudflared\config.yml
```

Contenido de `config.yml` (reemplazar `<UUID>`):

```yaml
tunnel: <UUID>
credentials-file: C:\Users\<TU_USUARIO>\.cloudflared\<UUID>.json

ingress:
  - hostname: stream.metegol-live.eu.org
    service: http://127.0.0.1:7000
  - service: http_status:404
```

Correr y verificar:

```powershell
cloudflared tunnel --config $HOME\.cloudflared\config.yml run metegol
# en otra terminal:
Invoke-WebRequest https://stream.metegol-live.eu.org/manifest.json
```

> **Antes de que exista el dominio:** se puede usar un *quick tunnel* temporal
> (URL aleatoria que cambia al reiniciar) — ver sección 8.

## 7. Dominio `.eu.org` (gratis)

1. Crear cuenta en <https://nic.eu.org/arf/> y verificar el email.
2. Antes de pedir el dominio, **añadirlo como sitio en Cloudflare**:
   - Dashboard Cloudflare → **Add a site** → `metegol-live.eu.org` → plan Free.
   - Cloudflare asigna 2 nameservers (ej. `armando.ns.cloudflare.com`).
3. En nic.eu.org solicitar el dominio `metegol-live.eu.org` indicando como
   nameservers los 2 de Cloudflare.
4. **La aprobación es humana y puede tardar días o semanas.**
5. Cuando nic.eu.org apruebe y delegue, la zona en Cloudflare pasa de *pending*
   a *active* → recién ahí el túnel nombrado con esa URL funciona.

Mientras tanto, el quick tunnel de la sección 8 sigue funcionando.

## 8. Quick tunnel (temporal, sin dominio)

Útil para probar o como respaldo mientras llega el `.eu.org`:

```powershell
cloudflared tunnel --url http://127.0.0.1:7000 --no-autoupdate
```

Da una URL tipo `https://xxxx-yyyy.trycloudflare.com` que **cambia cada vez que
se reinicia cloudflared**. Si se usa como `PROXY_BASE_URL` en Netlify, hay que
actualizarla y redesplegar en cada reinicio.

## 9. Servicios de Windows (auto-inicio)

Para que el server arranque solo al encender el PC.

### cloudflared como servicio

```powershell
# (con el config.yml ya creado en ~\.cloudflared)
cloudflared service install
Get-Service cloudflared        # debería estar "Running"
```

Ver detalle: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/routing-to-tunnel/>

### addon como servicio (con NSSM)

1. Descargar NSSM: <https://nssm.cc/download> (descomprimir, usar `nssm.exe` de win64).
2. Mover `nssm.exe` a `C:\cloudflared\` o carpeta de herramientas.

```powershell
C:\cloudflared\nssm.exe install MeteGol "C:\Program Files\nodejs\node.exe" "C:\Users\<TU_USUARIO>\Desktop\Metegol\addon.js"
C:\cloudflared\nssm.exe set MeteGol AppDirectory "C:\Users\<TU_USUARIO>\Desktop\Metegol"
C:\cloudflared\nssm.exe set MeteGol AppStdout "C:\Users\<TU_USUARIO>\Desktop\Metegol\addon.log"
C:\cloudflared\nssm.exe set MeteGol AppStderr "C:\Users\<TU_USUARIO>\Desktop\Metegol\addon.err.log"
C:\cloudflared\nssm.exe start MeteGol
Get-Service MeteGol
```

> NSSM lanza el servicio y lo mantiene vivo (reinicia si el proceso muere).

Verificación final de servicios:

```powershell
Get-Service cloudflared, MeteGol
Invoke-WebRequest http://127.0.0.1:7000/manifest.json
Invoke-WebRequest https://stream.metegol-live.eu.org/manifest.json
```

## 10. Netlify (catálogo/portadas/streams públicos)

```powershell
cd C:\Users\<TU_USUARIO>\Desktop\Metegol
npx netlify login
npx netlify-cli deploy --prod --dir public --functions netlify/functions --site <SITE_ID>
```

Variables de entorno del sitio:

| Variable | Valor |
|----------|-------|
| `PUBLIC_BASE_URL` | `https://<tu-proyecto>.netlify.app` |
| `FOOTBALL_API_KEY` | key real de API-Football |
| `PROXY_BASE_URL` | `https://stream.metegol-live.eu.org` (o la URL del quick tunnel) |

```powershell
npx netlify-cli env:set PUBLIC_BASE_URL https://metegol-887.netlify.app --site <SITE_ID>
npx netlify-cli env:set FOOTBALL_API_KEY <TU_KEY> --site <SITE_ID>
npx netlify-cli env:set PROXY_BASE_URL https://stream.metegol-live.eu.org --site <SITE_ID>
```

> Tras cambiar env vars hay que **redesplegar** para que tomen efecto.

## 11. Checklist de verificación end-to-end

1. `npm test` → muestra eventos del día y un m3u8 válido.
2. `http://127.0.0.1:7000/catalog/tv/deportes.json` → `metas` con eventos.
3. `https://stream.metegol-live.eu.org/catalog/tv/deportes.json` → igual (vía túnel).
4. `https://metegol-887.netlify.app/catalog/tv/deportes.json` → igual (Netlify).
5. Abrir un stream en Stremio (instalar `https://metegol-887.netlify.app/manifest.json`).
6. Verificar que el reproductor recibe el m3u8 **vía el túnel** y los `.ts` se
   descargan desde tu PC (los logs de `addon.log` muestran los requests del proxy).

## Inventario de credenciales (sin valores)

| Secreto | Dónde vive | Cómo regenerarlo |
|---------|-----------|------------------|
| Netlify auth token (`nfp_...`) | Variable de entorno / sesión | `npx netlify login` |
| Netlify site ID | `netlify-cli` link / panel | Panel Netlify → Site settings |
| `FOOTBALL_API_KEY` | `.env` local + env var de Netlify | Panel API-Football |
| OAuth Cloudflare (wrangler) | `AppData\Roaming\xdg.config\.wrangler\config\default.toml` | `npx wrangler login` |
| cert.pem cloudflared | `~\.cloudflared\cert.pem` | `cloudflared tunnel login` |
| UUID del túnel + `.json` | `~\.cloudflared\` | `cloudflared tunnel create metegol` |
| Cuenta nic.eu.org | navegador (nic.eu.org) | Registro de cuenta |
| Cuenta GitHub | repo público (GitHub) | - |

> **Regla de oro:** nada de esto va al repo. `.env` está en `.gitignore` y los
> archivos de `~\.cloudflared` no pertenecen al proyecto.

## Troubleshooting rápido

| Síntoma | Causa probable | Fix |
|---------|---------------|-----|
| Catálogo vacío en Netlify pero lleno en local | Fuente de agenda caída o cambio de estructura | `npm test` + ver `lib/scraper*.js` |
| Streams no reproducen | PC apagado, túnel caído o servicio detenido | `Get-Service cloudflared, MeteGol` |
| `trycloudflare` URL cambió | Quick tunnel reiniciado | Actualizar `PROXY_BASE_URL` en Netlify + redeploy |
| 403 en m3u8 | Túnel no apunta al proxy correcto | Verificar ingress del `config.yml` |
| PC hiberna y deja de servir | Plan de energía | Configurar "nunca dormir" |