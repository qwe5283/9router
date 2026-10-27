"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import ProviderIcon from "./ProviderIcon";

export default function ProviderAvatarPicker({ value = "", defaultIconId, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [icons, setIcons] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const trigger = useRef(null);
  const dialog = useRef(null);

  useEffect(() => {
    if (!open || icons) return;
    let cancelled = false;
    fetch("/api/provider-icons")
      .then(async (res) => {
        if (!res.ok) throw new Error("Unable to load provider avatars");
        return res.json();
      })
      .then((data) => { if (!cancelled) setIcons(data.icons || []); })
      .catch(() => { if (!cancelled) setError("Unable to load provider avatars"); });
    return () => { cancelled = true; };
  }, [open, icons, retry]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const triggerButton = trigger.current;
    const ownsScrollLock = previousOverflow !== "hidden";
    if (ownsScrollLock) document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      } else if (event.key === "Tab") {
        const controls = [...(dialog.current?.querySelectorAll("button:not(:disabled), input:not(:disabled)") || [])];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    (dialog.current?.querySelector('[aria-pressed="true"]') || dialog.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (ownsScrollLock) document.body.style.overflow = previousOverflow;
      triggerButton?.focus();
    };
  }, [open]);

  const choose = (iconId) => {
    onChange(iconId);
    setOpen(false);
  };
  const filtered = (icons || []).filter((icon) => `${icon.name} ${icon.id}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="flex flex-col items-center gap-2 pb-2">
        <button
          ref={trigger}
          type="button"
          aria-label="Choose provider avatar"
          disabled={disabled}
          onClick={() => { setSearch(""); setError(null); setOpen(true); }}
          className="relative flex size-20 items-center justify-center rounded-2xl border border-border bg-surface-2 transition-colors hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        >
          <ProviderIcon key={value || defaultIconId} providerId={value || defaultIconId} alt="Provider avatar preview" size={52} className="rounded-xl object-contain" />
          <span aria-hidden="true" className="material-symbols-outlined absolute -bottom-1 -right-1 rounded-full bg-primary p-1 text-[16px] text-white">edit</span>
        </button>
        <p className="text-xs text-text-muted">Click the avatar to choose a provider icon</p>
      </div>
      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div ref={dialog} role="dialog" aria-modal="true" aria-label="Choose provider avatar" tabIndex={-1} className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h2 className="text-lg font-semibold">Choose provider avatar</h2>
              <button type="button" aria-label="Close avatar picker" onClick={() => setOpen(false)} className="rounded-lg p-1 text-text-muted hover:bg-surface-2">
                <span aria-hidden="true" className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-4 pb-0">
              <input aria-label="Search provider avatars" placeholder="Search providers..." value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <div className="custom-scrollbar min-h-0 overflow-y-auto p-4">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="group" aria-label="Provider avatars">
                <button type="button" aria-label="Use default avatar" aria-pressed={!value} onClick={() => choose("")} className={`flex min-w-0 flex-col items-center gap-2 rounded-xl border p-3 text-xs ${!value ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2"}`}>
                  <ProviderIcon providerId={defaultIconId} alt="Default provider avatar" size={36} className="object-contain" />
                  <span>Default</span>
                </button>
                {filtered.map((icon) => (
                  <button key={icon.id} type="button" aria-label={`Use ${icon.name} avatar`} aria-pressed={value === icon.id} onClick={() => choose(icon.id)} className={`flex min-w-0 flex-col items-center gap-2 rounded-xl border p-3 text-xs ${value === icon.id ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2"}`}>
                    <ProviderIcon providerId={icon.id} alt={icon.name} size={36} className="object-contain" />
                    <span className="w-full truncate text-center" title={icon.name}>{icon.name}</span>
                  </button>
                ))}
              </div>
              {!icons && !error && <p className="py-6 text-center text-sm text-text-muted" role="status">Loading avatars...</p>}
              {icons && filtered.length === 0 && <p className="py-6 text-center text-sm text-text-muted">No matching provider avatars</p>}
              {error && <div className="py-4 text-center text-sm"><p role="alert">{error}</p><button type="button" onClick={() => { setError(null); setRetry((n) => n + 1); }} className="mt-2 text-primary">Retry</button></div>}
            </div>
            <div className="flex justify-end border-t border-border p-3">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2">Cancel</button>
            </div>
          </div>
        </div>, document.body
      )}
    </>
  );
}

ProviderAvatarPicker.propTypes = {
  value: PropTypes.string,
  defaultIconId: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};
