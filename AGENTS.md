# Repository Guidance

- Use `npm.cmd` on Windows PowerShell when `npm.ps1` is blocked by execution policy.
- Keep `data/raw/` ignored; regenerate processed assets with the Python scripts.
- Do not invent fisheries fields, coordinates, or boundaries. Use only fields documented in `docs/source_profile.md`.
- Before declaring changes complete, run `py -m pytest`, `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build`.
