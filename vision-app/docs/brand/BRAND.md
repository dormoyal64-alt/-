# SeeTuned brand guide

Owner: A9 (Brand & Marketing). Status: v1, 2026-09-29. Assets live in `public/brand/`, `public/app/icons/`
and `public/favicon.ico`. The marketing site is `public/index.html` (Hebrew, primary) and `public/en/index.html`.

> **Before launch:** the name and logo still need a formal trademark clearance search by a qualified
> trademark attorney (ILPO, USPTO, EUIPO and the WIPO Global Brand Database, Nice classes 9, 42 and 44, plus
> app stores and social handles). The desk research in `docs/research/business-legal-payments.md` §7 found no
> conflicts, but it is not a clearance opinion. Do not print, file or pay for ads until the search is done.

## 1. Name

**SeeTuned** (Hebrew **סיטיונד**, said "see-TOONED").

- *See* + *tuned*: the product tunes the screen to how you see. It also nods to "stay tuned", which makes it easy to remember.
- It sounds like consumer technology, not medicine. That fits our positioning as a display-personalisation
  and viewing-comfort tool, not a medical device.
- It has two syllables and is easy for Hebrew speakers to say. The "-nd" ending works like סאונד or טרנד. There is one obvious English spelling.
- Always write it as one word with a capital S and a capital T: **SeeTuned**. Never write "Seetuned", "See Tuned", "SEETUNED" or "See-Tuned".
- In Hebrew running text, write **סיטיונד**, or write SeeTuned in Latin letters when the logo is next to it. The logo uses the Latin wordmark in both languages. The Hebrew lockup is for Hebrew-only settings, such as local print and signage.

## 2. Taglines

| | Hebrew | English |
|---|---|---|
| Primary | **המסך שלך, מכוון לעיניים שלך.** | **Your screen, tuned to your eyes.** |
| Secondary | לקרוא בקלות. לראות את המסך בדרך שלך. | Read easier. See your screen your way. |
| Descriptor | התאמה אישית של התצוגה לטלפון ולטאבלט | Display personalisation for phones and tablets |

## 3. Logo

**Idea:** an eye whose iris is a tuning dial. The iris ring is open like a control knob. The amber dot is the dial's
position marker, and it also reads as the eye's catchlight. The mark is a clean geometric vector with three
shapes plus a dot, so it still reads as an eye at 16 px.

| File | Use |
|---|---|
| `public/brand/logo-mark.svg` / `.png` (512 px) | The mark alone, teal and amber on light backgrounds |
| `public/brand/logo-mark-reverse.svg` | White and amber, for teal or dark backgrounds |
| `public/brand/logo-mark-mono.svg` | One colour (black). Recolour to a single flat colour only |
| `public/brand/logo-horizontal.svg` / `.png` | Mark + "SeeTuned" wordmark ("See" in ink, "Tuned" in teal). The primary logo |
| `public/brand/logo-horizontal-reverse.svg` | All white with an amber dot, for teal, dark or photo backgrounds |
| `public/brand/logo-horizontal-mono.svg` | One colour |
| `public/brand/logo-horizontal-he.svg` / `.png` | Mark (on the right) + "סיטיונד", for Hebrew-only settings |
| `public/brand/logo-horizontal-he-reverse.svg` | The Hebrew lockup reversed |
| `public/app/icons/icon.svg` | App icon (a rounded teal square), also used as the SVG favicon |
| `public/brand/og-image.png`, `og-image-en.png` | Social share images (1200×630) |

The wordmarks are **outlined paths**, not live text, so they render the same everywhere and load no fonts.
They were drawn from Liberation Sans Bold (SIL Open Font License 1.1), with the tracking tightened by 16/2048 em and the
font's "Tu" kerning applied. A brand designer may want to draw a fully custom wordmark before the trademark
filing. If so, keep the mark and the two-tone See/Tuned split.

**Clear space:** keep a margin around the logo at least as wide as the iris ring's diameter (about 40% of the mark's
height) on all sides. No text, edges or other graphics may enter it.

