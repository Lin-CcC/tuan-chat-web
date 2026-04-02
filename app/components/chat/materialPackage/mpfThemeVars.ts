import type React from "react";

import { useEffect, useMemo, useState } from "react";

function isDarkThemeActive() {
  if (typeof document === "undefined")
    return true;
  const root = document.documentElement;
  const theme = (root.dataset.theme ?? "").toLowerCase();
  return theme.includes("dark") || root.classList.contains("dark");
}

export function useMpfThemeVars() {
  const [isDarkTheme, setIsDarkTheme] = useState(() => isDarkThemeActive());

  useEffect(() => {
    if (typeof document === "undefined")
      return;
    const root = document.documentElement;
    const update = () => setIsDarkTheme(isDarkThemeActive());
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, []);

  return useMemo(() => {
    // Follow global theme (light/dark), but keep a consistent "mpf" tone and avoid pure black/white.
    if (isDarkTheme) {
      return {
        // Directory base tone.
        "--tc-mpf-bg": "#191E24",
        // Nearby surfaces (slightly lifted, still close to directory).
        "--tc-mpf-surface": "#1B2128",
        "--tc-mpf-surface-2": "#1D242C",
        "--tc-mpf-surface-3": "#202834",
        // Align with the directory panel tone.
        "--tc-mpf-toolbar": "#191E24",
        "--tc-mpf-input-bg": "#151b24",
        // Directory split line / inner dividers.
        "--tc-mpf-border": "#151B24",
        // Directory outer border tone.
        "--tc-mpf-border-strong": "#A4ADBB",
        // Window shell border (slightly stronger than inner dividers, but still subtle).
        "--tc-mpf-shell-border": "rgba(164, 173, 187, 0.22)",
        // Item/card border (slightly clearer than inner dividers).
        "--tc-mpf-item-border": "rgba(164, 173, 187, 0.18)",
        "--tc-mpf-text": "#e7ebf3",
        "--tc-mpf-muted": "#a4adbb",
        "--tc-mpf-crumb": "#b8c0cd",
        "--tc-mpf-icon": "#b9c2d0",
        "--tc-mpf-icon-hover": "#eef2f8",
        "--tc-mpf-accent": "#78a6ff",
        "--tc-mpf-danger": "#ff6b7a",
        "--tc-mpf-danger-hover": "#ff4a5f",
        "--tc-mpf-danger-ring": "#a53542",
        "--tc-mpf-selected": "#233452",
        "--tc-mpf-dot-border": "#41506a",
        "--tc-mpf-dot-folder": "#95a2b8",
        "--tc-mpf-dot-file": "#78a6ff",
        // Softer edge separation from the main panel (Windows-like subtle outline).
        "--tc-mpf-shadow": "0 18px 40px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(164, 173, 187, 0.18)",
        "--tc-mpf-pop-shadow": "0 12px 28px rgba(0, 0, 0, 0.26)",
        "--tc-mpf-range-track": "rgba(255, 255, 255, 0.18)",
        "--tc-mpf-range-thumb": "rgba(170, 210, 255, 0.86)",
        "--tc-mpf-grip": "#7b8699",
      } as unknown as React.CSSProperties;
    }

    return {
      // Directory base tone (light).
      "--tc-mpf-bg": "#F8F8F8",
      "--tc-mpf-toolbar": "#F8F8F8",
      // Nearby surfaces (slightly lifted, still close to directory).
      "--tc-mpf-surface": "#F6F8FB",
      // Directory right divider tone.
      "--tc-mpf-surface-2": "#EEF2F8",
      "--tc-mpf-surface-3": "#E7ECF4",
      "--tc-mpf-input-bg": "#FCFDFE",
      // Directory split line / inner dividers.
      "--tc-mpf-border": "#EEF2F8",
      // Directory outer border tone.
      "--tc-mpf-border-strong": "#B7C3D6",
      // Window shell border: use the directory border tone but softer (avoid "hard" deep line).
      "--tc-mpf-shell-border": "rgba(183, 195, 214, 0.92)",
      // Item/card border: slightly clearer than the shell border for list/icon items.
      "--tc-mpf-item-border": "rgba(183, 195, 214, 0.95)",
      "--tc-mpf-text": "#1e2633",
      "--tc-mpf-muted": "#5b6678",
      "--tc-mpf-crumb": "#3b4658",
      "--tc-mpf-icon": "#465164",
      "--tc-mpf-icon-hover": "#1e2633",
      "--tc-mpf-accent": "#2f6eea",
      "--tc-mpf-danger": "#d64553",
      "--tc-mpf-danger-hover": "#be3643",
      "--tc-mpf-danger-ring": "#e7a6ad",
      "--tc-mpf-selected": "#d7e5ff",
      "--tc-mpf-dot-border": "#9fb0c9",
      "--tc-mpf-dot-folder": "#6c7a91",
      "--tc-mpf-dot-file": "#2f6eea",
      "--tc-mpf-shadow": "0 18px 40px rgba(13, 22, 35, 0.12), 0 0 0 1px rgba(183, 195, 214, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.65)",
      "--tc-mpf-pop-shadow": "0 12px 28px rgba(13, 22, 35, 0.14)",
      "--tc-mpf-range-track": "rgba(30, 38, 51, 0.20)",
      "--tc-mpf-range-thumb": "rgba(47, 110, 234, 0.75)",
      "--tc-mpf-grip": "#74839b",
    } as unknown as React.CSSProperties;
  }, [isDarkTheme]);
}
