"use client";

/**
 * VoiceRecorder — MediaRecorder-driven audio capture for open-ended answers.
 *
 * Lifecycle:
 *   idle      → microphone not yet requested
 *   recording → mic granted, capturing
 *   recorded  → stopped, blob ready, candidate can play back / re-record / submit
 *   uploading → PUT-ing to Supabase Storage signed URL
 *   error     → permission denied, no mic, or upload failed
 *
 * Hard 5-minute cap. The candidate can re-record before submit; old blob
 * is discarded. Once submitted, parent component disables further input.
 */

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const MAX_SECONDS = 5 * 60; // 5 minutes per the user's spec

type Phase = "idle" | "recording" | "recorded" | "uploading" | "error";

export type VoiceUploadResult = {
  audioPath: string;
  durationSeconds: number;
};

export function VoiceRecorder({
  questionId,
  onUploaded,
  onCancelToText,
  disabled = false,
}: {
  questionId: string;
  onUploaded: (result: VoiceUploadResult) => void;
  onCancelToText: () => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef<string>("audio/webm");

  // Clean up the temporary playback URL when the component unmounts or the
  // blob is replaced.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  function clearTick() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function startRecording() {
    setError(null);
    if (typeof window === "undefined" || !navigator.mediaDevices) {
      setError("Your browser doesn't support audio recording.");
      setPhase("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Pick the most compatible MIME the browser supports.
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mime =
        candidates.find((m) =>
          typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported(m),
        ) ?? "audio/webm";
      mimeRef.current = mime;

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        clearTick();
        const blob = new Blob(chunksRef.current, { type: mime });
        blobRef.current = blob;
        setBlobUrl(URL.createObjectURL(blob));
        // Stop the underlying tracks so the mic indicator turns off.
        for (const t of stream.getTracks()) t.stop();
        setPhase("recorded");
      };

      recorder.start(/* timeslice */ 1000);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setPhase("recording");

      tickRef.current = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(seconds);
        if (seconds >= MAX_SECONDS) {
          stopRecording();
        }
      }, 250);
    } catch (err) {
      let msg: string;
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        msg = micDeniedMessage();
      } else if (
        err instanceof DOMException &&
        err.name === "NotFoundError"
      ) {
        msg = "No microphone detected on this device. Use 'Type instead'.";
      } else {
        msg = err instanceof Error ? err.message : "Couldn't start recording.";
      }
      setError(msg);
      setPhase("error");
    }
  }

  function stopRecording() {
    const r = recorderRef.current;
    if (r && r.state === "recording") r.stop();
  }

  function reset() {
    clearTick();
    setError(null);
    setElapsed(0);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    blobRef.current = null;
    chunksRef.current = [];
    setPhase("idle");
  }

  async function submit() {
    const blob = blobRef.current;
    if (!blob) return;
    setPhase("uploading");
    setError(null);
    try {
      // 1. Mint signed upload URL.
      const urlRes = await fetch("/api/answers/voice/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: questionId }),
      });
      if (!urlRes.ok) {
        const body = await urlRes.text().catch(() => "");
        throw new Error(`upload-url ${urlRes.status}: ${body || urlRes.statusText}`);
      }
      const { upload_url, audio_path } = (await urlRes.json()) as {
        upload_url: string;
        audio_path: string;
      };

      // 2. PUT the blob. Strip the ";codecs=..." parameter from the
      // Content-Type — Supabase Storage's allowed_mime_types check is
      // exact-string, and "audio/webm;codecs=opus" doesn't match the
      // "audio/webm" entry in the bucket allowlist. The bytes are
      // unchanged either way.
      const baseMime = mimeRef.current.split(";")[0]!.trim();
      const putRes = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": baseMime },
        body: blob,
      });
      if (!putRes.ok) {
        const body = await putRes.text().catch(() => "");
        throw new Error(`upload ${putRes.status}: ${body || putRes.statusText}`);
      }

      // 3. Tell the parent to send /api/answers with the audio_path.
      onUploaded({ audioPath: audio_path, durationSeconds: elapsed });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setPhase("error");
    }
  }

  const remaining = Math.max(0, MAX_SECONDS - elapsed);
  const isUrgent = remaining <= 30 && phase === "recording";

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Voice answer
        </p>
        <button
          type="button"
          onClick={onCancelToText}
          disabled={
            disabled || phase === "recording" || phase === "uploading"
          }
          className="text-[0.7rem] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          Type instead
        </button>
      </div>

      {phase === "idle" && (
        <div className="mt-3 flex flex-col items-center gap-3 py-4">
          <p className="text-sm text-muted-foreground">
            Up to 5 minutes. Tap to grant microphone access.
          </p>
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={disabled}
            className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            ● Start recording
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div className="mt-3 flex flex-col items-center gap-3 py-3">
          <motion.div
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
            className="h-3 w-3 rounded-full bg-destructive"
            aria-hidden
          />
          <p
            className={cn(
              "tabular-nums text-2xl font-bold",
              isUrgent ? "text-destructive" : "text-foreground",
            )}
          >
            {formatTime(elapsed)} / {formatTime(MAX_SECONDS)}
          </p>
          <button
            type="button"
            onClick={stopRecording}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-background px-5 text-sm font-medium hover:border-etc-marigold"
          >
            ■ Stop
          </button>
          <p className="text-[0.7rem] text-muted-foreground">
            Auto-stops at 5 minutes.
          </p>
        </div>
      )}

      {phase === "recorded" && blobUrl && (
        <div className="mt-3 flex flex-col gap-3 py-2">
          <div className="rounded-xl border border-border bg-background p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Recorded {formatTime(elapsed)} — review before submitting:
            </p>
            <audio
              controls
              src={blobUrl}
              className="w-full"
              preload="metadata"
            >
              Your browser doesn&rsquo;t support audio playback.
            </audio>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Submit answer
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium hover:border-etc-marigold"
            >
              Re-record
            </button>
          </div>
        </div>
      )}

      {phase === "uploading" && (
        <div className="mt-3 flex flex-col items-center gap-2 py-4">
          <p className="text-sm text-muted-foreground">Uploading…</p>
        </div>
      )}

      {phase === "error" && (
        <div className="mt-3 flex flex-col gap-3 py-2">
          {error && (
            <p className="rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              // "Try again" should actually retry — that is, call
              // getUserMedia again so the browser re-fires its
              // microphone-permission prompt. Browsers vary: a first
              // "Don't allow" usually leaves the permission state at
              // "prompt", so the next call DOES re-prompt; only after
              // multiple denials do they latch to "denied" and start
              // silently rejecting. Calling startRecording here gives
              // candidates the cheapest path back into voice mode
              // before falling back to the manual-grant message.
              onClick={() => void startRecording()}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-xs font-medium hover:border-etc-marigold"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onCancelToText}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-xs font-medium hover:border-etc-marigold"
            >
              Type instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Browser-aware message for NotAllowedError. The "aA in Safari" copy
 * only helps if the user is actually in Safari — Chrome users won't
 * see that button. Detect the four common cases:
 *
 *   - iOS Chrome (CriOS): lock icon in Chrome's omnibox, fallback to
 *     iOS Settings → Chrome → Microphone.
 *   - iOS Safari: the "aA" button → Website Settings → Microphone.
 *   - Android Chrome / Edge: lock icon → Permissions → Microphone.
 *   - Desktop Chromium / Firefox: lock icon in the address bar.
 *
 * Any unknown user-agent falls back to a generic "open your browser's
 * site settings" message.
 */
function micDeniedMessage(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isCrIOS = /CriOS/.test(ua); // Chrome on iOS
  const isAndroid = /Android/.test(ua);
  const isChromium = /Chrome|CriOS|Edg/.test(ua);

  if (isIOS && isCrIOS) {
    return "Microphone is blocked in Chrome. Tap the lock icon in the address bar and switch Microphone on. If you don't see it, open iPhone Settings → Chrome → Microphone, then reload this page. Or use 'Type instead'.";
  }
  if (isIOS) {
    return "Microphone is blocked. Tap the 'aA' button in Safari's address bar → Website Settings → Microphone → Allow, then reload. Or use 'Type instead'.";
  }
  if (isAndroid) {
    return "Microphone is blocked. Tap the lock icon next to the page URL → Permissions → Microphone → Allow, then reload. Or use 'Type instead'.";
  }
  if (isChromium) {
    return "Microphone is blocked. Click the lock or camera icon in your browser's address bar, set Microphone to Allow, then reload. Or use 'Type instead'.";
  }
  return "Microphone access is blocked. Open your browser's site settings for this page and allow microphone, then reload. Or use 'Type instead'.";
}
