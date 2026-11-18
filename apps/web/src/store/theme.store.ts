import { create } from 'zustand';

export type ColorSchemePreference = 'system' | 'light' | 'dark';
export type SidebarAccentColor = 'blue' | 'purple' | 'emerald' | 'orange' | 'slate';

interface ThemeState {
  preference: ColorSchemePreference;
  resolvedTheme: 'light' | 'dark';
  accentColor: SidebarAccentColor;
  isConfiguratorOpen: boolean;
  setPreference: (preference: ColorSchemePreference) => void;
  toggleLightDark: () => void;
  setAccentColor: (accent: SidebarAccentColor) => void;
  setConfiguratorOpen: (open: boolean) => void;
}

const STORAGE_SCHEME_KEY = 'color-scheme';
const STORAGE_ACCENT_KEY = 'bothub-accent';

function getSystemDarkPreference(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredPreference(): ColorSchemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }
  try {
    const raw = localStorage.getItem(STORAGE_SCHEME_KEY);
    if (raw === 'light' || raw === 'dark') {
      return raw;
    }
  } catch {
    return 'system';
  }
  return 'system';
}

function readStoredAccent(): SidebarAccentColor {
  if (typeof window === 'undefined') {
    return 'blue';
  }
  try {
    const raw = localStorage.getItem(STORAGE_ACCENT_KEY);
    if (
      raw === 'blue' ||
      raw === 'purple' ||
      raw === 'emerald' ||
      raw === 'orange' ||
      raw === 'slate'
    ) {
      return raw;
    }
  } catch {
    return 'blue';
  }
  return 'blue';
}

function resolveEffectiveTheme(preference: ColorSchemePreference): 'light' | 'dark' {
  if (preference === 'system') {
    return getSystemDarkPreference() ? 'dark' : 'light';
  }
  return preference;
}

function syncDocumentColorScheme(
  preference: ColorSchemePreference,
  resolved: 'light' | 'dark',
  accent: SidebarAccentColor
): void {
  if (typeof document === 'undefined') {
    return;
  }
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute('content', preference === 'system' ? 'light dark' : preference);
  }
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-accent', accent);
}

const initialPreference = readStoredPreference();
const initialResolved = resolveEffectiveTheme(initialPreference);
const initialAccent = readStoredAccent();
syncDocumentColorScheme(initialPreference, initialResolved, initialAccent);

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: initialPreference,
  resolvedTheme: initialResolved,
  accentColor: initialAccent,
  isConfiguratorOpen: false,

  setPreference: (preference: ColorSchemePreference) => {
    try {
      if (preference === 'system') {
        localStorage.removeItem(STORAGE_SCHEME_KEY);
      } else {
        localStorage.setItem(STORAGE_SCHEME_KEY, preference);
      }
    } catch {
      void 0;
    }
    const resolvedTheme = resolveEffectiveTheme(preference);
    syncDocumentColorScheme(preference, resolvedTheme, get().accentColor);
    set({ preference, resolvedTheme });
  },

  toggleLightDark: () => {
    const currentResolved = get().resolvedTheme;
    const targetScheme: 'light' | 'dark' = currentResolved === 'dark' ? 'light' : 'dark';
    const systemScheme: 'light' | 'dark' = getSystemDarkPreference() ? 'dark' : 'light';

    if (targetScheme === systemScheme) {
      get().setPreference('system');
    } else {
      get().setPreference(targetScheme);
    }
  },

  setAccentColor: (accentColor: SidebarAccentColor) => {
    try {
      localStorage.setItem(STORAGE_ACCENT_KEY, accentColor);
    } catch {
      void 0;
    }
    syncDocumentColorScheme(get().preference, get().resolvedTheme, accentColor);
    set({ accentColor });
  },

  setConfiguratorOpen: (isConfiguratorOpen: boolean) => {
    set({ isConfiguratorOpen });
  }
}));
