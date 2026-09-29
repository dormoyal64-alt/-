// @ts-check
/**
 * In-memory handoff of a shared file / text from #/share to a viewer route.
 */

/** @type {{kind: 'photo'|'video'|'reader', file?: File, text?: string}|null} */
let pending = null;

/** @param {{kind: 'photo'|'video'|'reader', file?: File, text?: string}} item */
export function setPending(item) {
  pending = item;
}

/** @param {'photo'|'video'|'reader'|'magnifier'} kind */
export function takePending(kind) {
  if (!pending || pending.kind !== kind) return null;
  const p = pending;
  pending = null;
  return p;
}
