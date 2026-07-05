# Everglades Fisheries Explorer

Everglades Fisheries Explorer is a public, static dashboard for exploring National Park Service recreational fisheries data from Everglades National Park. It is built for a non-technical viewer: open one link, choose a species or area, read the charts and map, and reset back to the default view.

Expected public URL after GitHub Pages is enabled:

`https://aaron-ski.github.io/everglades-fisheries-dashboard/`

## Data Sources

Core source: National Park Service IRMA record  
https://irma.nps.gov/DataStore/Reference/Profile/2318429

Data.gov catalog record  
https://catalog.data.gov/dataset/recreational-fishing-catch-and-effort-in-everglades-national-park-1980-2025-data-package

Downloaded files:

- `EVER_creel_rec_catch.csv`
- `EVER_creel_fishing_areas.csv`
- `EVER_creel_rec_catch_flags.csv`
- `EVER_creel_rec_metadata.xml`
- `EVER_creel_rec_trailer_count.csv`

Raw files are cached in `data/raw/` and ignored by Git. Compact processed browser assets are committed in `public/data/`.

## Coverage Found

The downloaded catch records cover `1980-01-05` through `2025-04-27`. The source includes 1980 through 2025. The dashboard default is 2005-2024, which is twenty calendar years and excludes partial 2025. Year 2020 is flagged as interrupted survey coverage because records are present for 10 months.

## Metrics

Main CPUE/catch-rate definition:

`CPUE = sum(reported catch for selected species) / sum(deduplicated interview angler-hours)`

The denominator is computed from official effort inputs:

`angler-hours = numPeople * hoursFished`

Interviews are deduplicated by `interviewLocation`, `eventDate`, and `interviewNumber` before effort is aggregated. CPUE is shown as fish per angler-hour. It is a surveyed catch-rate indicator, not a direct estimate of fish population.

Other measures include total reported catch, fish kept, fish released, release rate, fishing effort, surveyed trips, and trailer counts. Trailer counts are kept separate from CPUE.

## Coastal Ecosystem Signals

The dashboard includes a `Coastal Ecosystem Signals` section with three additional interactive visuals:

- `Current Condition Scorecard`: compares the latest five complete years of surveyed catch rate for Common Snook, Red Drum, Spotted Seatrout, and Gray Snapper with rolling five-year windows from the selected timeline.
- `Species-by-Year Condition Heatmap`: ranks each species' annual CPUE against that same species' selected-timeline distribution. The cells compare a species with its own history, not CPUE magnitudes across species.
- `Where Conditions Are Changing`: a second Leaflet map that compares recent five-year CPUE with the selected historical baseline for either one indicator species or an equal-weight indicator-species composite.

For the default `2005-2024` timeline, the current/recent period is `2020-2024` and the anomaly-map baseline is `2005-2019`. If partial 2025 is selected, the latest complete year remains 2024 for recent five-year ecosystem calculations.

The indicator composite averages valid species-level anomaly percentages with equal weight per species and requires at least two contributing species. It does not combine raw catch counts across species. These visuals are fishery-condition signals based on surveyed catch rates; they are not a comprehensive ecosystem-health score and do not prove fish populations or environmental causes changed.

## Important Limitations

- The source does not include a precomputed CPUE field.
- Numeric historic area codes 1, 2, 3, and 6 do not have separate polygons in the geography file.
- The map uses official NPS fishing-area polygons; polygons show reported fishing areas, not exact catch locations.
- Survey/interview locations are names only in the source package, without authoritative coordinates, so point markers are omitted.
- QA/QC flag counts are surfaced, but the metadata says full QA/QC methodology is forthcoming.
- This independent visualization does not imply National Park Service endorsement.

## Windows PowerShell Setup

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
npm.cmd install
```

If PowerShell blocks `npm`, use `npm.cmd` as shown above.

## Rebuild Data

```powershell
py scripts\download_data.py
py scripts\profile_source.py
py scripts\build_data.py
py scripts\validate_data.py
```

Generated documentation:

- `docs/source_profile.md`
- `docs/data_quality_report.md`
- `data/processed/source_profile.json`
- `data/processed/source_manifest.json`

## Run Locally

```powershell
npm.cmd run dev
```

Open the local URL printed by Vite.

## Test And Build

```powershell
py -m pytest
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The Vite config sets `base: "/everglades-fisheries-dashboard/"` so assets work on GitHub Pages under the project URL.

## Deploy To GitHub Pages

The workflow in `.github/workflows/pages.yml` installs dependencies, runs linting and tests, builds the Vite app, uploads `dist`, and deploys to GitHub Pages.

One-time repository setting:

1. Push this repository to `Aaron-ski/everglades-fisheries-dashboard`.
2. In GitHub, open Settings → Pages.
3. Set Build and deployment source to GitHub Actions.
4. Push to `main`.

After the workflow succeeds, share:

`https://aaron-ski.github.io/everglades-fisheries-dashboard/`

## Update Data Later

Run the rebuild commands, review `docs/source_profile.md` and `docs/data_quality_report.md`, then run all tests and build checks. Commit only the compact processed files and documentation unless there is a specific reason to preserve raw files.

## Troubleshooting

- Blank page on GitHub Pages: confirm the repository name matches `everglades-fisheries-dashboard` and `vite.config.ts` has the matching `base`.
- Missing charts: run `npm.cmd run build` and check the browser console for failed `public/data` requests.
- Failed data download: open the NPS IRMA record and confirm the current official file links.
- CPUE missing for a selection: the effort denominator is zero or missing for those records.
- 2025 comparisons: 2025 is partial through April and should not be compared directly with full years.
