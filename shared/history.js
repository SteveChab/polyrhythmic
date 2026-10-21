// Undo and redo for any app (polytoggle, polycolor): pure, no DOM. Spec: polytoggle-spec.md, "Undo and redo".
// Each step is a snapshot of the whole state (states are small and edits return new states, so
// snapshots share nothing mutable). 200 steps, kept for the session only.

export const MAX_STEPS = 200;

/**
 * @param {object} song the song as opened
 * @param {number} [scene] the scene on screen
 */
export function createHistory(song, scene = 0, limit = MAX_STEPS) {
  // entries[0] is the song as opened. Entry i > 0 is the song after edit i, made in scene `scene`.
  let entries = [{ song, scene, key: null }];
  let at = 0;
  let sealed = false; // true once a later edit may no longer merge into the last entry

  return {
    get song() { return entries[at].song; },
    get canUndo() { return at > 0; },
    get canRedo() { return at < entries.length - 1; },

    /**
     * Record an edit. Edits with the same `key` in a row (dragging a slider) merge into one step
     * until seal() is called (on pointer up, or any other kind of edit).
     */
    push(next, scene, key = null) {
      if (next === entries[at].song) return;
      const last = entries[at];
      if (key !== null && at > 0 && !sealed && last.key === key && last.scene === scene && at === entries.length - 1) {
        entries[at] = { song: next, scene, key };
        return;
      }
      entries = entries.slice(0, at + 1);
      entries.push({ song: next, scene, key });
      if (entries.length - 1 > limit) entries.shift();
      at = entries.length - 1;
      sealed = false;
    },

    /** The next edit starts a new step even if it has the same key. */
    seal() { sealed = true; },

    /** Step back. Returns { song, scene } where scene is the scene the undone edit was made in. */
    undo() {
      if (at === 0) return null;
      const scene = entries[at].scene;
      at--;
      sealed = true;
      return { song: entries[at].song, scene };
    },

    redo() {
      if (at >= entries.length - 1) return null;
      at++;
      sealed = true;
      return { song: entries[at].song, scene: entries[at].scene };
    },

    get size() { return entries.length - 1; },
  };
}
