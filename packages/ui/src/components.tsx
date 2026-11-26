import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/** Thẻ nền trắng mờ, bo góc lớn: khối cơ bản của mọi màn hình. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border border-white/90 bg-white/85 shadow-card', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold', className)} {...props} />;
}

type ButtonVariant = 'primary' | 'outline' | 'ghost';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  outline: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-white/70',
};

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50',
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export type Tone = 'brand' | 'mint' | 'lav' | 'peach' | 'sky' | 'rose' | 'slate';
const toneClasses: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  mint: 'bg-mint-100 text-mint-700',
  lav: 'bg-lav-100 text-lav-700',
  peach: 'bg-peach-100 text-peach-700',
  sky: 'bg-sky-100 text-sky-700',
  rose: 'bg-rose-100 text-rose-700',
  slate: 'bg-slate-100 text-slate-600',
};

/** Nhãn trạng thái bo tròn theo tông pastel. */
export function Badge({ tone = 'slate', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', toneClasses[tone], className)}>
      {children}
    </span>
  );
}

/** Ô vuông/tròn chứa icon theo tông pastel. */
export function IconTile({ tone = 'brand', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', toneClasses[tone], className)}>
      {children}
    </span>
  );
}
