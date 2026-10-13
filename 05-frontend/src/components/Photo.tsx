import { useState } from "react";

/** <img> in a rounded frame with a warm-gradient fallback if the photo fails. */
export function Photo({
  src,
  alt,
  ratio = "4x3",
  className = "",
}: {
  src: string;
  alt: string;
  ratio?: "4x3" | "3x2" | "wide";
  className?: string;
}) {
  const [ok, setOk] = useState(true);
  return (
    <div className={`photo photo--${ratio} ${className}`}>
      {ok && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setOk(false)}
        />
      )}
    </div>
  );
}
