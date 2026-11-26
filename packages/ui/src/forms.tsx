'use client';

import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from './cn';

const fieldBase =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'pr-8', className)} {...props}>
      {children}
    </select>
  );
}

/** Ô nhập có nhãn, gợi ý và thông báo lỗi. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-rose-700">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-sm', props.disabled && 'cursor-not-allowed opacity-50', className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Thông báo lỗi / thành công dạng khối. */
export function Alert({ tone = 'rose', children, className }: { tone?: 'rose' | 'mint' | 'peach' | 'sky'; children: ReactNode; className?: string }) {
  const tones = {
    rose: 'bg-rose-100 text-rose-700',
    mint: 'bg-mint-100 text-mint-700',
    peach: 'bg-peach-100 text-peach-700',
    sky: 'bg-sky-100 text-sky-700',
  };
  return (
    <div role={tone === 'rose' ? 'alert' : 'status'} className={cn('rounded-xl px-3.5 py-2.5 text-sm', tones[tone], className)}>
      {children}
    </div>
  );
}

/** Hộp thoại dùng thẻ <dialog> gốc: có sẵn bẫy focus, phím Esc, nền mờ. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Đóng do code (open=false) thì không gọi onClose, tránh đóng nhầm hộp thoại khác vừa mở
  const programmatic = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) {
      programmatic.current = true;
      d.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={() => {
        if (programmatic.current) {
          programmatic.current = false;
          return;
        }
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-card border-0 bg-white p-0 shadow-card backdrop:bg-slate-900/30',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Đóng">
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/90 bg-white/85 p-1.5 shadow-card">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn('rounded-xl px-3.5 py-2 text-sm', t.value === value ? 'bg-brand-100 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-50')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} aria-hidden />;
}
