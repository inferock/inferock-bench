# Security

`inferock-bench` touches provider keys, so security reports get a private path first.

Use this page when a vulnerability could expose keys, route requests incorrectly, bypass local auth, or make public export artifacts differ from reviewed source. Billing disputes and provider-side outages belong in the benchmark evidence path, not the private vulnerability path.

| If you found | Use |
| --- | --- |
| Key storage, masking, routing, local-auth, telemetry, receipt-send, or package-integrity risk | Private security report |
| Public documentation correction, benchmark finding, or provider billing argument without a software vulnerability | Public issue or receipt evidence |

## Reporting a vulnerability

Email `founders@opiusai.com` with the subject `inferock-bench security report`.

Please include:

- The affected package, version, commit, or npm tag.
- The smallest reproduction you can share without provider keys, prompts, raw responses, customer data, or internal endpoints.
- What you believe an attacker can read, write, send, or bypass.
- Whether the issue affects the local benchmark, `@inferock/measure`, The Inferock Standard, or the export pipeline.

Please do not open a public issue for an unpatched vulnerability. If email is not workable for your disclosure process, open a private GitHub Security Advisory if the public repo has advisories enabled.

## What we support

We support the latest public `inferock-bench` release and the current generated public repo. Older releases are best-effort unless the fix is small and the risk is high.

This is a small team. We will try to acknowledge credible private reports within three business days, triage high-risk key or request-routing issues first, and keep you updated when there is a meaningful change. That is an expectation, not a paid SLA.

## Scope

In scope:

- Provider-key storage or masking bugs in `inferock-bench`.
- Local bench-key bypasses that let another local client use your configured provider key.
- Request routing bugs that send traffic somewhere other than the configured provider endpoint.
- Reliability-index or receipt behavior that sends more data than the docs say.
- Export or package-integrity bugs that could make the public repo differ from the reviewed source.

Out of scope:

- Attacks that require control of the user's machine, shell, browser profile, package manager, or npm install path.
- Provider-side logging, retention, billing, outage, or model behavior.
- Social engineering, spam, denial-of-service against public OpiusAI or provider infrastructure, or testing against other users.

There is no bug bounty program right now. We still want the report.

## What to read next

- [What leaves your machine](./docs/what-leaves-your-machine.md) for the documented network and file boundaries.
- [Key handling](./docs/key-handling.md) for provider keys, local `ibl_` keys, masking, and rotation.
- [Threat model](./docs/threat-model.md) for the local benchmark's stated limits.
