# Development Subagents — model routing

**Principle: match model power to task difficulty.** Don't burn a frontier model
on a `grep`; don't hand architecture to a cheap one. When delegating development
work, pick the agent below (each is a real definition in `.claude/agents/`).

| Agent | Model | Use for |
|---|---|---|
| `terraveler-scout` | **haiku** | Fast, cheap recon: find files/symbols, read logs, grep, "where is X", VPS/container status. Read-only. |
| `terraveler-implementer` | **sonnet** | The default builder: standard coding, edits, wiring, docker/compose, deploys, running ingestion. |
| `terraveler-architect` | **opus** | Hard reasoning: schema/architecture decisions, new AXIS pipeline design, tricky trade-offs, gnarly cross-service debugging. |
| `terraveler-reviewer` | **opus** | Adversarial check before shipping: correctness, security, source-integrity/whitelist compliance, live-site safety. |

## Routing rules
- Start at the **lowest tier that fits**; escalate only when the task resists.
- **Recon first, cheaply.** Use `terraveler-scout` (haiku) to locate and understand before spending a bigger model on the change.
- **Design the hard stuff up front.** If the approach isn't obvious, `terraveler-architect` (opus) decides the shape before the implementer writes code.
- **Always review before production.** Anything touching the live site *or* the source-integrity guarantees goes through `terraveler-reviewer` (opus) first.
- **Parallelize** independent recon/implementation across scouts/implementers when the work is separable.

## Not here
The **product** agents — Oculus (harvest), Curator (gpt-4.1), Pigafetta (gpt-4.1),
and future Extractor/Orthodoxy — are not development subagents. They run inside
AXIS on the VPS and follow their own model policy (see AGENTS.md): gpt-4o-mini for
high-volume classification, gpt-4.1 for once-per-item judgment, a reasoning model
reserved for the high-risk voyage-map extraction.
