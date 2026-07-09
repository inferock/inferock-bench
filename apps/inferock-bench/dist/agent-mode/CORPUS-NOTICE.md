# Agent Coding Corpus Notice

Corpus: `agent-coding-corpus-exercism-js-v1`

Use this notice to verify that the bundled real-agent tasks have license-vetted origins before a benchmark run asks a local coding agent to operate on them.

| Check | Evidence here |
| --- | --- |
| Corpus identity | `agent-coding-corpus-exercism-js-v1` |
| Source repositories and revisions | [Sources checked](#sources-checked) |
| Included task list | [Included exercises](#included-exercises) |

The bundled real-agent coding tasks are small JavaScript fixtures derived from
MIT-licensed Exercism practice exercises and canonical problem specifications.
The local tests are generated for `node:test`; the Exercism harness machinery
is not vendored.

Sources checked:

| Source | Revision | License |
| --- | --- | --- |
| `https://github.com/exercism/javascript` | `d8cabd2cddcc2b20f0beb4e1d2d31ff946a93ccd` | MIT |
| `https://github.com/exercism/problem-specifications` | `77d50e4a40e93b90bf45fa610a2329087e4ca3d1` | MIT |

Included exercises:

- `hello-world`
- `two-fer`
- `leap`
- `rna-transcription`
- `resistor-color`
- `pangram`

Each included exercise had an MIT per-exercise license file at the checked
`exercism/javascript` revision.

## What to read next

- `apps/inferock-bench/src/agent-mode/CORPUS-MANIFEST.json` for the machine-readable corpus manifest.
- `apps/inferock-bench/src/drift-canary/THIRD_PARTY_LICENSES.md` for the separate drift-canary notice bundle.
- `docs/coverage-test-methodology.md` in the public export for the real-agent consent and traffic rules.
