# ADR-0006: App Android como PWA en TypeScript

**Estado:** Aceptada (2026-11-21)

## Contexto

Se pidió usar td3 en Android como app. ADR-0001 dejó la UI fuera de alcance ("si se piden, se abre un ADR nuevo"). Requisitos acordados:

1. Los patrones se generan **dentro de la app**, offline y sin API key. En el teléfono no hay Claude Code para correr la skill `td3-patterns` (ADR-0002).
2. Grilla A–D editable, preview de audio, exportar/importar `.seq` y `.json`.
3. Envío MIDI USB al TD-3 como fase experimental, porque el SysEx no está verificado en hardware (ADR-0003).

## Decisión

PWA en `web/` (Vite + TypeScript strict + Preact + vite-plugin-pwa), instalable desde Chrome Android y offline por service worker.

- `web/src/domain.ts` y `web/src/codec.ts` son puertos 1:1 de `src/td3/domain.py` y `src/td3/codec.py`.
- **Paridad sin copias:** los tests TS leen `src/td3/bank.schema.json`, `seq/*.seq`, `banks/**` y `examples/*` del paquete Python por ruta relativa. Si el venv existe, comparan además en vivo contra `td3 export` y `td3 validate`. Un cambio en un lado que rompa la paridad hace fallar `npm test`.
- `web/src/generator.ts`: generador determinista (PRNG mulberry32 + semilla) con las reglas de la skill: densidad = pasos activos/16, tónica/quinta en pasos fuertes, nota de color del modo con acento, y B/C/D como variaciones de A.
- Web MIDI (`requestMIDIAccess({sysex: true})`) detrás de `?experimental=midi` o un toggle, con confirmación y advertencia.

La skill y la CLI Python no cambian: siguen siendo el flujo de escritorio, y el formato Bank v1 es el mismo.

## Alternativas descartadas

- **Flet (Python → APK):** reusa el código, pero el APK pesa 30–50 MB, la UI es menos fluida y el MIDI USB es difícil.
- **Kotlin/Compose:** la mejor integración MIDI nativa, pero es una reescritura total con Android SDK y el ciclo más lento.
- **Kivy/BeeWare:** compilar `pydantic-core` (Rust) para Android es un riesgo alto de build.
- **ajv sobre `bank.schema.json`:** el schema no expresa todo (bemoles normalizados, booleanos rechazados en enteros, y `length` sale con `ge`/`le`, que no son keywords JSON Schema). Se valida a mano y un test compara las constantes TS con el schema.

## Consecuencias

- Hay dos implementaciones del codec y del dominio. Las protegen los tests de paridad. Una regla nueva en Bank v1 se implementa en ambos lados.
- Los mensajes de error TS están en español con la misma ruta JSON (`patterns.B.steps.3.note: ...`). El texto de los errores genéricos difiere de pydantic; el del caso `valor inválido 'H'` coincide.
- Instalar la PWA requiere HTTPS o `localhost` (ver README, "App Android").
- El APK nativo (Capacitor) es opcional y requiere el Android SDK.
- M3 (transporte) se puede verificar desde el teléfono con un cable OTG, sin escribir `[midi]` en Python.
