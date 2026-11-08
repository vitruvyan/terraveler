"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { EditorialAgent, TeamRole } from "@/lib/editorialTeam";
import "./AgentTeam.css";

type Role = TeamRole;
export type TeamAgent = EditorialAgent;
export type AgentTeamData = {
  agents: TeamAgent[];
  models: { id: string }[];
  gateway: { status: "ready" | "not-configured" | "unavailable" };
  execution: "not-connected";
};
type Draft = Omit<TeamAgent, "created_at" | "version"> & { expected_version: number };
const ROLES: Record<Role, { label: string; description: string }> = {
  coordinator: { label: "Coordinator", description: "Organises work and identifies the next step." },
  research: { label: "Researcher", description: "Collects and compares historical and geographical sources." },
  writer: { label: "Writer", description: "Combines the collected material into a sourced draft." },
  reviewer: { label: "Reviewer", description: "Checks a draft and reports issues that need correction." },
};
const blank = (): Draft => ({ agent_key: `agent-${crypto.randomUUID()}`, expected_version: 0, name: "", role: "research", model: "", instructions: "", enabled: false });
const draftOf = (agent: TeamAgent): Draft => ({ agent_key: agent.agent_key, expected_version: agent.version, name: agent.name, role: agent.role, model: agent.model, instructions: agent.instructions, enabled: agent.enabled });

function errorMessage(code: unknown, fallback: string): string {
  if (code === "conflict") return "Another version was saved. Your changes are still here. Reload the saved configuration before editing again.";
  if (code === "idempotency-conflict") return "This save request conflicts with an earlier request. Edit the configuration before saving again.";
  if (code === "model-unavailable") return "The model is no longer available through Limen. Choose an available model or save the configuration as paused.";
  if (code === "gateway-unavailable" || code === "gateway-not-configured") return "Limen is not available. You can save a paused configuration; model access must be verified before enabling it.";
  if (code === "team-unavailable") return "Agent configuration is not available yet. The team database setup must be completed before configurations can be saved.";
  return fallback;
}

