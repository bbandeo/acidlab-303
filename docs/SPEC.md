# td3 — Especificación (contrato compartido)

Fuente: `raw/2026-11-21-perfil-ia-profesional.md` §2 ítem 2. No agregar requisitos fuera de este documento sin ADR.

## Alcance actual (aprobado 2026-11-21)

- **M1** dominio + validación + JSON Schema + CLI (`validate`, `show`, `schema`).
- **M4 parcial** skill de Claude Code que escribe `bank.json` y llama a la CLI.
- **Bloqueado** hasta tener bytes reales del TD-3 (M0): codec SysEx/`.seq` (M2) y transporte MIDI (M3). No escribir el codec de memoria.

### Actualización M0/M2 (2026-11-21)

M0 hecho con 3 `.seq` reales (ver `docs/FORMAT.md`, ADR-0005). En alcance ahora:
- **M2 codec** `.seq` (verificado byte a byte con los archivos reales) y SysEx (solo referencia, sin verificar en hardware).
- Pattern gana `length` (int 1–16, default 16) y `triplet` (bool, default false), porque el formato los tiene y `acidiction.seq` usa length 8. Siguen siendo 16 `steps`; los pasos > `length` se conservan pero el equipo no los toca.
- CLI: `td3 export <bank.json> --out <dir>` escribe `<name>-A.seq` … `<name>-D.seq` (firmware `1.3.7`); `td3 import <file.seq>` imprime el Pattern como JSON (stdout) e indica firmware por stderr; errores → exit 1 sin traceback. `encode_sysex(pattern, group, slot)` existe en el codec pero no se expone en la CLI hasta M3 (envío USB).
- **M3 transporte** sigue bloqueado (sin TD-3 conectado).

## Capas

1. Decisión: skill de Claude Code → solo produce JSON. Nunca bytes.
2. Determinista: paquete Python `td3` (`tools/td3/src/td3/`).

## Contrato JSON: Bank v1

```json
{
  "version": 1,
  "name": "f-phrygian-rominimal",
  "intent": "Fa menor frigio, densidad 65%, Rominimal",
  "patterns": {
    "A": { "steps": [ /* exactamente 16 Step */ ] },
    "B": { "steps": [ ... ] },
    "C": { "steps": [ ... ] },
    "D": { "steps": [ ... ] }
  }
}
```

- `version`: entero, solo `1`.
- `name`: string no vacío, `^[a-z0-9][a-z0-9-]*$`, máx. 64.
- `intent`: string opcional (la intención original, texto libre).
- `patterns`: exactamente las claves `A`, `B`, `C`, `D` (4 variaciones).
- Campos extra: prohibidos en todos los niveles (`extra="forbid"`).

### Step

| Campo | Tipo | Valores | Default |
|---|---|---|---|
| `note` | string | `C C# D D# E F F# G G# A A# B`; se aceptan bemoles (`Db Eb Gb Ab Bb`) y se normalizan a sostenidos | requerido |
| `octave` | int | `-1`, `0`, `1` (se mapea a transpose down / none / up del TD-3) | `0` |
| `accent` | bool | | `false` |
| `slide` | bool | | `false` |
| `gate` | string | `on` (suena la nota), `off` (silencio/rest), `tie` (prolonga la nota anterior) | `on` |

Nota: el JSON Schema exportado lista solo sostenidos en `note`; los bemoles se normalizan antes de validar, así que la CLI los acepta aunque un validador JSON Schema externo no. `version` y `octave` rechazan booleanos.
Decisión: el TD-3 no tiene "gate" nativo; `gate` del documento se mapea a nota/rest/tie (ADR-0004).
Solo validación estructural; no se inventan reglas musicales (p. ej. no se prohíbe `tie` en el paso 1).
Pregunta abierta para M0: la tecla C aguda del TD-3 (13ª tecla) no es representable todavía.

## CLI (`td3`, entry point en pyproject)

- `td3 validate <bank.json>` → exit 0 e imprime `OK <name>: 4 patrones`; exit 1 con errores legibles, uno por línea, con ruta JSON (ej. `patterns.B.steps.3.note: valor inválido 'H'`). Archivo inexistente o JSON mal formado → exit 1 con mensaje, sin traceback.
- `td3 show <bank.json> [--pattern A|B|C|D]` → grilla ASCII por patrón: fila de pasos 1–16, nota+octava, acento, slide, gate. Sin `--pattern` muestra los 4.
- `td3 schema` → imprime el JSON Schema de Bank v1 (generado desde el modelo). Copia versionada en `src/td3/bank.schema.json`; un test verifica que estén sincronizados.

## Stack y calidad

Python ≥3.12, `pyproject.toml` (hatchling), `pydantic>=2`; extra `[midi]` reservado (`mido`, `python-rtmidi`) sin código aún; dev: `pytest`, `ruff`, `mypy --strict`. Venv en `tools/td3/.venv` (ignorado por git).
Gate de calidad: `ruff check`, `ruff format --check`, `mypy --strict src`, `pytest` → todo verde.
