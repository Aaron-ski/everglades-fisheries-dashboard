import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_source_manifest_has_checksums_and_sizes():
    manifest = json.loads((ROOT / "data/processed/source_manifest.json").read_text(encoding="utf-8"))
    assert len(manifest["files"]) == 5
    for item in manifest["files"]:
        assert item["size"] > 0
        assert len(item["sha256"]) == 64
