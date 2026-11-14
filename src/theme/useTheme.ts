import { useContext } from 'react';
import { ThemeContext, type ThemeValue } from './context';

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
