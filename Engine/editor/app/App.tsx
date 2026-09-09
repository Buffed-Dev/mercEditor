import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { Toasts } from '../ui/Toast';
import { TooltipProvider } from '../ui/Tooltip';
import { Home } from './Home';
import { MapWorkspace } from './MapWorkspace';
import { LibraryWorkspace } from './LibraryWorkspace';
import { RulesWorkspace } from './RulesWorkspace';

/**
 * The editor, as a program of its own.
 *
 * It is not part of any game. It is a tool that opens a game folder — a
 * manifest, a maps/ folder and a rules/ folder, see Games/Merc/game.js — draws
 * what is in it, and writes back into the same folder through the dev server.
 * One editor, as many games as there are folders under Games/.
 *
 * Routes are hash-based on purpose. The editor is served as a page rather than
 * from the root of a site, so a path-based router would need the dev server to
 * answer for every URL under it; a hash needs nothing, and still gives every
 * screen a link, a back button and a reload that returns you where you were.
 */
export function App() {
  return (
    <TooltipProvider>
      <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/:gameId/map" element={<MapWorkspace />} />
        <Route path="/:gameId/rules" element={<RulesWorkspace />} />
        {/* Which list and which record are in the URL, so a reference link is
            real navigation and the back button walks back out of the graph. */}
        <Route path="/:gameId/rules/:list" element={<RulesWorkspace />} />
        <Route path="/:gameId/rules/:list/:recordId" element={<RulesWorkspace />} />
        {/* The records a map is drawn with, as opposed to the rules it is
            played by. Reached from the asset browser, and linkable like the
            rest. */}
        <Route path="/:gameId/library" element={<LibraryWorkspace />} />
        <Route path="/:gameId/library/:kind" element={<LibraryWorkspace />} />
        <Route path="/:gameId/library/:kind/:recordId" element={<LibraryWorkspace />} />
        {/* A game with no workspace named is the map: it is the document, and
            the rules are a thing you go and look at about it. */}
        <Route path="/:gameId" element={<Navigate to="map" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
        <Toasts />
      </HashRouter>
    </TooltipProvider>
  );
}
