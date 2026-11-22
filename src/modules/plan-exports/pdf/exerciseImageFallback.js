/**
 * Shared Elevate exercise thumbnail placeholder (SVG data URI).
 * Used when no thumbnail exists or a remote thumb fails / times out during PDF render.
 */
export const EXERCISE_IMAGE_FALLBACK =
    'data:image/svg+xml,' +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="10" fill="#1a1e24"/>
  <path d="M22 44c2.5-7 7-11 10-11s7.5 4 10 11" stroke="#6b7280" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="32" cy="24" r="6.5" stroke="#6b7280" stroke-width="2.2"/>
  <path d="M18 30h6M40 30h6" stroke="#ccff01" stroke-width="2.2" stroke-linecap="round"/>
</svg>`
    );

export default {
    EXERCISE_IMAGE_FALLBACK,
};
