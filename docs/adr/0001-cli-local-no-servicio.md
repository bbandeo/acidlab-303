# ADR-0001: CLI y librería local, no servicio

**Estado:** Aceptada (2026-11-21)

## Contexto

El requisito (`raw/2026-11-21-perfil-ia-profesional.md` §2 ítem 2) es un generador de patrones ácidos para TD-3 usado por una sola persona, desde Claude Code, en una máquina local (incluido Termux). No hay usuarios concurrentes, ni necesidad de acceso remoto, ni persistencia compartida.

## Decisión

`td3` es un paquete Python con núcleo de librería y una CLI fina (`td3 validate|show|schema`). Corre local, sin proceso residente ni red.

## Alternativas descartadas

- **FastAPI:** agrega servidor, puertos y despliegue sin que nadie consuma una API.
- **n8n:** orquestador visual para un flujo de un solo paso; sobra.
- **Supabase:** no hay datos compartidos que persistir; los bancos son archivos JSON versionables en git.

## Consecuencias

- Instalación simple (`pip install -e .`) y tests sin infraestructura.
- Como el núcleo es librería, una API HTTP o un workflow n8n se pueden agregar después como capa fina sin reescribir el dominio.
- Sin UI ni multiusuario; si se piden, se abre un ADR nuevo.
