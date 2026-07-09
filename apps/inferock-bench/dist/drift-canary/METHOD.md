# Per-Model Drift Canary Method

Method ID: `drift_canary_floor_v1`

Use this method note when reviewing how drift canary evidence is gathered and why baseline collection is separate from a flagged drift result.

| Method concern | Boundary |
| --- | --- |
| Prompt set | Fixed, versioned GSM8K-Platinum and MMLU exact-match canary items. |
| Baseline | Per provider, model, and effective protocol version; protocol changes start a new segment. |
| Dollarization | Floor based on provider-billed cost of degraded calls when drift is flagged; provider-recognized dollars stay `0` until provider recognition. |

The coverage cycle runs a fixed, versioned canary per selected provider/model:
25 GSM8K-Platinum numeric exact-match prompts and 25 MMLU A/B/C/D exact-match prompts.
Prompts use normal known-answer questions only. The protocol requests temperature
`0` where the provider accepts that field. When the provider rejects temperature
on the selected model family, the canary omits temperature and uses the provider
default temperature for that provider/model. Anthropic Claude 4.7+/5 Messages
calls omit `temperature` per Anthropic prompt-validation compatibility guidance.
OpenAI GPT-5/o Chat Completions canary calls omit `temperature`, use
`max_completion_tokens`, and apply a 256-token lower bound so normal known-answer
traffic does not fail from reasoning-token output-limit exhaustion. Other OpenAI
chat canary calls continue to use `max_tokens`. The OpenRouter
`moonshotai/kimi-k2.7-code` pinned endpoint omits `temperature` because OpenRouter
rejects that parameter when endpoint pinning is enforced.

The grader follows exact-match extraction patterns attributed to
`openai/simple-evals` under MIT; no `i-gao/model-equality-testing` code is copied.
The canary records per-item pass/fail, full response text, served model ID, and
OpenAI `system_fingerprint` when present. Drift is not output hashing: temperature
0 can still vary due to serving and floating-point effects, so the decision unit is
accuracy over the full canary set.

The effective protocol records the prompt-set version, temperature mode,
output-token parameter and bound, route, grading, and flagging method. Baselines
are keyed by provider, model, and effective protocol version. A protocol-version
change starts a new baseline segment and reports `baseline_collecting` until
`K=3` complete runs exist for that provider/model/protocol; the runner never
compares runs across protocol versions. Within one provider/model/protocol
segment, the first `K=3` complete canary runs establish baseline accuracy. A
later run flags drift only when accuracy drops and the one-sided Fisher exact
p-value is `<0.05`.

Dollarization is a floor: when drift is flagged, standard loss is the provider-billed
cost of degraded calls in the affected window. Canary calls carry higher evidence;
same-model customer calls between last-good and first-flagged carry lower evidence.
Provider-recognized dollars are `0` until the provider recognizes the regression,
so recognition gap equals the floor.

Sources: arXiv:2307.09009, arXiv:2410.20247, arXiv:2512.03816,
arXiv:2506.09501, https://huggingface.co/datasets/madrylab/gsm8k-platinum,
https://github.com/hendrycks/test, https://github.com/openai/simple-evals,
https://docs.anthropic.com/en/api/prompt-validation,
https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/,
https://developers.openai.com/api/docs/guides/reasoning.

## What to read next

- `THIRD_PARTY_LICENSES.md` for the fixed canary subset notices.
- `spec/signals.md` in the public export for the deferred public drift-class boundary.
- `docs/coverage-test-methodology.md` in the public export for how coverage states are reported.
