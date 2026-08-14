"use client";

import { useEffect } from "react";

export type Notice = { tone: "success" | "error" | "info"; message: string };

export function ActionToast({ notice, onDismiss, dismissLabel = "Dismiss notification" }: { notice: Notice | null; onDismiss: () => void; dismissLabel?: string }) {
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onDismiss, 4_500);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) return null;
  return (
    <div className={`action-toast action-toast-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"}>
      <span aria-hidden="true">{notice.tone === "success" ? "✓" : notice.tone === "error" ? "!" : "i"}</span>
      <p>{notice.message}</p>
      <button type="button" onClick={onDismiss} aria-label={dismissLabel}>×</button>
    </div>
  );
}
