import { ABANDONED_GAME_OVER } from "../engine/peopleMovement";
import { TITLE_MENU_BACKGROUND } from "./art";

export const EMPTY_VILLA_TITLE = "The villa stands empty";

export function EmptyVillaScreen({
  onTitle,
  onNewGame,
  busy,
}: {
  onTitle: () => void;
  onNewGame: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className="title-screen empty-villa"
      role="dialog"
      aria-label={EMPTY_VILLA_TITLE}
      style={{ backgroundImage: `url(${TITLE_MENU_BACKGROUND})` }}
    >
      <p className="empty-villa-words">{ABANDONED_GAME_OVER}</p>
      <nav className="title-menu">
        <button className="primary" disabled={busy} onClick={onTitle}>
          Title
        </button>
        <button disabled={busy} onClick={onNewGame}>
          New Game
        </button>
      </nav>
    </div>
  );
}
