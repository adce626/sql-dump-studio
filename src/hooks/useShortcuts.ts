import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  EV_COPY_SELECTION,
  EV_FOCUS_SEARCH,
  EV_ROW_STEP,
  NAV_SHORTCUTS,
} from '../lib/shortcuts';

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    element.isContentEditable === true
  );
}

/**
 * Global keyboard shortcuts.
 *
 * - `/` or `Ctrl/Cmd + K` → go to the search page and focus its input
 * - `?` → toggle the shortcut help
 * - `g` then a key → jump between pages
 * - `Ctrl + Shift + C` → copy the selected rows
 * - `↑` / `↓` → move the row drawer
 */
export function useShortcuts(onToggleHelp: () => void) {
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const timer = useRef<number | null>(null);
  const helpRef = useRef(onToggleHelp);

  useEffect(() => {
    helpRef.current = onToggleHelp;
  }, [onToggleHelp]);

  useEffect(() => {
    function focusSearch() {
      navigate('/search');
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(EV_FOCUS_SEARCH));
      }, 80);
    }

    function onKeyDown(event: KeyboardEvent) {
      // Copy works even while typing in a field.
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'c'
      ) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(EV_COPY_SELECTION));
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (isTyping(event.target)) return;

      if (pendingG.current) {
        pendingG.current = false;
        if (timer.current !== null) window.clearTimeout(timer.current);
        const path = NAV_SHORTCUTS[event.key.toLowerCase()];
        if (path) {
          event.preventDefault();
          navigate(path);
        }
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === '/') {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        helpRef.current();
        return;
      }

      if (event.key.toLowerCase() === 'g') {
        pendingG.current = true;
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          pendingG.current = false;
        }, 1500);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        window.dispatchEvent(
          new CustomEvent(EV_ROW_STEP, {
            detail: event.key === 'ArrowDown' ? 1 : -1,
          }),
        );
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [navigate]);
}