export default function AgentTeam({ initialData }: { initialData?: AgentTeamData }) {
  const [data, setData] = useState<AgentTeamData | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const requestId = useRef<string | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async (): Promise<AgentTeamData | null> => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/desk/team", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(response.status === 401 ? "Your editor session has ended. Return to the Desk and sign in." : errorMessage(body?.code ?? body?.error, "Could not load the team. Please retry."));
      if (!body || !Array.isArray(body.agents) || !Array.isArray(body.models) || !body.gateway) throw new Error("Could not read the team configuration. Please retry.");
      if (sequence !== loadSequence.current) return null;
      setData(body);
      return body as AgentTeamData;
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : "Could not load the team. Please retry.");
      return null;
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData) void load();
    return () => { loadSequence.current++; };
  }, [initialData, load]);

  function open(agent?: TeamAgent) {
    requestId.current = null;
    setSaveError("");
    setMessage("");
    setForm(agent ? draftOf(agent) : blank());
  }

  function update(patch: Partial<Draft>) {
    requestId.current = null;
    setSaveError("");
    setForm(current => current ? { ...current, ...patch } : null);
  }

  const gatewayReady = data?.gateway.status === "ready";
  const modelAvailable = !!form && !!data?.models.some(model => model.id === form.model);
  const canSave = !!form && /^[a-z0-9][a-z0-9-]{1,79}$/.test(form.agent_key) && !!form.name.trim() && !!form.model.trim() && !!form.instructions.trim() && (!form.enabled || (gatewayReady && modelAvailable));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving || !canSave) return;
    requestId.current ??= crypto.randomUUID();
    setSaving(true);
    setSaveError("");
    setMessage("");
    try {
      const response = await fetch("/api/desk/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, request_id: requestId.current }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.result) {
        setSaveError(response.status === 401 ? "Your editor session has ended. Return to the Desk and sign in. Your changes remain in this form." : errorMessage(body?.code ?? body?.error, "Could not save the configuration. Your changes are still here; retrying will reuse the same save request."));
        return;
      }
      setForm(null);
      requestId.current = null;
      setMessage(`Configuration saved as version ${body.result.version}. Agent execution is not connected yet.`);
      await load();
    } catch {
      setSaveError("The save response was not received. Your changes are still here; retrying will reuse the same save request.");
    } finally {
      setSaving(false);
    }
  }

  async function reloadSelected() {
    const key = form?.agent_key;
    const latest = await load();
    const agent = latest?.agents.find(candidate => candidate.agent_key === key);
    if (agent) open(agent);
    else if (latest) setSaveError("No saved configuration was found for this agent. Your changes remain in the form; you can retry saving.");
  }

  return (
    <section className="agent-team" aria-label="Editorial agent team">
      <p className="agent-team-intro">Configure the editorial team here. Each save records a new version of the agent’s model, role and instructions.</p>
      <div className="ec-notice">
        <strong>Execution is not connected yet.</strong> Saving or enabling a configuration does not start an agent or publish content. Work assignment and execution are the next step.
      </div>
      <div className="agent-team-toolbar">
        <p className="ec-meta">Limen: {data ? ({ ready: "model catalogue available", "not-configured": "not configured", unavailable: "unavailable" }[data.gateway.status]) : "not checked"}</p>
        <div className="ec-actions">
          <button type="button" className="desk-btn" disabled={loading || saving} onClick={() => void load()}>Refresh</button>
          <button type="button" className="desk-btn desk-btn-primary" disabled={!data || saving} onClick={() => open()}>Create agent</button>
        </div>
      </div>
      {message && <p className="ec-notice" role="status">{message}</p>}
      {loadError && <p className="ec-error" role="alert">{loadError}</p>}
      {loading && <p role="status">Loading team configuration…</p>}
      {data && !data.agents.length && !loading && <p className="ec-empty">No agents configured yet. Create an agent to define its role, model and instructions.</p>}
      {!!data?.agents.length && <div className="agent-team-list" aria-label="Configured agents">
        {data.agents.map(agent => <article className="ec-row" key={agent.agent_key}>
          <div>
            <h2 className="agent-team-name">{agent.name}</h2>
            <p>{ROLES[agent.role]?.label ?? agent.role} — {ROLES[agent.role]?.description}</p>
            <p className="ec-meta">{agent.model} · version {agent.version}</p>
          </div>
          <div>
            <p><strong>{agent.enabled ? "Configuration enabled" : "Paused configuration"}</strong></p>
            <p className="ec-meta">No execution connected</p>
            <button type="button" className="desk-btn" disabled={saving} onClick={() => open(agent)}>Edit {agent.name}</button>
          </div>
        </article>)}
      </div>}
      {form && <form className="agent-team-form" onSubmit={save} aria-labelledby="agent-team-form-title">
        <h2 id="agent-team-form-title">{form.expected_version ? `Edit ${form.name || "agent"}` : "Create agent"}</h2>
        <p>{form.expected_version ? `Save a new version after version ${form.expected_version}. Earlier configurations remain recorded.` : "New agents start paused. Define the agent’s responsibility, model and instructions."}</p>
        <fieldset disabled={saving}>
          <legend className="agent-team-legend">Agent configuration</legend>
          <div className="agent-team-fields">
            <label htmlFor="team-agent-name">Name
              <input className="desk-input" id="team-agent-name" required maxLength={120} value={form.name} onChange={event => update({ name: event.target.value })} />
            </label>
            <label htmlFor="team-agent-role">Role
              <select className="desk-input" id="team-agent-role" value={form.role} onChange={event => update({ role: event.target.value as Role })}>
                {Object.entries(ROLES).map(([role, entry]) => <option value={role} key={role}>{entry.label}</option>)}
              </select>
              <span>{ROLES[form.role].description}</span>
            </label>
            <label htmlFor="team-agent-model">Model
              {gatewayReady && !!data?.models.length ? <select className="desk-input" id="team-agent-model" required value={form.model} onChange={event => update({ model: event.target.value })}>
                <option value="">Choose a model from Limen</option>
                {form.model && !modelAvailable && <option value={form.model}>{form.model} — unavailable</option>}
                {data.models.map(model => <option value={model.id} key={model.id}>{model.id}</option>)}
              </select> : <input className="desk-input" id="team-agent-model" required maxLength={200} value={form.model} onChange={event => update({ model: event.target.value })} aria-describedby="team-agent-model-help" />}
              <span className="ec-meta" id="team-agent-model-help">{!gatewayReady ? "Limen is not available. Enter a planned model alias and keep this configuration paused. Model access has not been verified." : !data?.models.length ? "No models are visible through this Limen key. You can save a planned model alias as a paused configuration." : form.model && !modelAvailable ? "This saved model is not currently available. Choose another model or pause the configuration before saving." : "Model availability does not authorize execution; Limen policy still applies."}</span>
            </label>
          </div>
          <label htmlFor="team-agent-instructions">Specific instructions
            <textarea className="desk-input agent-team-instructions" id="team-agent-instructions" required rows={10} maxLength={12000} value={form.instructions} onChange={event => update({ instructions: event.target.value })} aria-describedby="team-agent-instructions-help" />
            <span id="team-agent-instructions-help">Describe this agent’s responsibility and expected result. Instructions do not grant tools, change source rules or authorize publication.</span>
          </label>
          <label className="agent-team-enabled" htmlFor="team-agent-enabled">
            <input type="checkbox" id="team-agent-enabled" checked={form.enabled} disabled={!form.enabled && (!gatewayReady || !modelAvailable)} onChange={event => update({ enabled: event.target.checked })} />
            Enable this configuration for future work
          </label>
          <p className="ec-meta">Execution remains disconnected. An enabled configuration is not a running agent.</p>
          {saveError && <p className="ec-error" role="alert">{saveError}</p>}
          <div className="ec-actions">
            <button className="desk-btn desk-btn-primary" type="submit" disabled={!canSave || saving}>{saving ? "Saving…" : "Save configuration"}</button>
            <button className="desk-btn" type="button" onClick={() => { setForm(null); setSaveError(""); }}>Cancel</button>
            {saveError && <button className="desk-btn" type="button" onClick={() => void reloadSelected()}>Reload saved configuration</button>}
          </div>
        </fieldset>
      </form>}
    </section>
  );
}
