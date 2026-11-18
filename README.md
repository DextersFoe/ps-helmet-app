# PS Helmet App

Clinician tool for assessing deformational plagiocephaly and brachycephaly from 3D head scans, producing a report and, later, ordering a helmet.

The pilot takes scans from Qwadra 3DsizeME (exported from MSoft as STL) and measures them in a web tool. The full requirements are in the pilot specification document shared in the project.

## Status

Step 2 of the pilot plan: the **measurement engine** (`src/measure`). There is no user interface yet.

| Measurement | How it is taken |
| --- | --- |
| Reference frame | Plane through sellion and both tragions; forward = ear midpoint towards sellion |
| Measurement plane | Parallel to the reference plane, at the level of largest circumference, searched only above the top of the ears |
| Length, width, CR | Extents of the outline front to back and side to side; CR = width / length x 100 |
| CVA, CVAI | Diagonals at 30 degrees either side of the front-to-back axis; CVAI = (longer - shorter) / longer x 100 |
| Head circumference | Perimeter of the outline |
| Ear shift | Front-to-back distance between the two tragions |
| Severity | Printed Symmetry clinician reference, plus CR 75 to 82% normal and under 75% scaphocephaly |

All measurements use the convex hull of the outline, which behaves like calipers and a tape measure: it bridges small gaps in the scan instead of following them.

## Running

```sh
npm install
npm test            # unit tests on shapes of known size
npm run typecheck
npm run measure -- path/to/scan.stl path/to/landmarks.json
```

`landmarks.json` holds the three landmarks in the scan's own coordinates, in millimetres:

```json
{ "sellion": [64.5, -3.0, 89.0], "tragionLeft": [-9.5, 49.6, 62.6], "tragionRight": [13.0, -51.2, 57.6] }
```

## Patient data

Never commit scans to this repository, even de-identified ones. `.gitignore` blocks common scan formats.
