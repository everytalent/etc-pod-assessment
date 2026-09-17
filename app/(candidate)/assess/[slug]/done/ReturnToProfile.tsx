"use client";

/**
 * The way back after finishing validation.
 *
 * The outro used to end here with nothing to click, so a candidate who
 * had just spent twenty minutes on an adaptive assessment was left on a
 * card with no route back to the profile they started from. They get
 * sent back automatically after a few seconds, with a button for anyone
 * who would rather go now, or who has motion or timing reasons not to
 * want a page moving under them.
 */

import { useEffect, useState } from "react";

const REDIRECT_SECONDS = 5;

export function ReturnToProfile({ href }: { href: string }) {
  const [remaining, setRemaining] = useState(REDIRECT_SECONDS);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (cancelled) return;
    if (remaining <= 0) {
      window.location.assign(href);
      return;
    }
    const t = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, cancelled, href]);

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <a
        href={href}
        className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Back to your profile
      </a>

      {cancelled ? (
        <p className="text-xs text-muted-foreground">
          Take your time. Use the button when you&rsquo;re ready.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Taking you back in {remaining}s.{" "}
          <button
            type="button"
            onClick={() => setCancelled(true)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            Stay here
          </button>
        </p>
      )}
    </div>
  );
}
