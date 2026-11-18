# Per-role model benchmark for the editorial team

The editorial team assigns one local model per role (planner, preparation
reviewer, research, writer, fact-check reviewer). Choosing those models by
retrying the production preparation flow is slow, wasteful and against the
live-debugging discipline. This benchmark replaces trial-and-error with one
governed, repeatable measurement per role.

## What it is

`scripts/editorial_model_benchmark.py` sends a fixed, clearly-marked **fixture
dossier** (Cabeza de Vaca, synthetic public-domain excerpts) through the same
governed Limen endpoint the worker uses — scoped virtual keys,
`X-Limen-Data-Class`, no fallback, no direct Ollama route — once per
(role × alias × repetition). Each response is graded by validators that mirror
the production strict parsers:

- same transport strictness: `finish_reason: length` is a failure, one JSON
  value or one fenced block only, no fragment extraction, bounded body size;
- role schemas: plan DAG/specialty/empty-receipt rules, verdict–issues
  consistency, research quotes must be exact source substrings, draft
  citations must match whole body paragraphs.

The report contains **metadata only**: outcome category, latency, token
counts, finish category, content SHA-256 and length. Raw model output is never
exported. For manual quality review, `--save-raw DIR` writes raw envelopes to
an operator-local directory that must stay out of git, issues and chat.

## What it is not

- Not MCP source consultation, not a database write, not a dispatch, not a
  publication. It performs model inference only.
- Not proof of the physical provider model: `reported_model` is the
  provider-reported alias. Confirm routing in Limen decision/effect evidence.
- Fixture prompts are representative, not the live dossier; a model that
  passes here still needs the single authorized live preparation to verify the
  real path. The fixture schema validators are faithful *simplified* mirrors;
  production validation remains authoritative.

## Usage

Run from a host with the scoped keys in the environment (same variable names
as the worker gateway):

```sh
EDITOR_LIMEN_BASE_URL=https://admin.terraveler.com \
EDITOR_LIMEN_API_KEY=... \
EDITOR_LIMEN_DATA_CLASS=editorial \
EDITOR_LIMEN_MODEL_KEYS='{"editorial-reviewer":"...","editorial-planner":"..."}' \
python3 scripts/editorial_model_benchmark.py \
  --aliases local-default editorial-planner editorial-reviewer editorial-research editorial-writer \
  --repeat 3 --out benchmark-report.json
```

- `--aliases` accepts only aliases configured in Limen with scoped keys
  (`gateway-model-not-authorized` otherwise). To compare a new candidate, add
  a dedicated scoped alias in `litellm_config.yaml` first; do not widen an
  existing key.
- `--no-json-mode` reruns without `response_format: json_object` to measure
  how much of a failure is format-related versus judgment-related.
- Run it while the model host is otherwise idle; concurrent load (e.g.
  training jobs) invalidates latency comparisons and can degrade output.

## Reading the report

`summary[]` gives, per role/alias: `ok_rate` (strict parse **and** schema
valid), outcome breakdown (`invalid-json`, `output-truncated`, `http-*`,
`transport-error`, …), and p50/max latency. Selection guidance:

1. A role model must reach `ok_rate` 1.0 across repetitions **with** JSON mode
   before quality is even considered.
2. Then compare latency against the production budgets (100 s preparation
   transport, 120 s worker timeout) with headroom.
3. Only then compare judgment quality, by reading the operator-local raw
   outputs side by side.

Record the chosen mapping, the report hash and the date in issue #125; the
alias → model mapping in `litellm_config.yaml` is the change, the benchmark
report is its evidence.

## Contract sync

- Execution roles (research / draft / review) import `SYSTEM_RULES` and
  `ROLE_SCHEMAS` from `orchestration/editorial_gateway.py` — they cannot
  drift.
- Preparation roles (plan / plan-review) copy the literal contract strings
  from `lib/editorialPreparation.ts` (`generator` → `contract`). If that file
  changes, update `PLAN_CONTRACT` / `PLAN_REVIEW_CONTRACT` /
  `PREPARATION_SYSTEM` in the benchmark script in the same PR.

## Verification

`python3 -m unittest discover -s scripts -p test_editorial_model_benchmark.py`
covers the strict parse categories, every role validator (including cycle,
dangling-dependency, quote-substring and claim-paragraph rules), transport
error categories, scoped-key authorization, and the guarantee that raw output
never enters report cells. All fixtures are offline; no network, model, source
or database access.
