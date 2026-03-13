'use client';

interface FilterOption {
  key: string;
  label: string;
  count?: number;
}

interface FilterTabsProps {
  filters: FilterOption[];
  activeFilter: string;
  onChange: (key: string) => void;
}

export default function FilterTabs({ filters, activeFilter, onChange }: FilterTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((f) => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={`rounded-lg px-3 py-1.5 text-sm transition ${
            activeFilter === f.key
              ? 'bg-[var(--color-accent)] text-[var(--color-bg-primary)] font-semibold'
              : 'bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10'
          }`}
        >
          {f.label}
          {f.count !== undefined && (
            <span className={`ml-1.5 ${activeFilter === f.key ? 'opacity-75' : 'opacity-50'}`}>
              ({f.count})
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
