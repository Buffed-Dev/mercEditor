import { NavLink, useNavigate } from 'react-router';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronDown,
  IconDatabase,
  IconMap2,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { Button, IconButton } from '../ui/Button';
import { DropdownMenu, MenuItem, MenuSeparator } from '../ui/Menu';
import { PublishButton } from '../assets/PublishButton';
import styles from './TopBar.module.css';

export type MapChoice = { id: string; label: string };

/**
 * Where you are, what you are looking at it with, and what you can do to it.
 *
 * The map picker is the last crumb rather than a control somewhere else,
 * because "which map" is the end of the same sentence that starts with which
 * project and which game — and that is where anyone looks for it.
 */
export function TopBar({
  game,
  gameLabel,
  mapId,
  maps,
  onOpenMap,
  onNewMap,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onPlaytest,
}: {
  game: string;
  gameLabel: string;
  mapId?: string | undefined;
  maps?: readonly MapChoice[] | undefined;
  onOpenMap?: ((id: string) => void) | undefined;
  onNewMap?: (() => void) | undefined;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onPlaytest: () => void;
}) {
  const navigate = useNavigate();

  return (
    <header className={styles.bar}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Button variant="quiet" onClick={() => void navigate('/')} title="All games">
          Project
        </Button>
        <span className={styles.sep}>/</span>
        <span className={styles.here}>{gameLabel}</span>
        {mapId && (
          <>
            <span className={styles.sep}>/</span>
            <DropdownMenu
              trigger={
                <Button variant="quiet">
                  {mapId}
                  <IconChevronDown size={15} />
                </Button>
              }
            >
              {maps?.map((map) => (
                <MenuItem
                  key={map.id}
                  checked={map.id === mapId}
                  onClick={() => onOpenMap?.(map.id)}
                >
                  {map.label}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onClick={() => onNewMap?.()}>New map…</MenuItem>
            </DropdownMenu>
          </>
        )}
      </nav>

      <nav className={styles.tabs} aria-label="Workspace">
        {/* NavLink marks the active one with aria-current="page", which is what
            the stylesheet lights up — the state is the accessible name for it,
            not a class that happens to look selected. */}
        <NavLink to={`/${game}/map`} className={styles.tab ?? ''}>
          <IconMap2 size={17} />
          Map Design
        </NavLink>
        <NavLink to={`/${game}/rules`} className={styles.tab ?? ''}>
          <IconDatabase size={17} />
          Game Data
        </NavLink>
      </nav>

      {/* Equal flex on the crumbs and on this, so the tabs between them sit in
          the middle of the bar rather than wherever the game's name leaves
          them. A single spacer cannot centre anything. */}
      <div className={styles.actions}>
        <IconButton label="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
          <IconArrowBackUp size={16} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo}>
          <IconArrowForwardUp size={16} />
        </IconButton>
        <Button variant="quiet" onClick={onPlaytest}>
          <IconPlayerPlay size={15} />
          Playtest
        </Button>
        <PublishButton game={game} />
      </div>
    </header>
  );
}
