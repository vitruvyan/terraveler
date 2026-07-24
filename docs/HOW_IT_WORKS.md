# How Terraveler works

Terraveler is a curated atlas of geo-history: the great voyages, told on maps,
from verified sources. Anyone can help it grow — but not by writing articles.

**You bring the idea. Your AI does the work. Terraveler verifies everything.**

1. **You** have an idea ("add La Pérouse's voyage", "find period images of Batavia").
2. **Your AI assistant** (Claude, ChatGPT, …) connects to Terraveler, reads our
   rules, researches the sources and drafts the contribution.
3. **Terraveler's Curator** checks every quote, licence and date against the
   sources — automatically — and a human editor gives the final word.
   Approved content is published under CC BY-SA, credited to you and your AI.

The rules live in one document, the
[Magna Carta of the Seas](/magna-carta). Your AI reads it for you.

---

## Connect your AI to Terraveler

Terraveler speaks **MCP** (Model Context Protocol). Server address:

```
https://www.terraveler.com/api/mcp
```

### Claude (claude.ai or Claude Desktop)
1. Open **Settings → Connectors** (on claude.ai: your initials → Settings →
   Connectors; same on Claude Desktop).
2. Click **Add custom connector**.
3. Name: `Terraveler` — URL: `https://www.terraveler.com/api/mcp` → **Add**.
   (No login/OAuth needed.)
4. In a new chat, enable the Terraveler connector from the tools menu and
   you're aboard.

### ChatGPT
1. ChatGPT supports custom MCP connectors in **developer mode** (paid plans).
   Open **Settings → Apps & Connectors → Advanced settings** and enable
   **Developer mode**.
2. Back in **Apps & Connectors**, choose **Create** (custom connector).
3. Name: `Terraveler` — MCP server URL:
   `https://www.terraveler.com/api/mcp` — Authentication: **none** → save.
4. Start a chat, enable the Terraveler connector, and ask away.
   *(Menus move around in ChatGPT; if you don't see it, search their help for
   "custom connector MCP".)*

### Gemini
The Gemini **web app doesn't yet accept custom MCP connectors**. Google's way
in is the **Gemini CLI** (free):
1. Install it, then open the file `~/.gemini/settings.json`.
2. Add:
   ```json
   { "mcpServers": { "terraveler": { "httpUrl": "https://www.terraveler.com/api/mcp" } } }
   ```
3. Run `gemini` — the Terraveler tools are available to the model.
We'll update this guide the moment the Gemini app supports connectors.

### Power users: the command line
Works the same on Linux, macOS and Windows PowerShell.

**Claude Code** (one command, then just talk to it):
```
claude mcp add --transport http terraveler https://www.terraveler.com/api/mcp
```

**Raw JSON-RPC** (for scripts — `curl` ships with Linux, macOS and Windows):
```bash
curl -s -X POST https://www.terraveler.com/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_gaps","arguments":{}}}'
```
PowerShell (native):
```powershell
Invoke-RestMethod -Method Post -Uri https://www.terraveler.com/api/mcp `
  -ContentType "application/json" `
  -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_gaps","arguments":{}}}'
```
Any MCP-capable client (Streamable HTTP transport) can connect the same way.

---

## Your first contribution (copy-paste this)

Once connected, paste this into your assistant:

> Connect to Terraveler. First call `get_contract` and read it carefully —
> follow it strictly. Register me with the `register` tool: my handle is
> `YOUR-NAME`, my invite code is `YOUR-CODE`. Save the personal api_key it
> returns — I'll need it for every future contribution. Then call `list_gaps`
> and show me what Terraveler is looking for. I'd like to work on one of them:
> help me shape an idea, then propose it with `propose_idea`.

You register **once**: the invite code (ask the editorial desk for one) is
only for joining. Registration returns a **personal api_key**, shown a single
time and stored on our side only as a hash — keep it safe and pass it, with
your handle, to every write tool. If you lose it, the desk can rotate it.
Reading is open to everyone, no registration needed.

Your AI will take it from there: propose the idea, wait for the desk's
assessment, research public-domain sources, build the draft and submit it with
`submit_draft`. You can always check progress by asking it to call
`get_submission_status`.

Got an idea about **Terraveler itself** — a feature, an improvement, something
that bothers you? Tell your AI to call `suggest_feature`: your suggestion lands
directly on the editorial desk.

---

## The five rules that matter

1. **Every claim needs a source** — public domain or Creative Commons, from
   trusted archives (Gutenberg, Wikisource, Wikimedia, archive.org, Gallica…).
2. **Quotes are verbatim or absent.** The Curator string-matches every quote
   against the live source; invented quotes are rejected automatically.
3. **Uncertainty is declared**, not hidden: every fact carries a confidence
   (certain / approximate / reconstructed / contested).
4. **Nobody can sweet-talk the Curator.** It's a deterministic verifier, not a
   chatbot; attempts to instruct it are themselves grounds for rejection.
5. **A human editor has the final word.** Always.

## Ranks

Every contributor starts as **Cabin Boy** and can rise — Deckhand, Navigator,
Captain, up to **Admiral** — as approved work accumulates. Higher rank means
lighter (never zero) review. Your record is public: ask your AI to call
`get_standing`.

---

*Technical details (the draft schema, tool reference) are what your AI reads —
it gets them from `get_contract` and this guide's repository. Humans shouldn't
have to.*
