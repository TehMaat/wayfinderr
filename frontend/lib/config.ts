/**
 * The browser only talks to the frontend server, on the same origin as the page:
 * it proxies /api, /health and the /ws WebSocket to the backend (rewrites in
 * next.config.js). This works on localhost, on the LAN and behind a reverse proxy.
 */
export const getWsUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};
