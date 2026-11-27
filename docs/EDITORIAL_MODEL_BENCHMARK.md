# Per-role model benchmark for the editorial team

The editorial team assigns local models to planning, preparation review,
research, writing and draft review. Choosing those models by retrying production
is slow, wasteful and against the live-debugging discipline. This benchmark
replaces trial-and-error with governed, repeatable measurements per role.

## What it is

`scripts/editorial_model_benchmark.py` sends a fixed, clearly-marked **fixture
dossier** (Cabeza de Vaca, synthetic public-domain excerpts) through the same
governed Limen endpoint the worker uses — scoped virtual keys,
`X-Limen-Data-Class`, no fallback, no direct Ollama route — once per
(role × alias × repetition). Each response is graded by validators that mirror
the production strict parsers:

- same transport strictness: `finish_reason: length` is a failure, one JSON
  value or one fenced block only, no fragment extraction, bounded body size;
- the planner returns only `gaps` and one to four `research_items`; the benchmark
  applies the same deterministic downstream composition and validates the full
  DAG, specialties, dependencies and empty source receipts;
- verdict–issues consistency is enforced; research quotations must be exact
  source substrings and writer paragraphs must retain explicit source IDs.

The report contains **metadata only**: outcome category, latency, token counts,
finish category, content SHA-256 and length, schema rule categories and specialty
counts. Raw model output is never exported. For manual quality review,
`--save-raw DIR` writes raw envelopes to an operator-local directory that must
stay out of git, issues and chat.

## What it is not

- Not MCP source consultation, not a database write, not a dispatch, not a
  publication. It performs model inference only.
- Not proof of the physical provider model: `reported_model` is the
  provider-reported alias. Confirm routing in Limen decision/effect evidence.
- Fixture prompts are representative, not the live dossier; a model that passes
  here still needs controlled live preparation and execution. The fixture schema
  validators are faithful *simplified* mirrors; production validation remains
  authoritative.

## Usage

Run from a host with the scoped keys in the environment (same variable names as
the worker gateway):

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
  (`gateway-model-not-authorized` otherwise). To compare a new candidate, add a
  dedicated scoped alias in `litellm_config.yaml` first; do not widen a key.
- `--no-json-mode` reruns without a structured `response_format` to measure how
  much of a failure is format-related versus judgment-related.
- Run it while the model host is otherwise idle; concurrent load invalidates
  latency comparisons and can degrade output.

## Reading the report

`summary[]` gives, per role/alias: `ok_rate` (strict parse **and** schema valid),
outcome breakdown (`invalid-json`, `output-truncated`, `http-*`,
`transport-error`, …), and p50/max latency. Selection guidance:

1. A role model must reach `ok_rate` 1.0 across repetitions **with** structured
   JSON mode before quality is considered.
2. Compare latency against production budgets (100 s preparation transport,
   120 s worker timeout) with headroom.
3. Only then compare judgment quality, using operator-local raw outputs if
   needed; never paste them into issues or chat.

Record the chosen mapping, report hashes and date in issue #125 after the live
acceptance run. The alias → model mapping in `litellm_config.yaml` is the route
configuration; the sanitized benchmark is supporting evidence, not live proof.

## Verified textual mapping — 23 November 2026

Three repetitions per cell passed with no schema-invalid, truncation or timeout:

| Alias and use | Fixture cells | Maximum observed latency | Report SHA-256 |
|---|---:|---:|---|
| `editorial-planner`: managing editor, ethnohistory, editorial | plan/research/draft, 9/9 | 3.657 s | `2dac87583b9a7f4aebb349501ff63be8ab7d56a1e4090cdacc5ce7f023114298` |
| `editorial-research`: history, itinerary | research, 3/3 | 19.703 s | `57536ec0ea9b72b174afb95c5c3c0978aeb482be4c3b1b825bd037c28fa14441` |
| `editorial-writer`: diary | draft, 3/3 | 16.464 s | `6394bb042ffea743d26faf21af2f3c9e3193e21c8fadd2079c76eb180569214c` |
| `editorial-reviewer`: preparation review, copyedit, factcheck | plan-review/review, 6/6 | 8.808 s | `4d65dd48c91971cd4f1ce23ff597ff383c88a25e5443de8b74751601f64a2bc9` |

The configured routes at measurement time were Gemma4 26b for planner, Granite
4.2 30b for research/reviewer and GLM-4.7-Flash q8_0 for writer. Reports live in
`out/model-benchmarks/20261123-*.json`, which is local evidence, not committed
raw model content.

The GGUF runner rejected grammars containing `maxLength` with HTTP 500. The
provider schema therefore omits that keyword; application parsers still enforce
all text-length bounds. Unsupported JSON Schema graph constraints such as
`contains` were not relied upon. The fixed downstream graph is deterministic
code, not a prompt-only guarantee.

## Contract sync

- Execution roles (research / draft / review) import `SYSTEM_RULES`,
  `ROLE_SCHEMAS` and `ROLE_OUTPUT_SCHEMAS` from
  `orchestration/editorial_gateway.py`.
- Preparation roles (plan / plan-review) copy the literal contract strings and
  output schemas from `lib/editorialPreparation.ts`. `compose_plan` mirrors
  `composeEditorialPlan`. Update both in the same change.

## Verification

`python3 -m unittest discover -s scripts -p test_editorial_model_benchmark.py`
covers strict parse categories, deterministic composition, every role validator,
transport error categories, scoped-key authorization and the guarantee that raw
output never enters report cells. All unit fixtures are offline; no network,
model, source or database access.
