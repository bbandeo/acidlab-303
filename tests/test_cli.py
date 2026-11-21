import json
from pathlib import Path

import pytest

from td3.cli import _SCHEMA_FILE, main

EXAMPLE = str(Path(__file__).parent.parent / "examples" / "f-phrygian-rominimal.json")


def test_validate_ok(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["validate", EXAMPLE]) == 0
    assert capsys.readouterr().out.strip() == "OK f-phrygian-rominimal: 4 patrones"


def test_validate_fail(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    data = json.loads(Path(EXAMPLE).read_text())
    data["patterns"]["B"]["steps"][3]["note"] = "H"
    f = tmp_path / "bad.json"
    f.write_text(json.dumps(data))
    assert main(["validate", str(f)]) == 1
    assert "patterns.B.steps.3.note: valor inválido 'H'" in capsys.readouterr().err


def test_validate_missing_file(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["validate", "/nonexistent/x.json"]) == 1
    err = capsys.readouterr().err
    assert "no se puede leer" in err
    assert "Traceback" not in err


def test_validate_non_utf8(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    f = tmp_path / "bin.json"
    f.write_bytes(b"\xff\xfe\x00\x81garbage")
    assert main(["validate", str(f)]) == 1
    err = capsys.readouterr().err
    assert "UTF-8" in err
    assert "Traceback" not in err


def test_validate_bad_json(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    f = tmp_path / "bad.json"
    f.write_text("{oops")
    assert main(["validate", str(f)]) == 1
    err = capsys.readouterr().err
    assert "JSON mal formado" in err
    assert "Traceback" not in err


def test_show_one_pattern(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["show", EXAMPLE, "--pattern", "A"]) == 0
    out = capsys.readouterr().out
    assert "Pattern A" in out
    assert "Pattern B" not in out
    for label in ("step", "note", "acc", "slide", "gate"):
        assert label in out
    assert "F+1" in out
    assert "tie" in out


def test_show_all(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["show", EXAMPLE]) == 0
    out = capsys.readouterr().out
    assert all(f"Pattern {k}" in out for k in "ABCD")


def test_schema_matches_committed_file(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["schema"]) == 0
    assert capsys.readouterr().out == _SCHEMA_FILE.read_text(encoding="utf-8")
