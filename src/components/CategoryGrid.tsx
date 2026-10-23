import type { Option } from '../lib/catalog';

// A grid of large, labelled buttons. Plain <button> elements, so Tab, Enter, and
// Space work without extra code; the group is labelled for screen readers and
// the grid collapses to one or two columns on a phone (see .category-grid).
export function CategoryGrid({
  options,
  label,
  tone = 'calm',
  disabled,
  onSelect,
}: {
  options: Option[];
  label: string;
  tone?: 'calm' | 'warn' | 'danger';
  disabled?: boolean;
  onSelect: (option: Option) => void;
}) {
  return (
    <div className="category-grid" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} className={`category-button tone-${tone}`} disabled={disabled} onClick={() => onSelect(o)}>
          <span className="category-icon" aria-hidden="true">{o.icon}</span>
          <span className="category-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
