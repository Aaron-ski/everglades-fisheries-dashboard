from __future__ import annotations

import argparse

from pipeline_utils import PROCESSED_DIR, SOURCE_URLS, download_source, ensure_dirs, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Download official NPS Everglades creel survey files.")
    parser.add_argument("--force", action="store_true", help="Re-download files even when cached raw files exist.")
    args = parser.parse_args()

    ensure_dirs()
    files = [download_source(key, url, force=args.force) for key, url in SOURCE_URLS.items()]
    write_json(PROCESSED_DIR / "source_manifest.json", {"files": files})
    for item in files:
        print(f"{item['key']}: {item['filename']} ({item['size']:,} bytes, {item['status']})")


if __name__ == "__main__":
    main()
