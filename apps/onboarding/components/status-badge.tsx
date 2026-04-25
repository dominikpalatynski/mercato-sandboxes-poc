// Shared status pill used in both the dashboard and the sandbox detail page.
// Colors are tuned for a dark UI (semi-transparent fills + low-contrast borders).

interface Props {
  status: string;
  className?: string;
}

function classFor(status: string): string {
  switch (status) {
    case 'building':
    case 'pending':
      return 'bg-amber-900/40 text-amber-200 border border-amber-700/40';
    case 'ready':
      return 'bg-emerald-900/40 text-emerald-200 border border-emerald-700/40';
    case 'failed':
      return 'bg-red-900/40 text-red-200 border border-red-700/40';
    case 'stopped':
      return 'bg-slate-800 text-slate-300 border border-slate-700';
    default:
      return 'bg-slate-800 text-slate-300 border border-slate-700';
  }
}

export default function StatusBadge({ status, className = '' }: Props): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${classFor(status)} ${className}`}
    >
      {status}
    </span>
  );
}
