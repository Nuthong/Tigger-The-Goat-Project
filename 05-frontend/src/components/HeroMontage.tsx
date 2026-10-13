import { useEffect, useRef, useState } from "react";

const HOLD_MS = 3000; // each clip is held ~3s before the cut
const FADE_MS = 900; // crossfade overlap (keep in sync with .imghero__vid transition)

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** Kick a muted <video> into playback, retrying once it has data if the
 *  immediate attempt is rejected (autoplay gate, or load() still settling). */
function playSoon(v: HTMLVideoElement | null): void {
  if (!v) return;
  const go = () => void v.play().catch(() => {});
  go();
  v.addEventListener("canplay", go, { once: true });
}

/**
 * Full-bleed hero that cuts a set of short clips together - each held ~3s with a
 * gentle crossfade, looping. Two stacked <video> layers ping-pong so the next
 * clip is already decoding before it fades in. Degrades to the poster image when
 * `prefers-reduced-motion` is set, and rides out a clip that fails to load.
 */
export function HeroMontage({ clips, poster }: { clips: string[]; poster: string }) {
  const reduce = usePrefersReducedMotion();
  const layerA = useRef<HTMLVideoElement>(null);
  const layerB = useRef<HTMLVideoElement>(null);
  const [front, setFront] = useState(0); // 0 = layer A shown, 1 = layer B shown
  const key = clips.join("|");

  useEffect(() => {
    if (reduce || clips.length === 0) return;
    const layers = [layerA.current, layerB.current] as const;
    let i = 0; // index of the clip currently in front
    let f = 0; // which layer is in front
    let timer = 0;
    let stopped = false;

    const load = (v: HTMLVideoElement | null, src: string) => {
      if (!v) return;
      if (v.getAttribute("src") !== src) {
        v.src = src;
        v.load();
      }
      v.currentTime = 0;
      playSoon(v);
    };

    load(layers[0], clips[0]);
    setFront(0);

    const step = () => {
      if (stopped) return;
      const back = 1 - f;
      i = (i + 1) % clips.length;
      load(layers[back], clips[i]);
      f = back;
      setFront(f);
      timer = window.setTimeout(step, HOLD_MS + FADE_MS);
    };
    timer = window.setTimeout(step, HOLD_MS);

    // Browsers pause <video> in a backgrounded tab; resume the visible layer.
    const onVisible = () => {
      if (!document.hidden) playSoon(layers[f]);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reduce, key, clips]);

  if (reduce) return <img className="imghero__img" src={poster} alt="" aria-hidden="true" />;

  return (
    <>
      <video
        ref={layerA}
        className="imghero__vid"
        style={{ opacity: front === 0 ? 1 : 0 }}
        muted
        playsInline
        autoPlay
        preload="auto"
        poster={poster}
        aria-hidden="true"
        tabIndex={-1}
      />
      <video
        ref={layerB}
        className="imghero__vid"
        style={{ opacity: front === 1 ? 1 : 0 }}
        muted
        playsInline
        preload="auto"
        poster={poster}
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}
