import { type HTMLAttributes, type ReactNode } from 'react';
import { CircleAlert, Dot, X } from 'lucide-react';

export function Surface({ children, className = '', ...props }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`glass rounded-[18px] border border-[hsl(var(--card-border))] ${className}`}>{children}</div>;
}

export function SectionTitle({ eyebrow, title, aside }: { eyebrow?: string; title: string; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="mono mb-2 text-[9px] font-medium uppercase tracking-[.2em] text-[hsl(var(--primary))]">{eyebrow}</p>}
        <h2 className="display text-[19px] font-semibold tracking-[-.035em] text-[hsl(var(--foreground))]">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

export function Modal({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(var(--foreground)/.32)] p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="dialog" aria-modal="true">
      <div className="glass animate-rise-in max-h-[92dvh] w-full max-w-[560px] overflow-auto rounded-t-[24px] border border-[hsl(var(--card-border))] p-5 shadow-[var(--shadow-md)] sm:rounded-[24px] sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="display text-[24px] font-semibold tracking-[-.045em]">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-[hsl(var(--muted-foreground))]">{description}</p>}
          </div>
          <button type="button" onClick={onClose} data-testid="button-close-modal" className="rounded-full p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" aria-label="Close dialog"><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3">{Array.from({ length: rows }).map((_, index) => <div key={index} className="skeleton h-[62px] rounded-[10px]" />)}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/.22)] px-6 py-14 text-center">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-[hsl(var(--primary)/.25)] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] shadow-[0_0_28px_hsl(var(--primary)/.12)]"><Dot size={28} strokeWidth={3} /></div>
      <h3 className="display text-[16px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-[300px] text-[13px] leading-5 text-[hsl(var(--muted-foreground))]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]">{label}</span>{children}{hint && <span className="mt-1.5 block text-[11px] text-[hsl(var(--muted-foreground))]">{hint}</span>}</label>;
}

export function inputClass() {
  return 'h-11 w-full rounded-[10px] border border-[hsl(var(--input))] bg-[hsl(var(--background)/.6)] px-3 text-[13px] text-[hsl(var(--foreground))] outline-none transition-[border,box-shadow] placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.15)]';
}

export function formatMoney(value: number | undefined) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value ?? 0);
}

export function formatDate(value: string | null | undefined, withYear = false) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(date);
}