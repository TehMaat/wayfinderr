import { cn } from '@/lib/utils';

// The Wayfinderr mark: a glass pyramid with a glowing core. Takes the color of the
// text (text-primary by default), so it follows the theme
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 102" fill="none" aria-hidden className={cn('text-primary', className)}>
      <path d="M50 4 L6 76 L46 98 Z" fill="currentColor" fillOpacity={0.35} />
      <path d="M50 4 L46 98 L94 76 Z" fill="currentColor" fillOpacity={0.15} />
      <circle cx="48" cy="62" r="20" fill="currentColor" fillOpacity={0.25} />
      <circle cx="48" cy="62" r="12" fill="currentColor" fillOpacity={0.45} />
      <path
        d="M50 4 L6 76 L46 98 L94 76 Z M50 4 L46 98"
        stroke="currentColor"
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <circle cx="48" cy="62" r="6.5" fill="white" />
    </svg>
  );
}
