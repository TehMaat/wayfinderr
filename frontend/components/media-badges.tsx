import { AudioLines, Captions } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';

export function MediaBadges({ audio, subs }: { audio: boolean; subs: boolean }) {
  if (!audio && !subs) {
    return <span className="text-xs text-muted-foreground">–</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {audio && (
        <Tooltip content="Italian audio">
          <Badge variant="success">
            <AudioLines />
            ITA
          </Badge>
        </Tooltip>
      )}
      {subs && (
        <Tooltip content="Italian subtitles">
          <Badge variant="info">
            <Captions />
            ITA
          </Badge>
        </Tooltip>
      )}
    </div>
  );
}
