# Summary

Describe the change and the user-visible behavior it affects.

Use this template to keep public PRs portable into the upstream source of truth. The questions below protect attribution, test evidence, measurement integrity, license boundaries, and secret hygiene.

| Before opening | Check |
| --- | --- |
| The change can be ported upstream | [Source of Truth](#source-of-truth) |
| The behavior was exercised | [Tests](#tests) |
| Public claims stay receipt-safe | [Measurement Integrity](#measurement-integrity) |
| License and secrets are clean | [License and Secrets](#license-and-secrets) |

# Source of Truth

- [ ] I understand GitHub is downstream and this PR may be ported into the monorepo by a maintainer.
- [ ] I am okay with attribution being preserved in the upstream commit, NOTICE, or changelog as appropriate.

# Tests

Paste the commands you ran and the result.

```sh

```

# Measurement Integrity

- [ ] No fake demo data, seeded failures, fabricated dollar figures, fake terminal output, or synthetic index stats.
- [ ] Public examples, screenshots, receipts, or GIFs in this PR come from real normal traffic, or are explicitly marked TODO-REAL-ASSET.
- [ ] Dollar displays keep provider-recognized recoverable loss separate from unrecognized loss.
- [ ] This PR does not add provider rankings, production-gateway framing, or tamper-proof-audit claims.

# License and Secrets

- [ ] I have the right to contribute this change under the applicable public license.
- [ ] This PR does not copy or derive GPL/AGPL code.
- [ ] This PR contains no provider keys, prompts, raw responses, raw traces, customer identifiers, internal endpoints, env files, AWS account details, or deploy tokens.
