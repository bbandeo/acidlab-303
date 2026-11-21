"""CLI `td3`: validate, show, schema, export, import."""

import argparse
import json
import sys
from pathlib import Path

from td3.codec import CodecError, decode_seq, encode_seq, seq_firmware
from td3.domain import Bank, BankError, Pattern, load_bank

_SCHEMA_FILE = Path(__file__).with_name("bank.schema.json")


def schema_text() -> str:
    return json.dumps(Bank.model_json_schema(), indent=2, ensure_ascii=False) + "\n"


def render_pattern(key: str, pattern: Pattern) -> str:
    cells: dict[str, list[str]] = {
        "step": [f"{i}" for i in range(1, 17)],
        "note": [s.note + (f"{s.octave:+d}" if s.octave else "") for s in pattern.steps],
        "acc": ["A" if s.accent else "." for s in pattern.steps],
        "slide": ["S" if s.slide else "." for s in pattern.steps],
        "gate": [s.gate for s in pattern.steps],
    }
    lines = [f"Pattern {key}"]
    lines += [f"{label:<6}" + " ".join(f"{v:>3}" for v in row) for label, row in cells.items()]
    return "\n".join(lines)


def _cmd_validate(args: argparse.Namespace) -> int:
    bank = load_bank(args.bank)
    print(f"OK {bank.name}: 4 patrones")
    return 0


def _cmd_show(args: argparse.Namespace) -> int:
    bank = load_bank(args.bank)
    keys = [args.pattern] if args.pattern else ["A", "B", "C", "D"]
    print("\n\n".join(render_pattern(k, getattr(bank.patterns, k)) for k in keys))
    return 0


def _cmd_schema(_: argparse.Namespace) -> int:
    sys.stdout.write(schema_text())
    return 0


def _cmd_export(args: argparse.Namespace) -> int:
    bank = load_bank(args.bank)
    out = Path(args.out)
    try:
        out.mkdir(parents=True, exist_ok=True)
        for key in "ABCD":
            path = out / f"{bank.name}-{key}.seq"
            path.write_bytes(encode_seq(getattr(bank.patterns, key)))
            print(path)
    except OSError as exc:
        raise BankError([f"{out}: no se puede escribir ({exc.strerror})"]) from exc
    return 0


def _cmd_import(args: argparse.Namespace) -> int:
    try:
        data = Path(args.seq).read_bytes()
    except OSError as exc:
        raise BankError([f"{args.seq}: no se puede leer ({exc.strerror})"]) from exc
    try:
        pattern = decode_seq(data)
        firmware = seq_firmware(data)
    except CodecError as exc:
        raise BankError([f"{args.seq}: {exc}"]) from exc
    print(f"firmware {firmware}", file=sys.stderr)
    print(pattern.model_dump_json(indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="td3", description="Bancos de patrones TD-3")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("validate", help="valida un bank.json")
    p.add_argument("bank")
    p.set_defaults(func=_cmd_validate)

    p = sub.add_parser("show", help="muestra los patrones como grilla ASCII")
    p.add_argument("bank")
    p.add_argument("--pattern", choices=["A", "B", "C", "D"])
    p.set_defaults(func=_cmd_show)

    p = sub.add_parser("schema", help="imprime el JSON Schema de Bank v1")
    p.set_defaults(func=_cmd_schema)

    p = sub.add_parser("export", help="escribe <name>-A..D.seq desde un bank.json")
    p.add_argument("bank")
    p.add_argument("--out", required=True, help="directorio de salida (se crea)")
    p.set_defaults(func=_cmd_export)

    p = sub.add_parser("import", help="imprime un .seq como Pattern JSON")
    p.add_argument("seq")
    p.set_defaults(func=_cmd_import)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        code: int = args.func(args)
    except BankError as exc:
        print("\n".join(exc.errors), file=sys.stderr)
        return 1
    return code


if __name__ == "__main__":
    sys.exit(main())
