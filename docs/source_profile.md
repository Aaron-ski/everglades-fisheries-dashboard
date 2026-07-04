# Source Profile

Generated from the official NPS IRMA package: https://irma.nps.gov/DataStore/Reference/Profile/2318429

Data.gov catalog: https://catalog.data.gov/dataset/recreational-fishing-catch-and-effort-in-everglades-national-park-1980-2025-data-package

## Coverage

- Catch records date range: 1980-01-05 to 2025-04-27
- Unique years: 1980-2025
- 2025 is partial in the source and is excluded from the default 2005-2024 dashboard view.

## Files

### EVER_creel_rec_catch.csv

- Size: 127,011,583 bytes
- Format: csv
- Rows: 828222
- Columns: 20
- Column names: interviewLocation, eventDate, interviewNumber, numPeople, hoursFished, areaFished, scientificName_catch, commonName_catch, disposition, individualCount, interviewTime, hoursTrip, fishingPartyComposition, scientificName_pref, commonName_pref, originTrip, anglerResidence, interviewer, dayOfWeek, flags

### EVER_creel_fishing_areas.csv

- Size: 14,559 bytes
- Format: csv
- Rows: 11
- Columns: 8
- Column names: zone, num, zoneName, unitCode, unitName, groupCode, groupName, wkt

### EVER_creel_rec_catch_flags.csv

- Size: 46,645,498 bytes
- Format: csv
- Rows: 619290
- Columns: 5
- Column names: interviewLocation, eventDate, interviewNumber, scientificName_catch, flagDescription

### EVER_creel_rec_metadata.xml

- Size: 1,681,904 bytes
- Format: xml
- Rows: None
- Columns: None
- Column names: 

### EVER_creel_rec_trailer_count.csv

- Size: 1,495,550 bytes
- Format: csv
- Rows: 35765
- Columns: 5
- Column names: parking_lot, eventDate, staff, trailer_count, notes

## Important Fields Found

- Dates: `eventDate`
- Species: `scientificName_catch`, `commonName_catch`
- Areas: `areaFished`, joined to `EVER_creel_fishing_areas.csv.zone` where polygons exist
- Catch count: `individualCount`
- Kept/released: `disposition` values `harvested` and `released`
- Effort inputs: `numPeople` and `hoursFished`; dashboard denominator is computed as angler-hours
- Survey/interview key: `interviewLocation`, `eventDate`, `interviewNumber`
- Quality-control fields: `flags` plus detailed descriptions in `EVER_creel_rec_catch_flags.csv`

## Geography

- Geometry format: WKT polygons
- Source coordinate system: NAD 1983 UTM Zone 17N (EPSG:26917), from NPS metadata wkt attribute definition
- Coordinates are converted to WGS84 GeoJSON for Leaflet.

## Area Values

- `1`: 85,068 records; region `Florida Bay / Cape Sable`
- `1E`: 296 records; region `Florida Bay / Cape Sable`
- `1W`: 61,508 records; region `Florida Bay / Cape Sable`
- `2`: 12,374 records; region `Florida Bay / Cape Sable`
- `2E`: 349 records; region `Florida Bay / Cape Sable`
- `2W`: 9,993 records; region `Florida Bay / Cape Sable`
- `3`: 99,975 records; region `Florida Bay / Cape Sable`
- `3E`: 19,489 records; region `Florida Bay / Cape Sable`
- `3W`: 46,748 records; region `Florida Bay / Cape Sable`
- `4`: 83,368 records; region `Whitewater Bay`
- `5`: 116,311 records; region `Gulf Coast`
- `6`: 134,619 records; region `Gulf Coast`
- `6C`: 70,385 records; region `Gulf Coast`
- `6N`: 59,390 records; region `Gulf Coast`
- `6S`: 25,950 records; region `Gulf Coast`
- `Unknown`: 2,399 records; region `Unknown`

## Species Values

- Spotted Seatrout: 140,614 records
- Crevalle Jack: 92,314 records
- Gray Snapper: 88,594 records
- Red Drum: 86,445 records
- Ladyfish: 71,054 records
- Common Snook: 68,189 records
- Hardhead Catfish: 54,518 records
- Gafftopsail Catfish: 30,274 records
- Sheepshead: 29,068 records
- sea catfishes: 18,157 records
- Black Drum: 15,175 records
- Spanish Mackerel: 8,873 records
- Puffers: 8,471 records
- Tarpon: 8,437 records
- Goliath Grouper: 8,153 records
- No fish caught: 7,540 records
- Blacktip Shark: 7,220 records
- Bonnethead: 6,516 records
- Did not fish: 6,335 records
- Gag: 5,856 records
- requiem sharks: 4,318 records
- Pinfish: 3,882 records
- lizardfishes: 3,807 records
- Lefteye flounders: 3,766 records
- Atlantic Tripletail: 3,644 records
- Blue Crab: 3,544 records
- grunts: 2,961 records
- whiptail stingrays: 2,727 records
- Bluefish: 2,676 records
- Florida Pompano: 2,561 records
- Florida Bass: 2,312 records
- Blue Runner: 2,253 records
- Great Barracuda: 2,206 records
- Nurse Shark: 1,795 records
- Cobia: 1,643 records
- Sea Basses: 1,554 records
- Sand Seatrout: 1,477 records
- Lane Snapper: 1,380 records
- Bull Shark: 1,162 records
- snappers: 1,130 records
- Lemon Shark: 1,073 records
- Permit: 1,009 records
- mullets: 977 records
- Sand Perch: 958 records
- Black Grouper: 864 records
- Mayan Cichlid: 721 records
- Gulf Kingfish: 716 records
- needlefishes: 491 records
- Red Grouper: 475 records
- Great Hammerhead: 470 records
- Toadfishes: 457 records
- remoras: 362 records
- Bluestriped Grunt: 336 records
- Leatherjacket: 300 records
- Mutton Snapper: 278 records
- Schoolmaster: 237 records
- Lookdown: 228 records
- Yellowtail Snapper: 225 records
- Southern Flounder: 210 records
- Oscar: 209 records

## Known Inconsistencies And Limitations

- Numeric area codes 1, 2, 3, and 6 appear in older records; the polygon file contains the later split areas such as 1E, 1W, 6N, 6C, and 6S.
- The metadata says areaFished may represent the area where anglers spent the most time, caught the most fish, or the furthest area traveled for some Everglades City surveys.
- No authoritative survey-site coordinates were found in the source files, so the dashboard omits exact point markers.
- CPUE is a reported catch-rate indicator from surveyed/interviewed trips, not a fish population estimate.
