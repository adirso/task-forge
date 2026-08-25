import { useEffect, useMemo, useState } from "react";
import type { Project, Task } from "@taskforge/contracts";
import { Check, Clipboard, ExternalLink, ShieldCheck, Sparkles, X } from "lucide-react";
import { aiProviders, buildAIPrompt, buildTaskContextUrl, type AIProvider, type AIPromptMode } from "../lib/aiPrompt";

const modeMeta: Record<AIPromptMode, { label: string; description: string }> = {
  IMPLEMENT: { label: "Implement", description: "Give an agent a complete, provider-specific implementation brief." },
  REVIEW: { label: "Review", description: "Give an agent a complete, evidence-driven review brief." },
  FIX: { label: "Fix needed", description: "Give an agent the latest findings and a focused fix-and-test brief." },
  RE_REVIEW: { label: "Re-review", description: "Ask an agent to verify the fixes against the previous review and DoD." },
};

export function SendToAI({ project, task, phaseNumber, initialMode, onClose }: { project: Project; task: Task; phaseNumber: number | null; initialMode: AIPromptMode; onClose: () => void }) {
  const [provider, setProvider] = useState<AIProvider>("claude-code");
  const [mode, setMode] = useState<AIPromptMode>(initialMode);
  const [copied, setCopied] = useState<"prompt" | "link" | null>(null);
  const [error, setError] = useState("");
  const contextUrl = useMemo(() => buildTaskContextUrl(window.location.href, project, task), [project, task]);
  const apiBaseUrl = useMemo(() => new URL((import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, ""), window.location.origin).toString().replace(/\/$/, ""), []);
  const prompt = useMemo(() => buildAIPrompt({ provider, mode, project, task, phaseNumber, contextUrl, apiBaseUrl }), [provider, mode, project, task, phaseNumber, contextUrl, apiBaseUrl]);
  const selectedProvider = aiProviders.find((item) => item.id === provider)!;
  const selectedMode = modeMeta[mode];

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function copy(value: string, kind: "prompt" | "link") {
    setError("");
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    } catch { setError("Could not access the clipboard. Select and copy the prompt manually."); }
  }

  return (
    <div className="ai-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="send-to-ai-dialog" role="dialog" aria-modal="true" aria-labelledby="send-to-ai-title">
        <header><div><span className="ai-dialog-kicker"><Sparkles /> Agent handoff</span><h2 id="send-to-ai-title">{selectedMode.label} {project.key}-{task.number} with AI</h2><p>{selectedMode.description}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close AI handoff"><X /></button></header>
        <div className="ai-mode-tabs" role="tablist" aria-label="AI task mode">{(Object.keys(modeMeta) as AIPromptMode[]).map((candidate) => <button type="button" key={candidate} role="tab" aria-selected={mode === candidate} className={mode === candidate ? "selected" : ""} onClick={() => { setMode(candidate); setCopied(null); }}>{modeMeta[candidate].label}</button>)}</div>
        <div className="ai-provider-grid">{aiProviders.map((item) => <button type="button" key={item.id} className={provider === item.id ? "selected" : ""} aria-pressed={provider === item.id} onClick={() => { setProvider(item.id); setCopied(null); }}><span>{item.badge}</span><strong>{item.name}</strong><small>{item.description}</small>{provider === item.id && <Check />}</button>)}</div>
        <div className="ai-handoff-note"><ExternalLink /><span><strong>{selectedProvider.name} handoff</strong><small>{selectedProvider.handoff}</small></span></div>
        <label className="ai-prompt-preview">Generated prompt<textarea readOnly value={prompt} rows={15} onFocus={(event) => event.currentTarget.select()} /></label>
        <div className="ai-security-note"><ShieldCheck /><span>No TaskForge token or JWT is included. The agent is instructed to use its own configured credential and redact secrets.</span></div>
        {error && <div className="form-error">{error}</div>}
        <footer><button type="button" className="button button-secondary" onClick={() => copy(contextUrl, "link")}><ExternalLink /> {copied === "link" ? "Link copied" : "Copy task link"}</button><div><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="button" className="button button-primary ai-copy-button" onClick={() => copy(prompt, "prompt")}>{copied === "prompt" ? <Check /> : <Clipboard />}{copied === "prompt" ? "Prompt copied" : `Copy ${selectedMode.label.toLowerCase()} prompt`}</button></div></footer>
      </section>
    </div>
  );
}
