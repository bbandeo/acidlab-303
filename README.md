# td3

Generador de patrones ácidos para el Behringer TD-3. Una skill de Claude Code traduce una intención musical (ej. "Fa menor frigio, densidad 65%, Rominimal") a un `bank.json` con 4 variaciones (A/B/C/D) de 16 pasos; este paquete Python lo valida y lo muestra. El agente nunca toca bytes.

Origen del requisito: `raw/2026-11-21-perfil-ia-profesional.md` §2 ítem 2.

## Estado por hito

| Hito | Contenido | Estado |
|---|---|---|
| M0 | Spike con bytes reales del TD-3 | ✅ Hecho con 3 `.seq` reales de SynthTribe ([`docs/FORMAT.md`](docs/FORMAT.md)) |
| M1 | Dominio, validación, JSON Schema y CLI | ✅ |
| M2 | Codec `.seq` / SysEx | ✅ `.seq` verificado byte a byte; SysEx implementado sin verificar en hardware |
| M3 | Transporte MIDI USB | Bloqueado: falta un TD-3 conectado por USB |
| M4 | Skill de Claude Code (`.claude/skills/td3-patterns`) | Parcial: escribe JSON, valida y exporta `.seq`; sin envío directo al equipo |
| M5 | App Android (PWA en [`web/`](web/), [ADR-0006](docs/adr/0006-app-android-pwa.md)) | ✅ Genera, edita, preview de audio, exporta/importa `.seq`/`.json`, offline. Envío MIDI USB experimental (sin verificar) |

Hoy el flujo llega hasta archivos `.seq` que se cargan al TD-3 desde SynthTribe. El envío USB directo todavía no está disponible.

## Instalación

```bash
cd tools/td3
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
```

Requiere Python >= 3.12.

## Uso

```bash
.venv/bin/td3 validate examples/f-phrygian-rominimal.json
.venv/bin/td3 show examples/f-phrygian-rominimal.json --pattern A
.venv/bin/td3 schema
.venv/bin/td3 export examples/f-phrygian-rominimal.json --out out/
.venv/bin/td3 import out/f-phrygian-rominimal-A.seq
```

| Comando | Qué hace |
|---|---|
| `td3 validate <bank.json>` | Exit 0 e imprime `OK <name>: 4 patrones`; exit 1 con errores legibles, uno por línea y con ruta JSON. |
| `td3 show <bank.json> [--pattern A\|B\|C\|D]` | Grilla ASCII de los pasos 1–16. Sin `--pattern` muestra los 4. |
| `td3 schema` | Imprime el JSON Schema de Bank v1. |
| `td3 export <bank.json> --out <dir>` | Escribe `<name>-A.seq` … `<name>-D.seq` en `<dir>` para cargarlos en SynthTribe. |
| `td3 import <file.seq>` | Imprime el Pattern como JSON; el firmware va por stderr. Error → exit 1. |

## Campos de patrón

Cada patrón lleva 16 `steps` y dos campos opcionales: `length` (1–16, default 16; cuántos pasos suenan) y `triplet` (default `false`). `accent` y `slide` solo tienen efecto en pasos `gate: "on"`. Detalle del formato binario en [`docs/FORMAT.md`](docs/FORMAT.md).

## Contrato

El formato Bank v1 (campos, valores, defaults) está en [`docs/SPEC.md`](docs/SPEC.md). Es la referencia autoritativa. Ejemplo: [`examples/f-phrygian-rominimal.json`](examples/f-phrygian-rominimal.json).

Decisiones de diseño en [`docs/adr/`](docs/adr/):

- [0001](docs/adr/0001-cli-local-no-servicio.md) CLI local, no servicio
- [0002](docs/adr/0002-agente-genera-variaciones.md) el agente genera las variaciones
- [0003](docs/adr/0003-codec-puro-transporte-opcional.md) codec puro, transporte opcional
- [0004](docs/adr/0004-mapeo-gate-octave.md) mapeo gate / octave
- [0005](docs/adr/0005-formato-seq-cola-de-notas.md) formato `.seq` y cola de notas
- [0006](docs/adr/0006-app-android-pwa.md) app Android como PWA en TypeScript

## App Android (`web/`)

PWA instalable: genera bancos A–D en el teléfono (tónica, escala, densidad, estilo, semilla), edita la grilla de 16 pasos, la reproduce con un sintetizador Web Audio y exporta los 4 `.seq` (compartir a Drive o Telegram, o descargar) para cargarlos en SynthTribe. Funciona offline y guarda los bancos en el navegador.

```bash
cd web
npm ci
npm run dev        # desarrollo (http://localhost:5173)
npm run build      # genera dist/ con service worker
npm run preview    # sirve dist/ en http://localhost:4173
```

**Instalar en el teléfono.** El service worker y la instalación necesitan HTTPS o `localhost`. Hay dos caminos:

- **Termux, sin hosting:** `pkg install nodejs git`, clonar el repo, `cd tools/app-td-3/web && npm ci && npm run build && npm run preview`. Abrir `http://localhost:4173` en Chrome → menú ⋮ → *Instalar app*. Después de la primera carga funciona sin Termux ni red.
- **GitHub Pages:** el workflow manual `.github/workflows/td3-web-pages.yml` (Actions → *Run workflow*) publica `dist/`. Antes hay que activar Pages con origen "GitHub Actions" en la configuración del repo. Ojo: el sitio queda público.

**APK opcional (Capacitor).** Requiere JDK 17+ y Android SDK:
`npm i -D @capacitor/cli @capacitor/core @capacitor/android && npx cap init "TD-3" com.example.td3 --web-dir dist && npm run build && npx cap add android && npx cap open android`.

**MIDI USB (experimental).** Con Chrome Android y cable OTG, abrir con `?experimental=midi` o tocar *Activar envío MIDI USB* al pie. El SysEx no está verificado en hardware. Antes de quitar el flag:
1. Volcar un patrón real desde el TD-3 (SynthTribe o un monitor SysEx).
2. Comparar con el hex que muestra la app para el mismo patrón, grupo y slot.
3. Verificar que el slot de destino sea el elegido (FORMAT.md duda entre 0–7/8–15).

**Calidad** (desde `web/`): `npm run typecheck && npm run lint && npm test && npm run build`. Los tests comparan el codec TS byte a byte con los `.seq` reales y, si existe `.venv`, en vivo contra `td3 export` y `td3 validate`.

## Gate de calidad

Desde `tools/td3`, todo debe quedar en verde:

```bash
.venv/bin/ruff check
.venv/bin/ruff format --check
.venv/bin/mypy --strict src
.venv/bin/pytest
```

## Cómo se desbloquea M3

Hace falta un TD-3 conectado por USB para verificar el SysEx y escribir el transporte (extra `[midi]`, ADR-0003).
