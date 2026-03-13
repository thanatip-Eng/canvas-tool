interface StatCardProps {
  icon: string;
  label: string;
  value: string | number;
  color?: string;
}

export default function StatCard({ icon, label, value, color }: StatCardProps) {
  return (
    <div className="glass-card flex items-center gap-4 p-4">
      <div className="text-2xl">{icon}</div>
      <div>
        <p className="text-sm text-[var(--color-text-muted)]">{label}</p>
        <p className={`text-xl font-bold ${color || 'text-[var(--color-text-primary)]'}`}>
          {value}
        </p>
      </div>
    </div>
  );
}
