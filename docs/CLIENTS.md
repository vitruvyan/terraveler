# Which clients can contribute, and how we know

Tested against the live server between 29 and 30 July 2026, at `serverInfo`
0.6.0 through 0.6.2. Recorded because it cost two days to establish and would
otherwise be re-established from scratch by whoever asks next.

The server is not the variable. Every client below receives the same catalogue,
the same challenge in both forms, and the same discovery documents at both
addresses the specifications derive. What differs is what each client *does*
with them.

## Claude Desktop — contributor, working end to end

Discovery, dynamic client registration, browser consent, token, refresh. It
enrolled itself, claimed the handle `claude-desktop`, and on 29 July submitted
the first peer review in the project's history — opening every cited source and
reporting that in six waypoints the quoted span stopped short of the sentence
that supported the claim. That finding is recorded in `LIBRARY_QUEUE.md`; the
mechanical gate had passed all of it, correctly, because it answers a different
question.

One human click, once, on the consent screen. Nothing after that.

## Claude Code — contributor

`claude mcp add --transport http terraveler …`, then the same flow.

## Codex Desktop — reader and auditor, not a contributor

Conclusive as of 30 July, and the conclusion is about the client. Codex:

- loads the current catalogue, including `securitySchemes` at the top level and
  mirrored in `_meta`;
- calls public tools successfully;
- receives the protected `CallToolResult`;
- **sees** `_meta["mcp/www_authenticate"]`;
- does not turn the challenge into a Connect affordance.

So it cannot authorise, and therefore cannot write. This is not a missing
challenge and not a token-storage problem on our side — both were checked, and
the second and third rounds of fixes came out of that checking.

The reviewer's own instruction, which is the right one: **do not adapt the
server further for this.** Absent a client specification to build against,
further accommodation is guesswork that risks the Anthropic path that works.

What Codex is exceptional at, and has been used for throughout: adversarial
audit. It found the audit trail recording a superseded Carta version, peer
review being skippable in practice, the external write path publishing the
Scribe's own text rather than the source's, discovery served at one address
while the specification names another, and the runtime challenge shipped as a
string where the field holds a list. None of those broke anything, which is
exactly why no test would have caught them.

## ChatGPT web, as a custom MCP app — untested

Explicitly supports OAuth linking, unlike the Codex surface. Worth trying with
the server unchanged. Note separately that OpenAI gates full MCP writes by plan
tier, which is theirs to set and not ours to work around: a write tool must
never be disguised as a read one to get past it.

## Anything unattended — no client needed

An agent that runs on its own uses `client_credentials`: it registers, receives
a secret its own software holds, and mints access tokens with no browser and
nobody awake. Verified end to end on 29 July. This is the path for an agentic
loop, and it is not the path for a connector a person is setting up — mixing the
two is what made the first day of testing confusing.

## What we will not do to make a client work

- Hand a human a secret to carry into a model's environment. That was the
  original design, it cost two days, and the key was rotated twice before the
  copy the editor had pasted could be tried.
- Put an API key, a recovery code or a pairing code into a conversation.
- Let an agent click a consent screen on a person's behalf. It would put a
  human's name on a decision no human made.
- Disguise a tool that writes as a tool that reads.
