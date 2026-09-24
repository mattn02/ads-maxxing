"use client";
/* eslint-disable @next/next/no-img-element -- Generated ads are served by the workspace asset route. */
import { useState } from "react";

export function AdPreviewImage({ src, alt, frameClassName, priority = false }: {
  src: string;
  alt: string;
  frameClassName: string;
  priority?: boolean;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return (
    <div className={`ad-image-frame ${frameClassName} is-${state}`}>
      {state !== "ready" && (
        <span className="ad-image-state" role={state === "error" ? "alert" : "status"}>
          {state === "error" ? "Preview unavailable" : "Loading preview…"}
        </span>
      )}
      <img
        src={src}
        alt={alt}
        width={576}
        height={1024}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
      />
    </div>
  );
}
