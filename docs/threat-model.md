<!--
Maintainer source map: apps/inferock-bench/src/config.ts; apps/inferock-bench/src/proxy.ts; apps/inferock-bench/src/storage.ts; apps/inferock-bench/src/telemetry.ts; apps/inferock-bench/src/receipt.ts; scripts/oss/export-manifest.ts.
-->

# Threat model

`inferock-bench` is a local diagnostic benchmark. It is meant to prove what happened on your own provider traffic without asking you to hand provider keys to Inferock.

Read this after the key-boundary pages if you are deciding what risk this local benchmark can and cannot reduce. The model is deliberately narrow: local evidence and local key handling, not hosted production guarantees.

| Need | Start here |
| --- | --- |
| What the local design tries to prevent | [We try to protect against](#we-try-to-protect-against) |
| What remains your responsibility | [We do not protect against](#we-do-not-protect-against) |
| Why source review matters | [Why the source matters](#why-the-source-matters) |

## We try to protect against

- Accidental Inferock cloud telemetry. The local benchmark should not phone home with keys, prompts, responses, receipts, or traces.
- Reliability-index overreach. The index is opt-in, records consent locally, shows the payload, and sends nothing while the public index is pre-launch; any live send path must stay reviewable and revocable.
- Provider-key leakage through the dashboard. Saved keys are written to a local `0600` config file and shown back only in masked form.
- Accidental unauthenticated localhost use. The local `ibl_` bench key gates proxied model requests.
- Weak public claims. Reports and receipts come from measured local events; receipts keep spent, bill-bounded money loss, time loss, provider-recognized amounts, bill-bounded recognition gap, and invoice-check exposure separate.
- Public-export drift. The generated repo is manifest-driven so the public code and docs can be reviewed as a set.

## We do not protect against

- A compromised machine, shell, browser, editor, terminal history, package manager, or npm cache.
- A malicious fork, typo-squatted package, or edited local checkout.
- Provider-side retention, logging, billing mistakes, outages, model behavior, or security incidents.
- Your app sending sensitive prompts or responses to the provider. The proxy forwards the provider request you asked it to measure.
- Someone with local filesystem access reading `events.jsonl`, receipts, shell environment, or the config file.
- Production-gateway availability, failover, secure multi-tenant key custody, or audit-ledger guarantees. Those are hosted-product responsibilities, not this local benchmark.

## Why the source matters

The local app is FSL-1.1-Apache-2.0, `@inferock/measure` is Apache-2.0, and The Inferock Standard is CC-BY-4.0. The license stack is designed so you can inspect the key path, proxy path, event log, detector math, and export manifest instead of trusting a hosted black box.

That auditability is not magic. It only helps if you run the real package, review meaningful changes, and treat local evidence files as private.

## What to read next

- [What leaves your machine](what-leaves-your-machine.md) for the concrete network and file paths.
- [Key handling](key-handling.md) before entering provider credentials.
- [CONTRIBUTING](../CONTRIBUTING.md) for public-export and no-secret rules that keep claims reviewable.
