# Landing hero videos

The montage behind the landing headline ([`components/HeroMontage.tsx`](src/components/HeroMontage.tsx))
cuts five short muted clips together, ~3s each with a 0.9s crossfade, looping.
The files live in [`public/`](public/) and are listed in
[`src/lib/images.ts`](src/lib/images.ts) as `HERO_CLIPS`.

## What is in place now (Bangkok set)

| File         | Shot                                    | Source                                                                                                          | Licence           | Credit          |
| ------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------- | --------------- |
| `hero-1.mp4` | Wat Arun from the river                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Wat_Arun_from_the_river_-_2018_Aug_11.ogv)          | CC BY-SA 4.0      | Nesnad          |
| `hero-2.mp4` | Bangkok skyline at dusk, over Lumpini Park | [Mixkit](https://mixkit.co/free-stock-video/bangkok-skyline-at-dusk-25968/)                                     | Mixkit Free       | -               |
| `hero-3.mp4` | Bangkok skyline, night lights          | [Mixkit](https://mixkit.co/free-stock-video/night-lights-throughout-bangkok-21920/)                            | Mixkit Free       | -               |
| `hero-4.mp4` | Wok stir-fry on high heat              | [Mixkit](https://mixkit.co/free-stock-video/chef-cooking-stir-fry-vegetables-on-high-heat-47555/)              | Mixkit Free       | -               |
| `hero-5.mp4` | Silk cloth billowing, close-up         | [Mixkit](https://mixkit.co/free-stock-video/bright-blue-fabric-texture-moving-with-the-wind-40219/)             | Mixkit Free       | -               |

The CC BY-SA clip (hero-1) is credited in the site footer
([`components/Footer.tsx`](src/components/Footer.tsx)); Mixkit's licence needs no
attribution. Every file was re-encoded to 1280x720, <=12s, ~2.4 Mbit/s,
video-only, faststart. Whole set is ~15 MB.

To add a sixth clip, drop `hero-6.mp4` in `public/` and add `"/hero-6.mp4"` to
`HERO_CLIPS`.

## Swapping a clip

Free, commercial-OK, no attribution: **Pexels Video**, **Coverr**, **Mixkit**.
Search phrases: `wat arun`, `bangkok night aerial`, `bangkok skyline`,
`luxury hotel room`, `fine dining plating`, `thai silk loom`.

Normalise every download to the site spec (needs `ffmpeg` on PATH):

```bash
ffmpeg -y -ss START -i INPUT -t 12 \
  -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=25" \
  -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p \
  -b:v 2300k -maxrate 2600k -bufsize 4600k -an -movflags +faststart \
  public/hero-N.mp4
```

`-ss START` (before `-i`) picks the in-point; `-an` drops audio; `-t 12` trims.
Any source container works - `.ogv` / `.webm` / `.mp4` all decode.

After replacing a file, bump the `?vN` suffix on that entry in `HERO_CLIPS`
([`src/lib/images.ts`](src/lib/images.ts)) so browsers fetch the new bytes.
nginx serves `*.mp4` as `Cache-Control: no-cache` (revalidate via ETag), so the
bump is only belt-and-braces for anyone who cached under the old 30-day rule.

## Poster / reduced-motion fallback

`HeroMontage` shows the `HERO` still (an Unsplash Bangkok-dusk photo, see
`images.ts`) before the first clip decodes and whenever `prefers-reduced-motion`
is set. To match it to the film, grab a frame:

```bash
ffmpeg -y -i public/hero-1.mp4 -vf "select=eq(n\,30)" -vframes 1 public/hero-poster.jpg
```

then set `export const HERO = "/hero-poster.jpg";` in `images.ts`.

## History

`public/hero-old/` holds an earlier generic clip set (not used by the site).
