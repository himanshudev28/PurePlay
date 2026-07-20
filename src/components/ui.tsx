import clsx from 'clsx'
import { useState, useEffect, type ReactNode } from 'react'
import { Music } from 'lucide-react'

export function Artwork({
  src,
  alt,
  className,
  rounded = 'rounded-xl',
}: {
  src?: string
  alt: string
  className?: string
  rounded?: string
}) {
  const [broken, setBroken] = useState(false)

  // a recycled card can get a new src — clear the previous failure
  useEffect(() => setBroken(false), [src])

  return (
    <div className={clsx('relative shrink-0 overflow-hidden bg-ink-800', rounded, className)}>
      {src && !broken ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-600">
          <Music size={20} />
        </div>
      )}
    </div>
  )
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-ink-800', className)} />
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-ink-800 bg-ink-900/50 px-6 py-16 text-center">
      {icon && <div className="text-ink-600">{icon}</div>}
      <p className="font-medium text-ink-200">{title}</p>
      {hint && <p className="max-w-sm text-sm text-ink-400">{hint}</p>}
      {action}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'solid',
  size = 'md',
  className,
  disabled,
  type = 'button',
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'solid' | 'ghost' | 'outline' | 'accent'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
}) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        variant === 'solid' && 'bg-white text-ink-950 hover:bg-ink-200',
        variant === 'accent' && 'bg-accent text-white hover:bg-accent-soft',
        variant === 'outline' && 'border border-ink-700 text-ink-200 hover:border-ink-600 hover:text-white',
        variant === 'ghost' && 'text-ink-300 hover:bg-ink-800 hover:text-white',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-accent-dim bg-accent-dim/30 px-4 py-3 text-sm">
      <span className="text-accent-soft">{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
