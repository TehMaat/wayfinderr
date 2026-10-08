import {
  CheckCircle2,
  CircleDashed,
  Clock,
  Hourglass,
  Loader2,
  ScanSearch,
  SkipForward,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { RipStatus, UploadStatus } from '@/lib/store';
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

export const RIP_STATUS_META: Record<
  RipStatus,
  { label: string; icon: LucideIcon; variant: NonNullable<BadgeProps['variant']>; color: string }
> = {
  WAITING: { label: 'Downloading', icon: Hourglass, variant: 'secondary', color: 'text-muted-foreground' },
  QUEUED: { label: 'Queued', icon: Clock, variant: 'info', color: 'text-info' },
  SCANNING: { label: 'Scanning', icon: ScanSearch, variant: 'default', color: 'text-primary' },
  RIPPING: { label: 'Ripping', icon: Loader2, variant: 'default', color: 'text-primary' },
  DONE: { label: 'Done', icon: CheckCircle2, variant: 'success', color: 'text-success' },
  NEEDS_ATTENTION: { label: 'Needs attention', icon: TriangleAlert, variant: 'warning', color: 'text-warning' },
  FAILED: { label: 'Failed', icon: XCircle, variant: 'destructive', color: 'text-destructive' },
  SKIPPED: { label: 'Skipped', icon: SkipForward, variant: 'secondary', color: 'text-muted-foreground' },
};

export function RipStatusBadge({ status, className }: { status: RipStatus; className?: string }) {
  const meta = RIP_STATUS_META[status] ?? RIP_STATUS_META.QUEUED;
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className={className}>
      <Icon className={cn(status === 'RIPPING' && 'animate-spin', status === 'SCANNING' && 'animate-pulse')} />
      {meta.label}
    </Badge>
  );
}