**Minimum sizes**

| Asset | Digital | Print |
|---|---|---|
| Mark | 16 px (below 24 px use `icon-16.png`, which is simplified: solid iris, heavier lids) | 6 mm |
| Horizontal lockup (EN or HE) | 96 px wide | 25 mm wide |

**Don'ts**
- Don't recolour parts of the mark with off-palette colours, add gradients to the mark itself, or add shadows or outlines.
- Don't mirror the mark in RTL layouts. Logos never flip. In the Hebrew lockup the mark sits on the right, but it is not mirrored.
- Don't stretch, rotate, or rearrange the mark and wordmark, and don't set the wordmark in another font.
- Don't put the teal logo on busy photos or on backgrounds below 3:1 contrast. Use the reverse version instead.
- Don't turn the mark into an eye-chart letter, a medical cross, or anything clinical.

## 4. App icons

| File | Size | Notes |
|---|---|---|
| `public/app/icons/icon-16.png` | 16×16 | Simplified drawing for tabs |
| `public/app/icons/icon-32.png` | 32×32 | Larger mark with thicker strokes |
| `public/app/icons/icon-180.png` | 180×180 | `apple-touch-icon`, full-bleed, **no transparency** (iOS rounds the corners) |
| `public/app/icons/icon-192.png`, `icon-512.png` | 192, 512 | Manifest `purpose: "any"`, rounded square with transparent corners |
| `public/app/icons/icon-maskable-512.png` | 512 | Manifest `purpose: "maskable"`, full-bleed teal. The eye sits inside the central 80% circle |
| `public/app/icons/icon.svg` | vector | SVG favicon / `any` |
| `public/favicon.ico` | 16 + 32 | ICO container with PNG entries |

Manifest (A7), relative to `/app/`:
`icons/icon-192.png` (any), `icons/icon-512.png` (any), `icons/icon-maskable-512.png` (maskable), `icons/icon-180.png`
(`<link rel="apple-touch-icon">`). Use theme colour `#0a6b66` (light) and background `#0b1220` / `#f5f8fb`.

## 5. Colour

These tokens are shared with the app (`public/app/css/base.css`). Contrast figures are WCAG 2.x ratios.

| Token | Light | Dark | Use |
|---|---|---|---|
| Primary (teal) | `#0a6b66` | `#3cc7bd` | Brand, buttons, icons |
| Primary strong | `#07524e` | `#6fdad2` | Links, small teal text |
| Accent (amber) | `#f2a93b` | `#f2a93b` | The dial dot, "best value" badge, highlights. Never use it for text on light backgrounds |
| Ink (text) | `#0f1b2d` | `#e8eef6` | Body text |
| Muted text (site) | `#354457` | `#b9c5d4` | Secondary text, still AAA |
| Background | `#f5f8fb` | `#0b1220` | Page |
| Surface | `#ffffff` | `#121c2e` | Cards |
| Tint | `#e2f1ef` | `#0e2429` | Section bands, icon tiles |
| Focus ring | `#1d6fe0` | `#7fb2ff` | 3 px outline |

| Pair | Ratio | Level |
|---|---|---|
| Ink on background (light / dark) | 16.2 / 16.0 | AAA |
| Muted text on background (light / dark) | 9.3 / 10.7 | AAA |
| Link (primary strong) on background (light / dark) | 8.5 / 11.3 | AAA |
| White on teal button (light) | 6.35 | AA, and AAA for large bold button text |
| Dark ink `#06201e` on teal `#3cc7bd` (dark mode buttons) | 8.2 | AAA |
| Ink on amber badge | 8.65 | AAA |
| Teal `#0a6b66` on white (icons, "Tuned") | 6.35 | Passes 3:1 for UI and graphics |
| Strong UI border (secondary button, menu button) | 3.7 / 4.6 | Passes 3:1 for UI |
| Focus ring on background (light / dark) | 4.5 / 8.7 | Passes 3:1 for UI |

