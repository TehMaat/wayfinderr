import { AudioLines, Captions } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import type { LanguageTracks } from '@/lib/media';

const tracks = (n: number) => `${n} track${n === 1 ? '' : 's'}`;

/** "ITA", plus "+N" for the tracks in the same language beyond the first */
function Count({ label, count }: { label: string; count: number }) {
  return (
    <>
      {label}
      {count > 1 && <span className="tabular opacity-70">+{count - 1}</span>}
    </>
  );
}

export function MediaBadges({ language, hint }: { language: LanguageTracks | null; hint?: string }) {
  if (!language || (!language.audio && !language.subs)) {
    return <span className="text-xs text-muted-foreground">–</span>;
  }
  const suffix = hint ? ` · ${hint}` : '';
  return (
    <div className="flex items-center gap-1">
      {language.audio > 0 && (
        <Tooltip content={`${language.name} audio · ${tracks(language.audio)}${suffix}`}>
          <Badge variant="success">
            <AudioLines />
            <Count label={language.label} count={language.audio} />
          </Badge>
        </Tooltip>
      )}
      {language.subs > 0 && (
        <Tooltip content={`${language.name} subtitles · ${tracks(language.subs)}${suffix}`}>
          <Badge variant="info">
            <Captions />
            <Count label={language.label} count={language.subs} />
          </Badge>
        </Tooltip>
      )}
    </div>
  );
}
