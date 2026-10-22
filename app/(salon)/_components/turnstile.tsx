"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

/** The part of Cloudflare's widget API used here (explicit rendering). */
interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Cloudflare Turnstile ("Nisem robot") inside the booking form. The widget puts
 * a one-time token into the hidden field "cf-turnstile-response", which the
 * server checks (lib/turnstile.ts). A token is good for one check, so after
 * every answer from the server (`resetKey` changes) the widget makes a new one.
 * Rendered explicitly, so React re-renders never lose it.
 */
export function Turnstile({ siteKey, resetKey }: { siteKey: string; resetKey: unknown }) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const api = window.turnstile;
    if (!loaded || !api || !container.current) return;
    widget.current = api.render(container.current, {
      sitekey: siteKey,
      action: "booking",
      language: "sl",
      size: "flexible",
      "response-field-name": "cf-turnstile-response",
    });
    return () => {
      if (widget.current) api.remove(widget.current);
      widget.current = null;
    };
  }, [loaded, siteKey]);

  useEffect(() => {
    if (resetKey && widget.current) window.turnstile?.reset(widget.current);
  }, [resetKey]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setLoaded(true)}
      />
      {/* Reserves the widget's height, so the button below does not jump. */}
      <div ref={container} className="min-h-[65px]" />
    </>
  );
}
