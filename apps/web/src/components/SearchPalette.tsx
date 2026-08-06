import { useEffect, useState } from "react";
import type { TaskSearchResult } from "@taskforge/contracts";
import { ArrowRight, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { statusMeta } from "../lib/ui";
import { Avatar } from "./Avatar";

export function SearchPalette({ onClose, onOpen }: { onClose: () => void; onOpen: (task: TaskSearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.search(query).then(({ results: matches }) => setResults(matches)).catch(() => setResults([])).finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="search-palette" role="dialog" aria-label="Search all tasks">
        <header><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} placeholder="Search tasks across every project…" /><kbd>ESC</kbd><button onClick={onClose} aria-label="Close search"><X /></button></header>
        <div className="search-results">
          {!query.trim() && <div className="search-prompt"><Search /><strong>Find anything</strong><span>Search by task title, description, definition of done, or task key.</span></div>}
          {query.trim() && loading && <div className="search-loading">Searching…</div>}
          {query.trim() && !loading && !results.length && <div className="search-prompt"><strong>No matching tasks</strong><span>Try another title, keyword, or task key.</span></div>}
          {!loading && results.map((task) => (
            <button key={task.id} className="search-result" onClick={() => onOpen(task)}>
              <span className="search-project-glyph" style={{ background: task.projectColor }}>{task.projectKey.slice(0, 1)}</span>
              <span className="search-result-copy"><span><small>{task.projectKey}-{task.number} · {task.projectName}</small><span className={`status-pill tone-${statusMeta[task.status].tone}`}><i />{statusMeta[task.status].label}</span></span><strong>{task.title}</strong></span>
              {task.assignee && <Avatar user={task.assignee} size="sm" />}
              <ArrowRight className="search-result-arrow" />
            </button>
          ))}
        </div>
        <footer><span><kbd>⌘</kbd><kbd>K</kbd> to open</span><span><kbd>ESC</kbd> to close</span></footer>
      </section>
    </div>
  );
}
