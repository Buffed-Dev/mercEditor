import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router';
import { Toasts } from '../ui/Toast';
import { TooltipProvider } from '../ui/Tooltip';
import { Home } from './Home';
import { MapWorkspace } from './MapWorkspace';
import { PrefabWorkspace } from './PrefabWorkspace';
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
/** Keep the expensive map/WebGL workspace alive while browsing the same game. */
function GameWorkspace() {
  const { gameId = '' } = useParams();
  const location = useLocation();
  const onMap = location.pathname === `/${gameId}/map`;
  const [mapMounted, setMapMounted] = useState(onMap);
  useEffect(() => {
    if (onMap) setMapMounted(true);
  }, [onMap]);

  return (
    <>
      {mapMounted && (
        <div style={{ display: onMap ? 'contents' : 'none' }}>
          <MapWorkspace active={onMap} />
        </div>
      )}
      {!onMap && <Outlet />}
    </>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/:gameId" element={<GameWorkspace />}>
        <Route path="map" element={null} />
        <Route path="rules" element={<RulesWorkspace />} />
        {/* Which list and which record are in the URL, so a reference link is
            real navigation and the back button walks back out of the graph. */}
        <Route path="rules/:list" element={<RulesWorkspace />} />
        <Route path="rules/:list/:recordId" element={<RulesWorkspace />} />
        {/* A prefab is built on a stage of its own: it is objects without a
            map, so there is no map for it to be a mode of. */}
        <Route path="prefabs/:prefabId" element={<PrefabWorkspace />} />
        {/* A game with no workspace named is the map: it is the document, and
            the rules are a thing you go and look at about it. */}
        <Route index element={<Navigate to="map" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
        <Toasts />
      </HashRouter>
    </TooltipProvider>
  );
}
