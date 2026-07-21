<!--
Maintainer source map: oss/public-root/README.md test consent text;
oss/public-root/docs/coverage-test-methodology.md non-interactive consent and provider-scope rules;
apps/inferock-bench/src/cli.ts test/setup/key/status behavior;
apps/inferock-bench/src/proxy.ts local health, OpenAI route, and local bench-key auth;
.gitlab-ci.yml playwright-bench job; apps/inferock-bench/e2e/tests for headless dashboard tests.
-->

# CI integration

## What this is

`inferock-bench` is a local diagnostic proxy for metered LLM API traffic. In CI, use it either as a headless local proxy around a small smoke call or as the full `inferock-bench test` coverage battery with explicit estimate acceptance.

Any provider calls made by CI are real provider usage on the provider key you configure for that CI job. If you only run the estimate step and stop there, the benchmark makes zero provider calls.

## Prerequisites

- Node.js 22+ with npm in the CI image.
- A CI secret for the provider key, such as `OPENAI_API_KEY` or `INFEROCK_BENCH_OPENAI_API_KEY`.
- A low-limit or development provider key while evaluating.
- A private bench home for the job, usually under the workspace.

Read [Key handling](../key-handling.md) and [What leaves your machine](../what-leaves-your-machine.md) before putting provider credentials in CI. For the full coverage battery method, read [Coverage test methodology](../coverage-test-methodology.md).

## Setup

Use environment variables for provider keys in CI so no setup prompt is needed:

```sh
export INFEROCK_BENCH_HOME="$PWD/.inferock-bench"
export INFEROCK_BENCH_OPENAI_API_KEY="$OPENAI_API_KEY"
```

For the complete coverage battery, first run the same command in a reviewable context and read the printed estimate:

```sh
npx inferock-bench test --providers openai --model openai:gpt-4o-mini-2024-07-18
```

The estimate output includes:

```text
estimate hash: sha256:<printed_hash>
```

The non-interactive CI run must pass that displayed hash:

```sh
npx inferock-bench test --providers openai --model openai:gpt-4o-mini-2024-07-18 --accept-estimate 'sha256:<printed_hash>'
```

`--yes` by itself is rejected in non-interactive mode. Agent mode has a separate install-consent hash when the default local agent must be auto-provisioned; agent mode currently supports OpenAI and Anthropic routes, while Gemini and OpenRouter use the built-in generator.

## First call

For a minimal CI smoke call through the local proxy, start the bench, wait for health, reveal the local `ibl_` key, send one OpenAI-compatible request, then render the receipt:

```sh
npx inferock-bench start > inferock-bench.log 2>&1 &
bench_pid=$!
trap 'kill "$bench_pid" 2>/dev/null || true' EXIT

until curl -fsS http://127.0.0.1:4318/health >/dev/null; do sleep 1; done
bench_key="$(npx inferock-bench key reveal 2>/dev/null)"

curl -sS http://127.0.0.1:4318/v1/chat/completions \
  -H "authorization: Bearer $bench_key" \
  -H "content-type: application/json" \
  -d '{
    "model": "gpt-4o-mini-2024-07-18",
    "messages": [
      { "role": "user", "content": "Draft a five-bullet checklist for reviewing an AI invoice." }
    ]
  }'

npx inferock-bench receipt --compact
```

## What you'll see

Observation: after the first successful proxied call, `inferock-bench.log` contains:

```text
first call measured ✓
```

Observation: `npx inferock-bench receipt --compact` prints a local receipt and writes a JSON bundle under the bench home. Interpretation: the receipt's dollar and time-loss values are computed from the observed CI traffic under the shipped measurement rules; they are not provider admissions and they do not cover calls that bypassed the local proxy.

## Troubleshooting

If CI prints `Non-interactive inferock-bench test requires --accept-estimate <hash>`, review the estimate output and pass the exact displayed hash. Do not replace this with `--yes`.

If the smoke call returns `invalid_local_bench_key`, make sure every `npx inferock-bench` command shares the same `INFEROCK_BENCH_HOME`. If it returns `missing_provider_key`, verify the provider-key CI secret is available to the `inferock-bench` process.

The repository's own headless dashboard tests are separate from provider-measurement CI: the checked-in GitLab `playwright-bench` job runs `pnpm --dir apps/inferock-bench exec playwright test` against test servers and fixtures, not live provider keys.
