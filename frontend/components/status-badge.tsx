import {
  CheckCircle2,
  CircleDashed,
  CircleStop,
  Clock,
  Loader2,
  SkipForward,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { UploadStatus } from '@/lib/store';
import { cn } from '@/lib/utils';

export const STATUS_META: Record<
  UploadStatus,
  { label: string; icon: LucideIcon; variant: NonNullable<BadgeProps['variant']>; color: string }
> = {
  UPLOADING: { label: 'Uploading', icon: Loader2, variant: 'default', color: 'text-primary' },
  QUEUED: { label: 'Queued', icon: Clock, variant: 'info', color: 'text-info' },
  PENDING: { label: 'Analyzing', icon: CircleDashed, variant: 'secondary', color: 'text-muted-foreground' },
  COMPLETED: { label: 'Completed', icon: CheckCircle2, variant: 'success', color: 'text-success' },
  FAILED: { label: 'Failed', icon: XCircle, variant: 'destructive', color: 'text-destructive' },
  CANCELLED: { label: 'Stopped', icon: CircleStop, variant: 'secondary', color: 'text-muted-foreground' },
  SKIPPED: { label: 'Skipped', icon: SkipForward, variant: 'warning', color: 'text-warning' },
};

export function StatusBadge({ status, className }: { status: UploadStatus; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.PENDING;
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className={className}>
      <Icon className={cn(status === 'UPLOADING' && 'animate-spin')} />
      {meta.label}
    </Badge>
  );
}
