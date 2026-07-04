import json
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]


def test_geojson_valid_and_in_south_florida_bounds():
    geojson = json.loads((ROOT / "public/data/areas.geojson").read_text(encoding="utf-8"))
    assert geojson["features"]
    for feature in geojson["features"]:
        geom = shape(feature["geometry"])
        assert geom.is_valid
        minx, miny, maxx, maxy = geom.bounds
        assert -83 <= minx <= -79
        assert -83 <= maxx <= -79
        assert 24 <= miny <= 27
        assert 24 <= maxy <= 27
