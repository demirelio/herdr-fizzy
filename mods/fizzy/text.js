// Herdr has no setting for the text size of mods, and its zoom grows the terminals too:
// every text size in this mod but the avatar initials (sized to their circle) goes through textPx, so TEXT_SCALE sets them all.
export const TEXT_SCALE = 1.15;
export const textPx = (px) => px * TEXT_SCALE;
