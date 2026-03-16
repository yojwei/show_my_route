Problem
- Runtime error: `Uncaught TypeError: map.queryTerrainElevation is not a function` in `animate` indicates the current map instance does not expose this terrain API at runtime.

Approach
- Confirm the exact callsite and assumptions in animation logic.
- Confirm which map library/version is loaded and whether `queryTerrainElevation` is supported.
- Implement a compatibility-safe fallback path so animation remains functional when terrain elevation querying is unavailable.
- Validate with available project checks and targeted inspection.

Todos
- inspect-animation-callsite
- inspect-map-library-api
- implement-elevation-fallback (depends on both inspect todos)
- validate-elevation-fix (depends on implement-elevation-fallback)

Notes
- Prefer capability detection (`typeof map.queryTerrainElevation === 'function'`) over library/version string checks.
- Keep behavior unchanged when terrain elevation API is available.
