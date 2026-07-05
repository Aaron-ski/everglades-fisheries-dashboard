# Everglades Fisheries Explorer Plan

1. Inspect and download official NPS IRMA source files, recording checksums, retrieval dates, file sizes, and schemas.
2. Build source profiling outputs in `docs/source_profile.md` and `data/processed/source_profile.json`.
3. Implement a deterministic Python data pipeline that standardizes dates, species, areas, regions, supported measures, CPUE inputs, partial-year flags, and official area geography.
4. Validate transformed data with Python tests and a data-quality report.
5. Build the Vite vanilla TypeScript dashboard shell with accessible controls, URL state, reset behavior, empty states, and responsive styling.
6. Add Plotly trend, effort, and kept-versus-released charts from compact static JSON assets.
7. Add Leaflet fishing-area map from official geography with synchronized area selection, metric legend, missing-versus-zero treatment, and accessible data table.
8. Add deterministic plain-language takeaways and tests for trend, coverage, sparse-data, and zero-baseline behavior.
9. Write beginner-friendly README, methodology/source sections, license, `.gitignore`, and GitHub Pages workflow.
10. Run Python validation, frontend tests, linting, production build, and browser smoke checks; fix issues until the completed MVP satisfies the brief.

## Coastal Ecosystem Signals Extension

1. Add centralized indicator-species definitions and ecosystem signal types.
2. Implement reusable calculations for active geographic scope, species-specific annual CPUE, latest complete five-year windows, rolling five-year percentiles, normalized trends, data-confidence labels, heatmap bins, and area anomaly values.
3. Cover the calculation utilities with focused Vitest unit tests, including shared-effort handling, partial-year exclusion, zero baselines, insufficient windows, composites, and active filters.
4. Add a species-by-year heatmap and second Leaflet anomaly map as additions to the existing dashboard.
5. Wire all three visuals into the existing `update()` lifecycle, global timeline, area filters, reset behavior, and independent anomaly indicator selector.
6. Preserve the original fishing-area map and initialize the anomaly map as a separate Leaflet instance.
7. Update methodology copy, README documentation, responsive styling, and accessibility labels.
8. Run Python tests, frontend tests, lint, production build, browser smoke checks, and GitHub Pages deployment verification.
