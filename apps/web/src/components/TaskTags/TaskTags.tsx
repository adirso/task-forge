import { useId, useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import type { TaskTagEditorProps, TaskTagPillsProps } from "./types";
import styles from "./TaskTags.module.css";

export function TaskTagPills({ tags, limit }: TaskTagPillsProps) {
  const visible = limit ? tags.slice(0, limit) : tags;
  if (!tags.length) return null;
  return (
    <span className={styles.list}>
      {visible.map((tag) => <span className={styles.tag} key={tag.id}>{tag.name}</span>)}
      {limit && tags.length > limit && <span className={styles.more}>+{tags.length - limit}</span>}
    </span>
  );
}

export function TaskTagEditor({ value, availableTags, onChange }: TaskTagEditorProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const suggestionsId = useId();

  function addTags() {
    const additions = draft.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
    if (!additions.length) return;
    if (additions.some((tag) => !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(tag) || tag.length > 32)) {
      setError("Use up to 32 letters, numbers, hyphens, or underscores.");
      return;
    }
    const next = [...new Set([...value, ...additions])];
    if (next.length > 20) { setError("A task can have up to 20 tags."); return; }
    onChange(next); setDraft(""); setError("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTags(); }
  }

  return (
    <div className={styles.editor}>
      {value.length > 0 && (
        <div className={styles.selected}>
          {value.map((tag) => (
            <span className={styles.tag} key={tag}>
              {tag}
              <button type="button" aria-label={`Remove ${tag} tag`} onClick={() => onChange(value.filter((item) => item !== tag))}><X /></button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.inputRow}>
        <input list={suggestionsId} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder="frontend, backend…" maxLength={65} />
        <button type="button" aria-label="Add tag" disabled={!draft.trim()} onClick={addTags}><Plus /></button>
      </div>
      <datalist id={suggestionsId}>{availableTags.filter((tag) => !value.includes(tag.name)).map((tag) => <option value={tag.name} key={tag.id} />)}</datalist>
      <small className={error ? `${styles.help} ${styles.error}` : styles.help}>{error || "Press Enter or comma to add a reusable tag."}</small>
    </div>
  );
}