## 6. Typography

- **UI and site:** the system font stack `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Hebrew", "Arial Hebrew", Arial, sans-serif`.
  It needs no web fonts and makes no third-party requests, and it renders well in Hebrew on every platform.
- Body text on the site is **18–20 px** with a line height of 1.65. Headings are 800 weight with slightly tight tracking.
  Buttons are at least 56 px tall on the site and 48 px in the app.
- Write numbers and prices as they appear in Hebrew text, for example "24.90 ₪" in Hebrew and "₪24.90" in English. Prices always include VAT.

## 7. Voice and tone

Calm, warm, plain and exact. We talk to adults who may find screens tiring, and we never talk down to them.
In Hebrew, use the plural or gender-neutral forms ("התחילו", "פנו", "שלך"). Keep sentences short, one idea
each. Be honest about what the product does not do.

**Positioning (it must appear on the site footer, in the store listings, the Terms and the disclaimer):**
SeeTuned is a display-personalisation and viewing-comfort tool. It is **not a medical device**. It does not diagnose, screen for, monitor or treat anything, it gives no prescription, and it does not replace an optometrist or an ophthalmologist.

| Use (EN) | Use (HE) | Avoid (EN) | Avoid (HE) |
|---|---|---|---|
| display personalisation, viewing comfort | התאמה אישית של התצוגה, נוחות צפייה | eye test, eye exam, vision exam | בדיקת עיניים, בדיקת ראייה (as a product claim) |
| visual checks, comfort checks, screen tune-up | בדיקות חזותיות, בדיקות נוחות, כיוונון מסך | diagnose, detect, screen for, monitor, track your eye health | לאבחן, לגלות, לאתר, לעקוב אחרי בריאות העין |
| find settings that are easier for you to read | למצוא הגדרות שקל לך יותר לקרוא | prescription, diopters, 20/20, 6/6, acuity score | מרשם, דיופטר, חדות ראייה 6/6 |
| larger text, stronger contrast, colour filters | טקסט גדול יותר, ניגודיות חזקה יותר, מסנני צבע | correct / improve / treat / cure your vision | לתקן / לשפר / לרפא את הראייה |
| magnifier, enhanced photo and video viewer | זכוכית מגדלת, צפייה משופרת בתמונות ובסרטונים | disease names (glaucoma, cataract, AMD…), "colour blindness diagnosis", "astigmatism detected" | שמות מחלות, אבחון עיוורון צבעים, זוהה אסטיגמטיזם |
| we recommend seeing an eye-care professional | מומלץ לפנות לאופטומטריסט או רופא עיניים | clinically proven, FDA/CE approved, doctor-grade | מוכח קלינית, מאושר FDA, ברמה רפואית |
| not a medical device | אינו מכשיר רפואי | replaces your optometrist, no need for glasses | מחליף את האופטומטריסט, אין צורך במשקפיים |

We may say that a normal screen **cannot** optically correct blur. We tune size, contrast, colour and sharpness instead.

Also never use: invented testimonials, user counts, star ratings, awards, "as seen in" logos, fake "was" prices,
countdown timers, or pre-selected plans. Every number we show must come from config (`GET /api/plans`) or be true.

## 8. App-store listing drafts

These are drafts for a future store build. The PWA is sold from our own site; see research §2 for store rules.

**App name (30 characters max):** SeeTuned. **Subtitle (App Store, 30 max):** EN "Screen tuned to your eyes" (25), HE "המסך מכוון לעיניים שלך" (22).

**Short description (Google Play, 80 max)**
- EN: "Quick visual checks tune text, contrast and colour on your phone to your eyes." (78)
- HE: "בדיקות חזותיות קצרות מכוונות טקסט, ניגודיות וצבע בטלפון – לפי העיניים שלך." (74)

**Long description, EN**

