# Maintainers

- Bharath Koneti (@bharathopius)
- Himashwetha Gowda
- Inferock team contact: founders@opiusai.com

Founder-led maintainer decisions are made by the founders / Inferock team.

Use this page to understand who owns public decisions and how the generated mirror is handled. It is governance context, not a claim that GitHub is the source-of-truth repo.

| Need | Read |
| --- | --- |
| How accepted public changes move | [How this repo works](#how-this-repo-works) |
| Where to file issues or security reports | [How to engage](#how-to-engage) |
| Why public commits use a bot identity | [Publish Identity](#publish-identity) |

## How this repo works

This GitHub repo is a read-only downstream mirror generated from a private monorepo. Issues and PRs are welcome because they help us see bugs, missing coverage, and sharper explanations.

Accepted changes are re-implemented upstream in the private repo by the maintainers, with attribution, and then this mirror is regenerated. A PR will not usually be merged as-is on GitHub; the accepted fix reappears as a maintainer or `inferock-publish` commit that credits the contributor.

## How to engage

File issues for bugs, feature requests, documentation corrections, and reproducible benchmark findings. Security reports should use the private disclosure path in [SECURITY.md](./SECURITY.md), not a public issue.

We aim to triage public issues and PRs within a few business days. Launch periods and security work may change the order, but maintainer decisions stay founder-led.

By contributing, you agree that accepted work can be ported into the private upstream repo and redistributed through this public mirror under this repo's license terms, with attribution.

## Publish Identity

The generated public repo is committed by the bot identity `inferock-publish` using a noreply email. Founders appear in this file and launch posts, not as the publish-job commit author.

GitHub remains a downstream mirror. Maintainers port accepted public changes into the monorepo with attribution, then the manual export job regenerates this repo.

## What to read next

- [CONTRIBUTING](./CONTRIBUTING.md) for tests, no-secret rules, and license signoff.
- [SECURITY](./SECURITY.md) for private vulnerability reports.
- [Hard questions](./docs/hard-questions.md#q13-what-does-the-public-mirror-represent) for the public mirror limitation in the receipt-trust context.
