import json
from pathlib import Path

import pytest

from td3.cli import main
from td3.codec import CodecError, decode_seq, encode_seq, encode_sysex, seq_firmware
from td3.domain import Pattern, Step, load_bank

ROOT = Path(__file__).parent.parent
SEQ = ROOT / "seq"
REAL = ["koxo-A.seq", "acidiction.seq", "bass_line_16.seq"]
EXAMPLE = ROOT / "examples" / "f-phrygian-rominimal.json"


def _real(name: str) -> bytes:
    return (SEQ / name).read_bytes()


def _pattern(**kw: object) -> Pattern:
    steps = [Step(note="C") for _ in range(16)]
    return Pattern(steps=steps, **kw)  # type: ignore[arg-type]


@pytest.mark.parametrize("name", REAL)
def test_golden_roundtrip(name: str) -> None:
    data = _real(name)
    assert encode_seq(decode_seq(data), firmware=seq_firmware(data)) == data


def test_firmware() -> None:
    assert seq_firmware(_real("acidiction.seq")) in {"1.3.7", "1.2.6"}


def test_acidiction_content() -> None:
    p = decode_seq(_real("acidiction.seq"))
    assert p.length == 8
    gates = [s.gate for s in p.steps[:8]]
    assert gates == ["on"] * 4 + ["tie"] + ["on"] * 3
    assert (p.steps[0].note, p.steps[0].octave) == ("F#", 1)


def test_bass_line_content() -> None:
    p = decode_seq(_real("bass_line_16.seq"))
    on = [s for s in p.steps if s.gate == "on"]
    assert [s.accent for s in on[:3]] == [True] * 3
    assert [i for i, s in enumerate(on) if s.slide] == [0, 4, 7]


def test_koxo_content() -> None:
    p = decode_seq(_real("koxo-A.seq"))
    assert sum(s.gate == "on" for s in p.steps) == 16
    assert (p.steps[0].note, p.steps[0].octave) == ("C#", 0)


def test_model_roundtrip() -> None:
    steps = [
        Step(note="D", octave=-1, accent=True, slide=True),
        Step(note="A#", octave=1, accent=True),
        Step(note="A#", octave=1, gate="tie"),
        Step(note="C", gate="off"),
        Step(note="B", slide=True),
    ] + [Step(note="C") for _ in range(11)]
    p = Pattern(steps=steps, length=12, triplet=True)
    assert decode_seq(encode_seq(p)) == p


def test_ignored_flags_are_normalized() -> None:
    steps = [Step(note="E", accent=True, slide=True, gate="tie"), Step(note="G", accent=True)]
    steps += [Step(note="C", accent=True, gate="off") for _ in range(14)]
    out = decode_seq(encode_seq(Pattern(steps=steps)))
    assert out.steps[0] == Step(note="C", gate="tie")
    assert out.steps[1] == Step(note="G", accent=True)
    assert out.steps[2] == Step(note="C", gate="off")


def test_rest_sets_tie_and_rest_without_consuming_note() -> None:
    steps = [Step(note="C", gate="off"), Step(note="D#", octave=1)]
    steps += [Step(note="C", gate="tie") for _ in range(14)]
    body = encode_seq(Pattern(steps=steps))[36:]
    assert body[0:2] == bytes((2, 7))  # primer pitch = D#+1 = 39: la pausa no consume nota
    assert body[102:106] == bytes((0, 3, 0, 0))  # tie: pasos 1 y 2
    assert body[106:110] == bytes((0, 1, 0, 0))  # rest: paso 1


def test_sysex() -> None:
    p = decode_seq(_real("bass_line_16.seq"))
    sx = encode_sysex(p, group=2, slot=5)
    assert len(sx) == 123
    assert sx[:8] == bytes.fromhex("f000203200010a78")
    assert sx[8:12] == bytes((2, 5, 0, 0))
    assert sx[-1] == 0xF7
    assert sx[12:-1] == encode_seq(p)[36:]


@pytest.mark.parametrize(("group", "slot"), [(4, 0), (-1, 0), (0, 16), (0, -1)])
def test_sysex_bad_args(group: int, slot: int) -> None:
    with pytest.raises(CodecError, match="fuera de"):
        encode_sysex(_pattern(), group, slot)


def _mutated(index: int, value: int) -> bytes:
    data = bytearray(_real("koxo-A.seq"))
    data[index] = value
    return bytes(data)


@pytest.mark.parametrize(
    ("data", "msg"),
    [
        (b"", "largo"),
        (_real("koxo-A.seq")[:-1], "largo"),
        (_mutated(0, 0), "magic"),
        (_mutated(7, 9), "cabecera"),
        (_mutated(36 + 3, 0x1F), "nibbles"),
        (_mutated(36, 0), "pitch"),  # pitch 0x05 = 5 < 12
        (_mutated(36 + 98, 0), "length"),  # length 0
    ],
)
def test_decode_errors(data: bytes, msg: str) -> None:
    with pytest.raises(CodecError, match=msg):
        decode_seq(data)


def test_bad_firmware() -> None:
    with pytest.raises(CodecError, match="firmware"):
        encode_seq(_pattern(), firmware="1.3")


def test_pattern_length_validation() -> None:
    for bad in (0, 17, True):
        with pytest.raises(ValueError):
            _pattern(length=bad)


def test_cli_export_and_import(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "nested" / "out"
    assert main(["export", str(EXAMPLE), "--out", str(out)]) == 0
    bank = load_bank(EXAMPLE)
    files = sorted(out.glob("*.seq"))
    assert [f.name for f in files] == [f"{bank.name}-{k}.seq" for k in "ABCD"]
    assert capsys.readouterr().out.splitlines() == [str(f) for f in files]
    for key, f in zip("ABCD", files, strict=True):
        expected = getattr(bank.patterns, key)
        assert decode_seq(f.read_bytes()) == decode_seq(encode_seq(expected))

    assert main(["import", str(files[0])]) == 0
    cap = capsys.readouterr()
    assert "firmware 1.3.7" in cap.err
    assert Pattern.model_validate(json.loads(cap.out)) == decode_seq(files[0].read_bytes())


def test_cli_import_garbage(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    f = tmp_path / "bad.seq"
    f.write_bytes(b"garbage")
    assert main(["import", str(f)]) == 1
    err = capsys.readouterr().err
    assert "largo" in err
    assert "Traceback" not in err
    assert main(["import", str(tmp_path / "nope.seq")]) == 1