> Your screen, tuned to your eyes.
>
> SeeTuned helps you find the text size, contrast, colours and sharpness that are comfortable for you, and then sets up your phone or tablet to match.
>
> HOW IT WORKS
> • Short on-screen visual checks, one eye at a time, take about 5 minutes.
> • Your results become a personal display profile: recommended text size, contrast, sharpness and, if needed, a colour filter. There are no medical numbers and no diagnoses.
> • Step-by-step guidance for your device's own accessibility settings, so every app benefits.
>
> INSIDE SEETUNED
> • Photo and video viewer enhanced for your profile
> • Live magnifier: point the camera at a menu, label or sign
> • Comfortable reader for longer text
> • Separate profiles for everyone who shares a tablet
>
> PRIVATE BY DESIGN
> Your check results and profiles stay on your device.
>
> FAIR SUBSCRIPTION
> 30 days free with no card and no automatic charge. After that, choose monthly, 3 months or a year, and cancel any time in one click.
>
> SeeTuned is a display-personalisation and viewing-comfort tool. It is not a medical device, does not diagnose, screen for, monitor or treat any condition, and does not provide a prescription. It does not replace an eye examination by an optometrist or ophthalmologist. If you notice sudden changes in your vision, seek care promptly.

**Long description, HE**

> המסך שלך, מכוון לעיניים שלך.
>
> SeeTuned עוזר למצוא את גודל הטקסט, הניגודיות, הצבעים והחדות שנוחים לך, ואז מכוון לפיהם את הטלפון או הטאבלט.
>
> איך זה עובד
> • בדיקות חזותיות קצרות על המסך, לכל עין בנפרד, בערך 5 דקות.
> • התוצאות הופכות לפרופיל תצוגה אישי: גודל טקסט מומלץ, ניגודיות, חדות, ומסנן צבע אם צריך. בלי מספרים רפואיים ובלי אבחנות.
> • הדרכה צעד אחר צעד להגדרות הנגישות של המכשיר, כך שכל האפליקציות נהנות מההתאמה.
>
> בתוך SeeTuned
> • צפייה משופרת בתמונות ובסרטונים לפי הפרופיל שלך
> • זכוכית מגדלת חיה: מכוונים את המצלמה אל תפריט, תווית או שלט
> • קורא נוח לטקסטים ארוכים
> • פרופיל נפרד לכל מי שמשתמש באותו טאבלט
>
> פרטיות מובנית
> תוצאות הבדיקות והפרופילים נשמרים במכשיר שלך.
>
> מנוי הוגן
> 30 יום חינם, בלי כרטיס אשראי ובלי חיוב אוטומטי. אחר כך בוחרים חודשי, 3 חודשים או שנה, ומבטלים בכל עת בלחיצה אחת.
>
> SeeTuned הוא כלי להתאמה אישית של התצוגה ולנוחות צפייה. הוא אינו מכשיר רפואי, אינו מאבחן, אינו מבצע סינון או מעקב ואינו מטפל בשום מצב רפואי, ואינו מספק מרשם. הוא אינו מחליף בדיקת עיניים אצל אופטומטריסט או רופא עיניים. אם הבחנתם בשינוי פתאומי בראייה, פנו לטיפול בהקדם.

**Keywords (App Store, 100 characters max, comma-separated, no spaces)**
- EN: `large text,magnifier,contrast,colour filter,reading,accessibility,font size,zoom,display,glare` (94)
- HE: `טקסט גדול,זכוכית מגדלת,ניגודיות,מסנן צבע,קריאה,נגישות,גודל גופן,הגדלה,תצוגה,סנוור` (81)

Keep medical terms out of the keywords as well (see §7).

## 9. Placeholders the manager must fill

- `[[DOMAIN]]` in canonical, hreflang, Open Graph, Twitter and JSON-LD URLs (`public/index.html`, `public/en/index.html`).
- `[[COMPANY_NAME]]` in the footer copyright and the JSON-LD publisher.
- The JSON-LD offer prices are static (24.90 / 59.90 / 179.90 ILS). Keep them in sync with the configured plan prices.
  The visible prices update live from `GET /api/plans`.
