import { type HTMLAttributes, type ReactNode } from 'react';
import { CircleAlert, Dot, X } from 'lucide-react';

export function Surface({ children, className = '', ...props }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`glass ${className}`}>{children}</div>;
}

export function SectionTitle({ eyebrow, title, aside }: { eyebrow?: string; title: string; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="label mb-2 inline-block bg-[hsl(var(--foreground))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--background))]">{eyebrow}</p>}
        <h2 className="display text-[22px] text-[hsl(var(--foreground))]">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

export function Modal({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(var(--foreground)/.62)] p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true">
      <div className="glass animate-rise-in max-h-[92dvh] w-full max-w-[560px] overflow-auto p-5 shadow-[var(--shadow-md)] sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-[26px]">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-[hsl(var(--muted-foreground))]">{description}</p>}
          </div>
          <button type="button" onClick={onClose} data-testid="button-close-modal" className="border-2 border-[hsl(var(--line))] p-1.5 text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--ink))]" aria-label="Close dialog"><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3">{Array.from({ length: rows }).map((_, index) => <div key={index} className="skeleton h-[62px]" />)}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center border-2 border-dashed border-[hsl(var(--line))] bg-[hsl(var(--card)/.55)] px-6 py-14 text-center">
      <div className="mb-5 flex h-12 w-12 items-center justify-center border-2 border-[hsl(var(--line))] bg-[hsl(var(--accent))] text-[hsl(var(--ink))] shadow-[3px_3px_0_hsl(var(--line))]"><Dot size={28} strokeWidth={3} /></div>
      <h3 className="display text-[18px]">{title}</h3>
      <p className="mt-1 max-w-[300px] text-[13px] leading-5 text-[hsl(var(--muted-foreground))]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="label mb-2 block text-[10px] text-[hsl(var(--foreground))]">{label}</span>{children}{hint && <span className="mt-1.5 block text-[11px] text-[hsl(var(--muted-foreground))]">{hint}</span>}</label>;
}

export function inputClass() {
  return 'h-11 w-full border-2 border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-[14px] text-[hsl(var(--foreground))] outline-none transition-shadow placeholder:text-[hsl(var(--muted-foreground))] focus:shadow-[4px_4px_0_hsl(var(--accent))]';
}

export function formatMoney(value: number | undefined) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value ?? 0);
}

export function formatDate(value: string | null | undefined, withYear = false) {
  if (!value) return '—';
  // Calendar-only values (move-in date, payment date) represent a specific
  // day, not an instant. They arrive either as a bare "YYYY-MM-DD" string,
  // or - once coerced through the API's response schema (zod.coerce.date())
  // - as a full ISO timestamp pinned to UTC midnight ("...T00:00:00.000Z").
  // Formatting either in the viewer's local timezone (Intl.DateTimeFormat's
  // default) shifts the displayed day back for anyone in a timezone behind
  // UTC. Format these using UTC components instead, so the day shown always
  // matches the day that was actually entered/stored, regardless of viewer
  // timezone. A genuine event timestamp (e.g. the activity feed's
  // createdAt) is vanishingly unlikely to land on exact UTC midnight, so
  // this pattern reliably tells the two apart and leaves real instants
  // formatted in local time as before.
  const isCalendarDate = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(value);
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    ...(isCalendarDate ? { timeZone: 'UTC' } : {}),
  }).format(date);
}

// A cycleMonth is always the 1st of its month (see formatDate above for why
// UTC components, not local ones), so this only ever needs month + year.
export function formatCycleMonth(value: string) {
  return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}