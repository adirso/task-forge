import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { MultiFilterDropdownProps } from "./types";
import styles from "./MultiFilterDropdown.module.css";

export function MultiFilterDropdown({
  label,
  allLabel,
  options,
  value,
  onChange,
  icon,
}: MultiFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = options.filter((option) => value.includes(option.value));
  const summary = !selected.length
    ? allLabel
    : selected.length === 1
      ? selected[0]!.label
      : `${selected[0]!.label} +${selected.length - 1}`;

  function toggle(optionValue: string) {
    onChange(value.includes(optionValue) ? value.filter((item) => item !== optionValue) : [...value, optionValue]);
  }

  return (
    <div className={`multi-filter ${styles.root}${open ? " open" : ""}${value.length ? " has-value" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="multi-filter-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        <span>{summary}</span>
        {value.length > 0 && <b>{value.length}</b>}
        <ChevronDown />
      </button>
      {open && (
        <div className="multi-filter-menu" id={listId} role="listbox" aria-label={label} aria-multiselectable="true">
          <div className="multi-filter-menu-head">
            <strong>{label}</strong>
            {value.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}
          </div>
          <div className="multi-filter-options">
            {options.length ? options.map((option) => {
              const checked = value.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={checked ? "selected" : undefined}
                  onClick={() => toggle(option.value)}
                >
                  <span className={`multi-filter-check${checked ? " on" : ""}`} aria-hidden>{checked ? <Check strokeWidth={3} absoluteStrokeWidth /> : null}</span>
                  <span>{option.label}</span>
                </button>
              );
            }) : <p className="multi-filter-empty">No options</p>}
          </div>
        </div>
      )}
    </div>
  );
}
