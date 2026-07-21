# Contributing

The GitHub repo is a generated downstream view. The private GitLab monorepo is the source of truth for code, docs, issues accepted for implementation, release notes, and public export state.

Use this page when you want a public issue or PR to survive the mirror boundary. The main rule is that accepted public work is ported upstream with attribution, then regenerated into this repo.

| Contribution concern | Read first |
| --- | --- |
| Will my PR be merged directly? | [Public PR Porting Policy](#public-pr-porting-policy) |
| Which checks should I run? | [Tests](#tests) |
| What license terms apply? | [License Signoff](#license-signoff) |
| What must never be posted? | [No Secrets](#no-secrets) |

## Public PR Porting Policy

- External PRs are reviewed in GitHub but are not merged by hand into the generated repo.
- A maintainer ports accepted changes upstream into the monorepo, preserving attribution.
- The next manual export job regenerates the public GitHub repo.
- Contributors appear in commit metadata, NOTICE, or changelog entries as appropriate.

## Tests

Use Node.js 22 or newer. The repo pins its package manager in `package.json`; activate that pnpm version through Corepack before installing dependencies.

```sh
node --version
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --version
pnpm install --frozen-lockfile
```

Run the narrowest tests that cover your change, and include the command output in the PR body. The public CI gate runs the root test command:

```sh
pnpm test
```

For export, license, package-parity, or shared measurement changes, maintainers also run upstream-only export and package integrity gates before regenerating the public repo. Those maintainer gates are not required to exist in a generated public checkout.

Measurement fixtures are for tests only. Public examples, screenshots, receipts, GIFs, and index numbers must come from real normal traffic.

## License Signoff

By contributing, you certify that you have the right to submit the change and that it can be redistributed under the applicable public license:

- `inferock-bench`: FSL-1.1-ALv2 with 2-year Apache-2.0 conversion.
- `@inferock/measure`: Apache-2.0.
- The Inferock Standard and `spec/`: CC-BY-4.0.

Do not copy or derive GPL/AGPL code into this repo. Do not add dependency code or model artifacts without license and NOTICE review.

## No Secrets

Issues and PRs must not include provider keys, prompts, raw responses, raw traces, customer identifiers, internal endpoints, env files, AWS account details, or deploy tokens. Share sanitized canonical event shapes and provider documentation links instead.

## What to read next

- [README](./README.md) for the receipt-first product path and public docs index.
- [Security policy](./SECURITY.md) for private vulnerability disclosure.
- [Asset provenance](./assets/README.md) before adding screenshots, GIFs, receipt images, or diagrams.
