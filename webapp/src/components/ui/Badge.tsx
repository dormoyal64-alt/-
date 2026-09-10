import clsx from "clsx";

export function Badge({
  color,
  children,
  className,
}: {
  color?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (color) {
    return (
      <span
        className={clsx("badge", className)}
        style={{ backgroundColor: `${color}1a`, color }}
      >
        {children}
      </span>
    );
  }
  return <span className={clsx("badge bg-ink-100 text-ink-700", className)}>{children}</span>;
}

export function StatusBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className="badge" style={{ backgroundColor: `${color}1a`, color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}
