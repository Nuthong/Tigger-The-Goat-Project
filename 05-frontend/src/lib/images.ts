/**
 * Placeholder imagery for the guest site - a **downtown Bangkok** city hotel.
 * No river / resort shots: skyline, streets, towers, city-view rooms.
 * Swap for the property's own shoot.
 *
 * Stills come from Unsplash (allowed by the nginx CSP: `img-src … images.unsplash.com`).
 * Hero motion clips are bundled in `public/` and served same-origin (`media-src 'self'`).
 * Every photo also sits on a warm gradient (`components/Photo.tsx`) so a failed
 * load still looks deliberate.
 */

const U = (id: string, w = 1600) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;

/** Brand mark (white lotus + wordmark, for dark grounds). */
export const LOGO = "/logo.png";

/** Landing hero - Bangkok skyline at dusk. */
export const HERO = U("1583417319070-4a69db38a482", 2000);

/**
 * Short Bangkok clips cut together behind the landing hero (~3s each, muted):
 * 1 Wat Arun, 2 skyline at dusk over the park, 3 skyline at night, 4 wok
 * stir-fry, 5 silk cloth in close-up. Sources, licences and the ffmpeg command are
 * in ../../HERO-VIDEOS.md; CC BY-SA credits sit in the footer. Keep every file
 * 1280x720, <=12s, video-only, `-movflags +faststart`.
 */
export const HERO_CLIPS = [
  // `?vN` busts the browser cache when a clip's bytes change under the same
  // name - bump it whenever you replace a hero-*.mp4 file.
  "/hero-1.mp4?v2",
  "/hero-2.mp4?v4",
  "/hero-3.mp4?v2",
  "/hero-4.mp4?v2",
  "/hero-5.mp4?v3",
];

/** Full-bleed "city after dark" quote band - Bangkok streets at night. */
export const CITY_NIGHT = U("1508009603885-50cf7c579365", 2000);

/** Rooms index hero - an elegant city suite. */
export const HERO_ROOMS = U("1590381105924-c72589b9ef3f", 2000);

/** Photo per seeded room_type_id (1‑5), with a generic fallback. */
export const HERO_ROOMS_BY_TYPE: Record<number, string> = {
  1: U("1618773928121-c32242e63f39"), // Cityview Room - classic city room
  2: U("1631049307264-da0ec9d70304"), // Parkview Room - corner room over the park
  3: U("1611892440504-42a792e24d32"), // Premier Skyline Room - high-floor king
  4: U("1522708323590-d24dbb6b0267"), // Skyline Residence - living room + kitchenette
  5: U("1590490360182-c33d57733427"), // Oriental Suite - signature suite
};

export const ROOM_FALLBACK = U("1512918728675-ed5a9ecdebfd");
