// The stylesheet is pulled in by the entry rather than by any component, so
// every module below stays importable by plain Node — which is what lets the
// panels be rendered and asserted on headlessly. Nothing under this file may
// import CSS that a test-reachable module pulls in transitively.
import './theme.css';
// The glyph vocabulary an item or a category can wear. Its own stylesheet
// rather than a hand-maintained codepoint table: the names are the classes.
import 'rpg-awesome/css/rpg-awesome.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

const host = document.getElementById('root');
if (!host) throw new Error('The editor page has no #root to mount into.');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
