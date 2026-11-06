"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, Crosshair, XCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { LeakSurveyPhoto } from "@/lib/types";

/**
 * One photograph, and the point on it where the leak is.
 *
 * Placing the point is a tap on the picture rather than two number boxes,
 * because this is done standing in somebody's bathroom on a phone, and
 * because the only honest way to say "there" is to touch there.
 *
 * What is stored is a fraction of the image, not a pixel: the report draws
 * the photograph at whatever width the page gives it, and a pixel offset
 * would point at the wrong wall.
 */
export function LeakPhotoCard({
  photo,
  url,
  index,
  busy,
  onMark,
  onClearMark,
  onField,
  onDelete,
}: {
  photo: LeakSurveyPhoto;
  url: string | null;
  index: number;
  busy: boolean;
  onMark: (x: number, y: number) => void;
  onClearMark: () => void;
  onField: (field: "location" | "caption", value: string) => void;
  onDelete: () => void;
}) {
  const [location, setLocation] = useState(photo.location ?? "");
  const [caption, setCaption] = useState(photo.caption ?? "");
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setLocation(photo.location ?? "");
    setCaption(photo.caption ?? "");
  }, [photo.id, photo.location, photo.caption]);

  const marked = photo.marker_x != null && photo.marker_y != null;

  function place(e: React.MouseEvent<HTMLElement>) {
    const img = imgRef.current;
    if (!img) return;
    // the drawn box, not the natural size: object-contain leaves bars at the
    // sides, and a tap in a bar is not a point on the photograph
    const box = img.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onMark(Number(x.toFixed(5)), Number(y.toFixed(5)));
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100">
      <div className="relative select-none bg-ink-900">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={url}
            alt=""
            onClick={place}
            className="block max-h-[52vh] w-full cursor-crosshair object-contain"
          />
        ) : (
          <div className="flex h-56 items-center justify-center text-ink-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {marked && url && (
          // only a preview: the arrow that reaches the customer is drawn into
          // the image itself when the report is built
          <span
            className="pointer-events-none absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-danger-500 bg-danger-500/15 shadow-[0_0_0_2px_rgba(255,255,255,0.8)]"
            style={{ left: `${Number(photo.marker_x) * 100}%`, top: `${Number(photo.marker_y) * 100}%` }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-danger-500" />
          </span>
        )}

        <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink-900/70 text-xs font-extrabold text-white">
          {index + 1}
        </span>

        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="absolute left-2 top-2 rounded-full bg-ink-900/70 p-1.5 text-white hover:bg-danger-600"
          aria-label={`מחיקת תמונה ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 p-3">
        <p className="flex items-center gap-1.5 text-xs font-bold text-ink-500">
          <Crosshair className="h-3.5 w-3.5" />
          {marked ? (
            <>
              הנזילה מסומנת — אפשר ללחוץ שוב במקום אחר כדי להזיז את החץ
              <button
                type="button"
                onClick={onClearMark}
                disabled={busy}
                className="mr-auto flex items-center gap-1 font-bold text-ink-400 hover:text-danger-600"
              >
                <XCircle className="h-3.5 w-3.5" /> אין ממצא כאן
              </button>
            </>
          ) : (
            <>לחצו על התמונה במקום שבו נמצאת הנזילה — שם יצויר החץ</>
          )}
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onBlur={() => location !== (photo.location ?? "") && onField("location", location)}
            placeholder="איפה בבית — למשל: אמבטיה הורים"
          />
          <Input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => caption !== (photo.caption ?? "") && onField("caption", caption)}
            placeholder="מה רואים — למשל: רטיבות בקיר מאחורי האסלה"
          />
        </div>
      </div>
    </div>
  );
}

/** The button that adds photographs, with the camera offered first on a phone. */
export function AddPhotosButton({
  onFiles,
  busy,
  label = "הוספת תמונות",
}: {
  onFiles: (files: File[]) => void;
  busy: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <Button variant="secondary" fullWidth loading={busy} onClick={() => ref.current?.click()}>
        {label}
      </Button>
    </>
  );
}
