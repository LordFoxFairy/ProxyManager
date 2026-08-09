import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Follow the OS theme; the design system defines both palettes.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const apply = (on: boolean) =>
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
apply(dark.matches);
dark.addEventListener('change', (e) => apply(e.matches));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
