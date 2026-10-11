'use client';

import { useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ACCENTS, DEFAULT_ACCENT, currentAccent, setAccent, type Accent } from '@/lib/accents';

export function AccentPicker() {
  const [accent, setCurrent] = useState<Accent>(DEFAULT_ACCENT);

  // Read on opening: the layout's script sets it, and the other sidebar (desktop or
  // mobile) may have changed it
  return (
    <DropdownMenu onOpenChange={(open) => open && setCurrent(currentAccent())}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Accent color">
          <Palette />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
        {ACCENTS.map(({ id, label, swatch }) => (
          <DropdownMenuItem key={id} onSelect={() => setAccent(id)}>
            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: swatch }} />
            <span className="flex-1">{label}</span>
            {accent === id && <Check />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
