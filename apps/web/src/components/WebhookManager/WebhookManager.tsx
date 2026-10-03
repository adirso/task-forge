import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, RotateCcw, Save, ShieldCheck, Webhook } from "lucide-react";
import { api } from "../../lib/api";
import type { WebhookManagerProps } from "./types";
import styles from "./WebhookManager.module.css";

export function WebhookManager({ agent, onAgentUpdated, onSuccess, onError }: WebhookManagerProps) {
  const [webhookUrl, setWebhookUrl] = useState(agent.webhookUrl ?? "");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    setWebhookUrl(agent.webhookUrl ?? "");
    setWebhookSecret("");
  }, [agent.id]);

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

  return (
    <div className={styles.root}>
      <form className={styles.form} onSubmit={saveWebhook} aria-label="Dispatch webhook">
        <label className={styles.label} htmlFor={`webhook-url-${agent.id}`}><Webhook /><span>Dispatch webhook URL</span></label>
        <div className={styles.row}>
          <input id={`webhook-url-${agent.id}`} type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://your-agent.example.com/webhook" />
          <button className="button button-secondary" disabled={saving}><Save /> {saving ? "Saving…" : "Save"}</button>
        </div>
        <small className={styles.hint}>Events are queued durably, signed with HMAC-SHA256, and retried after timeouts, network errors, or non-2xx responses.</small>
        <div className={styles.secretStatus}>
          <ShieldCheck />
          <span>
            <strong>{agent.webhookSecretConfigured ? "Signing secret configured" : "Signing secret not configured"}</strong>
            <small>Secrets are shown only when first created or rotated.</small>
          </span>
          <button type="button" className="button button-secondary" disabled={rotating} onClick={() => void rotateSecret()}>
            <RotateCcw /> {rotating ? "Rotating…" : "Rotate secret"}
          </button>
        </div>
      </form>
      {webhookSecret && (
        <div className={`issued-token ${styles.secret}`}>
          <strong>Copy this signing secret now</strong>
          <p>Update the receiver before another delivery. TaskForge will not show this value again.</p>
          <div>
            <code>{webhookSecret}</code>
            <button type="button" onClick={() => void copySecret()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
