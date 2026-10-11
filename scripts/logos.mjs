#!/usr/bin/env node

// Wayfinderr - Logo variants
//
// Writes the logo in every accent color from one drawing:
//   docs/assets/logo-<accent>.svg   full logo (README, docs)
//   docs/assets/logo.svg            the violet one, the default
//   frontend/public/icons/<accent>.svg   browser tab icon, thicker lines for 16 px
// Run it after changing the drawing or a palette: node scripts/logos.mjs
// The PNG copies in docs/assets are these SVGs exported at 512 px.
// The accents must match frontend/lib/accents.ts and the [data-accent] rules in
// frontend/app/globals.css.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Tailwind shades: 100 edges, 200 inner lines, 300/600 left face, 400 core, 500 tab icon face,
// 700/950 right face, 900 tab icon right face; bg is the tile, top and bottom
const ACCENTS = {
  violet: { bg: ['#1c1631', '#0b0912'], 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 900: '#4c1d95', 950: '#2e1065' },
  red: { bg: ['#2a1215', '#0f0809'], 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 900: '#7f1d1d', 950: '#450a0a' },
  blue: { bg: ['#121a2e', '#080b12'], 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 900: '#1e3a8a', 950: '#172554' },
  green: { bg: ['#10201a', '#070d0a'], 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 900: '#14532d', 950: '#052e16' },
  amber: { bg: ['#261c0e', '#0e0a06'], 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 900: '#78350f', 950: '#451a03' },
};

// The pyramid, in the 128 x 128 tile: apex, left, front and right corners
const PYRAMID = 'M50 4 L6 76 L46 98 L94 76 Z M50 4 L46 98';
const LEFT_FACE = 'M50 4 L6 76 L46 98 Z';
const RIGHT_FACE = 'M50 4 L46 98 L94 76 Z';

const tile = (c) => `  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.bg[0]}"/>
      <stop offset="1" stop-color="${c.bg[1]}"/>
    </linearGradient>`;

const logo = (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Wayfinderr">
  <title>Wayfinderr</title>
${tile(c)}
    <linearGradient id="left" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c[300]}" stop-opacity=".55"/>
      <stop offset="1" stop-color="${c[600]}" stop-opacity=".35"/>
    </linearGradient>
    <linearGradient id="right" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c[700]}" stop-opacity=".55"/>
      <stop offset="1" stop-color="${c[950]}" stop-opacity=".7"/>
    </linearGradient>
    <radialGradient id="core">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset=".25" stop-color="${c[100]}"/>
      <stop offset=".55" stop-color="${c[400]}" stop-opacity=".55"/>
      <stop offset="1" stop-color="${c[600]}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <g transform="translate(14 13)">
    <!-- back edge, seen through the glass -->
    <path d="M6 76 L94 76" stroke="${c[400]}" stroke-opacity=".35" stroke-width="2" stroke-dasharray="3 4"/>
    <!-- glass faces -->
    <path d="${LEFT_FACE}" fill="url(#left)"/>
    <path d="${RIGHT_FACE}" fill="url(#right)"/>
    <!-- inner star lines -->
    <path d="M48 62 L50 4 M48 62 L6 76 M48 62 L94 76 M48 62 L46 98" stroke="${c[200]}" stroke-opacity=".35" stroke-width="1"/>
    <!-- core -->
    <circle cx="48" cy="62" r="20" fill="url(#core)"/>
    <circle cx="48" cy="62" r="3.5" fill="#fff"/>
    <!-- frame -->
    <path d="${PYRAMID}" fill="none" stroke="${c[100]}" stroke-width="3" stroke-linejoin="round"/>
    <!-- vertex nodes -->
    <g fill="${c[100]}">
      <circle cx="50" cy="4" r="4"/>
      <circle cx="6" cy="76" r="4"/>
      <circle cx="94" cy="76" r="4"/>
      <circle cx="46" cy="98" r="4"/>
    </g>
  </g>
</svg>
`;

const icon = (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
${tile(c)}
    <radialGradient id="core">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset=".3" stop-color="${c[100]}"/>
      <stop offset=".6" stop-color="${c[400]}" stop-opacity=".6"/>
      <stop offset="1" stop-color="${c[600]}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <g transform="translate(14 13)">
    <path d="${LEFT_FACE}" fill="${c[500]}" fill-opacity=".5"/>
    <path d="${RIGHT_FACE}" fill="${c[900]}" fill-opacity=".85"/>
    <circle cx="48" cy="62" r="24" fill="url(#core)"/>
    <path d="${PYRAMID}" fill="none" stroke="${c[100]}" stroke-width="7" stroke-linejoin="round"/>
  </g>
</svg>
`;

const write = (path, content) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  console.log(path);
};

for (const [name, colors] of Object.entries(ACCENTS)) {
  write(`docs/assets/logo-${name}.svg`, logo(colors));
  write(`frontend/public/icons/${name}.svg`, icon(colors));
}
write('docs/assets/logo.svg', logo(ACCENTS.violet));
