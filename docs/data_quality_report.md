# Data Quality Report

## Validation Summary

- Official source files were downloaded from NPS IRMA and checksums were recorded in `data/processed/source_manifest.json`.
- Source years found: 1980-2025.
- Default dashboard period 2005-2024 contains exactly twenty complete calendar years.
- 2025 is present and marked as a partial year because the source ends in April 2025.
- Catch, kept, released, effort, CPUE, and release-rate values passed nonnegative and recomputation checks.
- Annual species-area and species-region aggregate keys are unique.
- Fishing-area geometries are valid after conversion to WGS84 and fall within expected southern Florida bounds.

## Important Caveats

- CPUE uses deduplicated interview angler-hours (`numPeople * hoursFished`) because the source does not include a precomputed CPUE field.
- The denominator is shared across species within a year and area, so a selected species catch rate means reported catch for that species per surveyed angler-hour in that place and year.
- Numeric historic area codes have no separate polygons in the geography file; the interactive map uses the official split-area polygons supplied by NPS.
- Survey/interview locations are available as names only, without authoritative coordinates in the source package, so no point markers are plotted.
- QA/QC flags are counted and surfaced, but the metadata states full QA/QC methodology is forthcoming.
