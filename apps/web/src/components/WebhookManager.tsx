import { useEffect, useState, type FormEvent } from "react";
import type { User, WebhookDelivery } from "@taskforge/contracts";
import { Check, Copy, RefreshCw, RotateCcw, Save, ShieldCheck, Webhook } from "lucide-react";
import { api } from "../lib/api";

export function WebhookManager({ agent, onAgentUpdated, onSuccess, onError }: {
  agent: User;
  onAgentUpdated: (agent: User) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [webhookUrl, setWebhookUrl] = useState(agent.webhookUrl ?? "");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState("");

  useEffect(() => {
    setWebhookUrl(agent.webhookUrl ?? "");
    setWebhookSecret("");
    void loadDeliveries();
  }, [agent.id]);

  async function loadDeliveries() {
    setLoading(true);
    try { setDeliveries((await api.webhookDeliveries({ agentId: agent.id, limit: 50 })).deliveries); }
    catch (error) { onError(error instanceof Error ? error.message : "Could not load webhook deliveries"); }
    finally { setLoading(false); }
  }

  async function saveWebhook(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const result = await api.updateAgentWebhook(agent.id, webhookUrl.trim() || null);
      onAgentUpdated(result.user);
      if (result.webhookSecret) setWebhookSecret(result.webhookSecret);
      onSuccess(result.webhookSecret ? "Webhook saved — copy the new signing secret" : "Webhook URL saved");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not save webhook URL"); }
    finally { setSaving(false); }
  }

  async function rotateSecret() {
    if (!window.confirm("Rotate this webhook signing secret? The receiver must be updated before its next delivery.")) return;
    setRotating(true);
    try {
      const result = await api.rotateAgentWebhookSecret(agent.id);
      onAgentUpdated(result.user); setWebhookSecret(result.webhookSecret); onSuccess("Signing secret rotated — copy it now");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not rotate webhook signing secret"); }
    finally { setRotating(false); }
  }

  async function copySecret() {
    await navigator.clipboard.writeText(webhookSecret); setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }

  async function retryDelivery(delivery: WebhookDelivery) {
    setRetryingId(delivery.id);
    try {
      const retried = (await api.retryWebhookDelivery(delivery.id)).delivery;
      setDeliveries((items) => items.map((item) => item.id === retried.id ? retried : item));
      onSuccess("Webhook delivery queued for retry");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not retry webhook delivery"); }
    finally { setRetryingId(""); }
  }

  return <div className="webhook-manager">
    <form className="webhook-form" onSubmit={saveWebhook}>
      <label className="webhook-label"><Webhook /><span>Dispatch webhook URL</span></label>
      <div className="webhook-row"><input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://your-agent.example.com/webhook" /><button className="button button-secondary" disabled={saving}><Save /> {saving ? "Saving…" : "Save"}</button></div>
      <small className="webhook-hint">Events are queued durably, signed with HMAC-SHA256, and retried after timeouts, network errors, or non-2xx responses.</small>
      <div className="webhook-secret-status"><ShieldCheck /><span><strong>{agent.webhookSecretConfigured ? "Signing secret configured" : "Signing secret not configured"}</strong><small>Secrets are shown only when first created or rotated.</small></span><button type="button" className="button button-secondary" disabled={rotating} onClick={() => void rotateSecret()}><RotateCcw /> {rotating ? "Rotating…" : "Rotate secret"}</button></div>
    </form>
    {webhookSecret && <div className="issued-token webhook-secret"><strong>Copy this signing secret now</strong><p>Update the receiver before another delivery. TaskForge will not show this value again.</p><div><code>{webhookSecret}</code><button type="button" onClick={() => void copySecret()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button></div></div>}
    <section className="webhook-deliveries">
      <header><span><strong>Recent deliveries</strong><small>Stable event IDs let receivers safely deduplicate retries.</small></span><button type="button" className="icon-button" title="Refresh deliveries" disabled={loading} onClick={() => void loadDeliveries()}><RefreshCw /></button></header>
      {deliveries.length ? deliveries.map((delivery) => <article key={delivery.id}>
        <span className={`webhook-delivery-status status-${delivery.status.toLowerCase()}`}>{delivery.status}</span>
        <span><strong>{delivery.eventType}</strong><small>{delivery.projectKey && delivery.taskNumber ? `${delivery.projectKey}-${delivery.taskNumber} · ` : ""}{delivery.id} · {delivery.attemptCount} attempt{delivery.attemptCount === 1 ? "" : "s"}</small>{delivery.lastError && <small className="webhook-delivery-error">{delivery.lastError}{delivery.httpStatus ? ` (${delivery.httpStatus})` : ""}</small>}</span>
        {delivery.status === "FAILED" && <button type="button" className="button button-secondary" disabled={retryingId === delivery.id} onClick={() => void retryDelivery(delivery)}><RotateCcw /> {retryingId === delivery.id ? "Queueing…" : "Retry"}</button>}
      </article>) : <p className="no-tokens">{loading ? "Loading deliveries…" : "No webhook deliveries for this agent yet."}</p>}
    </section>
  </div>;
}
