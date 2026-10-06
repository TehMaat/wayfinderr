import { create } from 'zustand';

// Same rule as the backend (services/auth.ts)
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Login state of the page. 'setup' while the account doesn't exist yet,
 * 'login' when the session is missing or expired, 'ready' once logged in.
 */
export type AuthStatus = 'loading' | 'unreachable' | 'setup' | 'login' | 'ready';

interface AuthState {
  status: AuthStatus;
  username: string | null;
  signedIn: (username: string) => void;
  signedOut: (setupRequired?: boolean) => void;
  setStatus: (status: AuthStatus) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  username: null,
  signedIn: (username) => set({ status: 'ready', username }),
  signedOut: (setupRequired = false) => set({ status: setupRequired ? 'setup' : 'login', username: null }),
  setStatus: (status) => set({ status }),
}));
