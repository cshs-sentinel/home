import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { TAB_LABELS, type Tab } from '../roles';

type Props = {
  items: Tab[];
  active: Tab;
  badges: Partial<Record<Tab, number>>;
  onSelect: (tab: Tab) => void;
};

export function MoreMenu({ items, active, badges, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const inMore = items.includes(active);
  const urgent = items.reduce((sum, t) => sum + (badges[t] ?? 0), 0);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  function onMenuKey(e: KeyboardEvent) {
    const index = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      itemRefs.current[next]?.focus();
    }
  }

  return (
    <div className="more-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`tab-button more-button${inMore ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
        <span>{inMore ? `More · ${TAB_LABELS[active].label}` : 'More'}</span>
        {urgent > 0 && (
          <span className="badge" aria-label={`${urgent} urgent`}>
            {urgent}
          </span>
        )}
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label="More menus" onKeyDown={onMenuKey}>
          {items.map((t, i) => (
            <button
              type="button"
              role="menuitem"
              key={t}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className={`more-item${active === t ? ' is-active' : ''}`}
              onClick={() => {
                onSelect(t);
                setOpen(false);
              }}
            >
              <span aria-hidden="true">{TAB_LABELS[t].icon}</span>
              <span className="more-label">{TAB_LABELS[t].label}</span>
              {(badges[t] ?? 0) > 0 && <span className="badge">{badges[t]}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
