import { create } from 'zustand';
import { AuthUserDto } from '@bothub/shared';

interface AuthState {
  user: AuthUserDto | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setSession: (payload: {
    user: AuthUserDto;
    accessToken: string;
    refreshToken: string;
  }) => void;
  clearSession: () => void;
}

const STORAGE_AUTH_KEY = 'bothub-auth-session';

function loadPersistedSession(): {
  user: AuthUserDto | null;
  accessToken: string | null;
  refreshToken: string | null;
} {
  if (typeof window === 'undefined') {
    return { user: null, accessToken: null, refreshToken: null };
  }
  try {
    const raw = localStorage.getItem(STORAGE_AUTH_KEY);
    if (!raw) {
      return { user: null, accessToken: null, refreshToken: null };
    }
    const parsed = JSON.parse(raw) as {
      user: AuthUserDto;
      accessToken: string;
      refreshToken: string;
    };
    if (
      !parsed.accessToken ||
      parsed.accessToken === 'demo-session-mode-active'
    ) {
      localStorage.removeItem(STORAGE_AUTH_KEY);
      return { user: null, accessToken: null, refreshToken: null };
    }
    return {
      user: parsed.user ?? null,
      accessToken: parsed.accessToken ?? null,
      refreshToken: parsed.refreshToken ?? null
    };
  } catch {
    return { user: null, accessToken: null, refreshToken: null };
  }
}

const initialSession = loadPersistedSession();

export const useAuthStore = create<AuthState>((set) => ({
  user: initialSession.user,
  accessToken: initialSession.accessToken,
  refreshToken: initialSession.refreshToken,
  isAuthenticated: Boolean(initialSession.user && initialSession.accessToken),

  setSession: ({ user, accessToken, refreshToken }) => {
    try {
      localStorage.setItem(
        STORAGE_AUTH_KEY,
        JSON.stringify({ user, accessToken, refreshToken })
      );
    } catch {
      void 0;
    }
    set({
      user,
      accessToken,
      refreshToken,
      isAuthenticated: true
    });
  },

  clearSession: () => {
    try {
      localStorage.removeItem(STORAGE_AUTH_KEY);
    } catch {
      void 0;
    }
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false
    });
  }
}));
