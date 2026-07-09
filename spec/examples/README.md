# Spec Fixtures

The files in this directory are spec fixtures, not measured claims.

Use these files to understand shape, not incidence. They are intentionally isolated from live dashboard, benchmark report, loss report, and receipt data.

| Fixture use | Boundary |
| --- | --- |
| Schema examples | OK for understanding canonical event and signal shape. |
| Tests | OK when the test labels them as fixtures. |
| Public measurement | Not allowed; measured claims must come from real provider traffic. |

Every identifier, timestamp, token count, latency value, and dollar value in these files is illustrative fixture data. These files must never be imported into a live dashboard, benchmark report, loss report, or receipt as measured traffic.

The fixtures exist only to show the shape of canonical events and signals described by The Inferock Standard v0.1.0.

## What to read next

- [Canonical Event Schema](../event-schema.md) for the event fields these fixtures illustrate.
- [Public Signal Semantics](../signals.md) for the public signal shape.
- [Asset provenance](../../assets/README.md) for the separate no-mock rule that governs public visuals.
