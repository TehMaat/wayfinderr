/**
 * The screenshots of the documentation: docs/assets/screenshots/<name>.png.
 *
 * path: the page (or a function of the API that returns it); prepare: what to click
 * before the shot (a dialog open...). theme: dark (default) or light.
 * A new page or dialog in the UI gets its shot here, and its place in the docs.
 */
export const shots = [
  { name: 'dashboard', path: '/' },
  { name: 'dashboard-light', path: '/', theme: 'light' },
  { name: 'uploads', path: '/uploads' },
  {
    name: 'upload-details',
    path: async (api) => {
      const { uploads } = await api('/api/uploads?limit=50');
      const upload = uploads.find((u) => u.filename.startsWith('Orbita Silenziosa'));
      return `/uploads/${upload.id}`;
    },
  },
  {
    // A version to choose: the rip says Extended, bookrr Theatrical
    name: 'release-version',
    path: async (api) => {
      const { uploads } = await api('/api/uploads?limit=50');
      const upload = uploads.find((u) => u.filename.startsWith('Codice Aurora'));
      return `/uploads/${upload.id}`;
    },
    prepare: async (page) => {
      await page.getByRole('button', { name: /^Rename/ }).first().click();
      await page.getByRole('dialog').waitFor();
      await page.getByText('The version is not the same everywhere').waitFor();
      await page.waitForTimeout(600);
    },
  },
  { name: 'servers', path: '/servers' },
  {
    name: 'server-dialog',
    path: '/servers',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Add server' }).first().click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(400);
    },
  },
  { name: 'rips', path: '/rips' },
  {
    name: 'rip-choose',
    path: '/rips',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Choose…' }).first().click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(400);
    },
  },
  { name: 'clients', path: '/clients' },
  { name: 'merge', path: '/merge' },
  { name: 'login', path: '/', signedOut: true },
];
