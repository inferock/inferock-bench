<!--
Maintainer source map: apps/inferock-bench/src/config.ts; apps/inferock-bench/src/provider.ts; apps/inferock-bench/src/proxy.ts; apps/inferock-bench/src/server.ts; apps/inferock-bench/src/dashboard.ts; apps/inferock-bench/src/storage.ts.
-->

# Key handling

There are two kinds of keys in `inferock-bench`.

Provider keys are your OpenAI, Anthropic, Gemini, or OpenRouter keys. The `ibl_` key is the local bench key that lets your app call the local proxy.

Read this at the moment you are deciding whether to paste a provider key. The important split is simple: provider keys authenticate provider requests; `ibl_` keys authenticate local localhost calls.

| Material | Decision point |
| --- | --- |
| Provider key | Save it only when you are comfortable with a local proxy forwarding provider requests from this machine. |
| Persistent `ibl_` key | Put this in your SDK instead of the provider key when calling localhost. |
| Agent ephemeral `ibl_` key | Use it only for a scoped benchmark run; it is not written to config. |
| Receipts and events | Treat them as local evidence files that can disclose content if you share them. |

## Provider keys

Provider keys can be supplied in either place:

- Environment variables: `INFEROCK_BENCH_OPENAI_API_KEY`, `OPENAI_API_KEY`, `INFEROCK_BENCH_ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY`, `INFEROCK_BENCH_GEMINI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `INFEROCK_BENCH_OPENROUTER_API_KEY`, or `OPENROUTER_API_KEY`.
- The local config file, usually `~/.inferock-bench/config`.

If a provider key comes from the environment, `inferock-bench` reads it and uses it for provider calls. If you save a provider key through the dashboard, `inferock-bench` writes it to the local config file.

The config file is written with `0600` permissions. Masking is display-only: the dashboard and setup state show a shortened prefix and last four characters, while the real key stays in the config file or environment.

## The `ibl_` key

On first run, `inferock-bench` generates an `ibl_` local bench key and stores it in the config file. Your SDK uses that key when it calls localhost, so the local proxy can reject accidental unauthenticated traffic.

The `ibl_` key does not authenticate you to Inferock, OpiusAI, OpenAI, Anthropic, Gemini, or OpenRouter. It is local process auth for the benchmark.

`INFEROCK_BENCH_KEY` can override the key your app sends. When both a generated key and `INFEROCK_BENCH_KEY` exist, the proxy accepts both.

The dashboard shows the local bench key masked by default. Full-key reveal is gated: the same-origin dashboard page or the local bench key must authorize `/api/key`, so a bare unauthenticated request does not return the full value. Provider-key setup through the dashboard uses the same local management gate.

Reliability-index opt-in does not change key handling. Today it records consent locally, shows the aggregate payload, and sends nothing while the public index is pre-launch. When the index goes live, contribution must remain reviewable and revocable, and keys must never be part of the payload.

Real-agent benchmark runs create an additional ephemeral `ibl_` key for each
provider-scoped agent process. The agent receives that local key and the
localhost base URL only. It does not receive provider keys. The proxy maps the
ephemeral key to the run ID and selected provider, then attaches the real
provider key server-side inside the local `inferock-bench` process.

Agent command, environment, stdout, stderr, dashboard events, and receipt fields
must redact usable `ibl_`, `sk-`, `sk-ant-`, and bearer-token values.

## Key lifecycle matrix

| Material | Storage | Who receives it | Masking | Rotation or revocation |
| --- | --- | --- | --- | --- |
| Provider key | Environment variable or `~/.inferock-bench/config` when saved through setup/dashboard; config is written `0600` | Only the local `inferock-bench` process and the selected provider API request; real-agent processes do not receive it | Dashboard/setup/status show masked prefix and last four characters; masking is display-only | Revoke in the provider console, then update the env var or saved local config key |
| Persistent `ibl_` local bench key | `~/.inferock-bench/config`, generated on first run and written `0600` | Your app/SDK sends it to localhost; the local proxy accepts it for local auth; the same-origin dashboard page can reveal/copy it | Dashboard/status mask it; `/api/key` requires dashboard authorization or the local bench key; `key reveal` can print the full value by explicit command | Stop the server, edit or remove `benchKey` in config, restart, and update SDK config |
| Agent ephemeral `ibl_` key | In-memory run grant for the provider-scoped agent process; not written to config | The local agent process and localhost proxy only; it is scoped to a run, provider, optional model list, expiry, and call budget | Agent command, environment, stdout, stderr, dashboard events, and receipt fields must redact usable values | Revoked when the run ends or the grant is marked revoked; exhausted budgets reject dispatch |
| Environment variables | Process environment for `inferock-bench` and your shell | The local process reads them; provider keys are forwarded only to their provider, and `INFEROCK_BENCH_KEY` is accepted by localhost | Status output shows masked key status; env values are not written back unless you save a key through setup/dashboard | Change or unset the environment variable and restart affected processes |
| Receipts and event files | `~/.inferock-bench/events.jsonl` and `~/.inferock-bench/receipts/`; new/touched files are written `0600` and internal artifact directories are created `0700` | Local dashboard, CLI reports, and anyone you later share the files with | Provider keys are not stored; receipts/events can include response text, tool calls, schemas, model IDs, timing, provider IDs, selected headers, and detector evidence | Delete or archive local files; treat shared receipts as already disclosed to the recipient |

Files created by older versions keep their existing permissions until the current version rewrites or touches them. If you previously ran the bench on a shared machine, check the mode on old `events.jsonl` and receipt files before treating them as private.

## Rotate or revoke

To rotate a provider key, revoke it in the provider console, create a replacement, then update the local environment variable or paste the replacement into the dashboard.

To remove a saved provider key from `inferock-bench`, clear it in the dashboard setup flow or edit `~/.inferock-bench/config` while the server is stopped.

To rotate the local `ibl_` key, stop the server, edit or remove the `benchKey` value in `~/.inferock-bench/config`, and start `inferock-bench` again. If the key is missing, the app generates a new one. Update your SDK snippet after rotation.

## Malicious forks

The real risk is not the reviewed local design. It is running a fork or package that looks like `inferock-bench` but quietly sends provider keys, prompts, responses, or receipts somewhere else.

Before pasting a provider key:

- Install the package named `inferock-bench`, not a lookalike.
- Prefer a locked dependency path in real projects, not an unreviewed global install from a random README.
- Check that the code path you run matches the generated public repo and the npm package metadata.
- Review changes that touch `apps/inferock-bench/src/config.ts`, `proxy.ts`, `telemetry.ts`, `storage.ts`, or the adapter files before trusting them with a provider key.

After the public publish flip, use npm provenance when it is available. The intended public path is a CI-published package with npm provenance/attestation. If provenance is missing, or the package source does not line up with the generated public repo, treat that as a reason to slow down before entering a key.

Source availability helps here because the request path and storage path can be audited. It does not protect you if you choose to run changed code.

## What to read next

- [What leaves your machine](what-leaves-your-machine.md) for the request, receipt, agent, and reliability-index paths.
- [Threat model](threat-model.md) for malicious-fork and local-machine limits.
- [Security policy](../SECURITY.md) if you find a key-storage, masking, or routing vulnerability.
