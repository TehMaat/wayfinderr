const BACKEND_PORT = 3001;

/**
 * Backend URL as seen by the browser.
 *
 * NEXT_PUBLIC_API_URL is baked in at build time, so prebuilt Docker images leave it
 * unset: the backend is then assumed on the same host as the page, port 3001.
 * This works for localhost and for other devices on the LAN without rebuilding.
 */
export const getApiUrl = (): string => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${BACKEND_PORT}`;
  }
  return `http://localhost:${BACKEND_PORT}`;
};
