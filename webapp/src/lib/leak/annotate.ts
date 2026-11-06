/**
 * Burning the arrow into the photograph.
 *
 * Drawn onto a canvas rather than laid over the image with CSS, because the
 * report becomes a PDF by being photographed, and anything clever in the
 * overlay — a rotation, an SVG, a dingbat that needs the right font — is a
 * chance for the arrow to land somewhere other than the leak, or not at all.
 * A customer being shown where the water is coming from cannot be handed a
 * picture whose arrow drifted two walls to the left.
 *
 * Pixels are worked out from the image's own size, so the same fraction
 * points at the same brick whatever size the page draws it at.
 */

/** Where the leak is, as a fraction of the image from its left and top edge. */
export interface Marker {
  x: number;
  y: number;
}

/**
 * Which way the arrow comes in.
 *
 * From whichever corner has the most room, so the shaft lies across the empty
 * part of the photograph rather than over the thing being pointed at.
 */
function approach(m: Marker): { dx: number; dy: number } {
  return { dx: m.x < 0.5 ? -1 : 1, dy: m.y < 0.5 ? -1 : 1 };
}

/**
 * The photograph with a red arrow and ring at the point.
 *
 * Returns a JPEG data URL. The longest side is capped so a modern phone
 * photograph — twelve megapixels, four megabytes — does not have to be
 * carried whole into a PDF that will be printed at a quarter of a page.
 */
export async function annotatedPhotoUrl(
  source: Blob | string,
  marker: Marker | null,
  maxSide = 1400
): Promise<string> {
  const img = await loadImage(source);

  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("אין אפשרות לצייר על התמונה בדפדפן הזה");
  ctx.drawImage(img, 0, 0, w, h);

  if (marker) drawArrow(ctx, w, h, marker);

  return canvas.toDataURL("image/jpeg", 0.88);
}

function drawArrow(ctx: CanvasRenderingContext2D, w: number, h: number, marker: Marker) {
  const px = marker.x * w;
  const py = marker.y * h;
  // every measurement follows the smaller side, so the arrow is the same
  // weight on a photograph held upright as on one held sideways
  const unit = Math.min(w, h);
  const ring = unit * 0.055;
  const shaft = unit * 0.2;
  const head = unit * 0.05;
  const stroke = Math.max(3, unit * 0.011);

  const { dx, dy } = approach(marker);
  // the shaft runs at 45° into the point and stops at the ring, so the head
  // touches the ring rather than covering what it is pointing at
  const gap = ring + stroke;
  const norm = Math.SQRT1_2;
  const tipX = px - dx * gap * norm;
  const tipY = py - dy * gap * norm;
  const tailX = tipX - dx * shaft * norm;
  const tailY = tipY - dy * shaft * norm;

  // a white underlay beneath every red line: a red arrow on a red-brown
  // bathroom wall is invisible, and this is the one thing in the document
  // that has to be seen
  for (const [colour, width] of [
    ["rgba(255,255,255,0.95)", stroke * 2.1],
    ["#e11d2e", stroke],
  ] as const) {
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.arc(px, py, ring, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // the head, as a filled triangle about the shaft's direction
    const ux = dx * norm;
    const uy = dy * norm;
    const halo = colour.startsWith("rgba") ? width * 0.35 : 0;
    const bx = tipX - ux * (head + halo);
    const by = tipY - uy * (head + halo);
    // perpendicular to the shaft
    const perp = head * 0.62 + halo;
    ctx.beginPath();
    ctx.moveTo(tipX + ux * halo, tipY + uy * halo);
    ctx.lineTo(bx - uy * perp, by + ux * perp);
    ctx.lineTo(bx + uy * perp, by - ux * perp);
    ctx.closePath();
    ctx.fill();
  }
}

function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    img.onload = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      reject(new Error("לא הצלחנו לפתוח את התמונה"));
    };
    img.src = url;
  });
}
