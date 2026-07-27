---
name: course-banner
description: Generate the standard Tertiary Infotech course banner — the deep-navy branded placeholder shown on LMS course cards when a course has no image. Use when asked to create/fix/restyle a course banner or placeholder image, when course cards show wrong, random or cropped images, or when adding the banner to a new card layout or another tenant surface.
---

# Course Banner

The standard branded placeholder for a course with no `imageUrl`. Generated as an
inline SVG data URI by `utils/courseBanner.ts` — no asset in `public/`, no network
request, cannot 404.

**Do not reintroduce a random-image service.** Course cards used to fall back to
`picsum.photos`, which served unrelated stock photography (a glacier for "SPC in
Manufacturing"). That is the bug this banner exists to fix.

## The design

Deep navy, landscape, three elements:

1. **Header row, top-left** — a small blue (`#3b82f6`) circle with a white "T",
   then the wordmark "Tertiary Infotech Academy" in white-ish bold.
2. **Course title** — white, bold, centred, up to 3 wrapped lines, ellipsised if
   it overflows. Optically centred in the band *below* the header, not at a fixed
   fraction of the height.
3. **Decorative arc** — a faint white circle outline bleeding off the bottom-left.

Colours — do not drift from these:

| Element | Value |
|---|---|
| Gradient base | `#0a1a3f` → `#132f6b` (linear, top-left → bottom-right) |
| Centre-right glow | `#2d5aa8` at 0.75 → 0 opacity (radial, cx .62 / cy .45) |
| Logo circle | `#3b82f6` |
| Wordmark | `#f1f5f9` |
| Title | `#ffffff` |
| Arc | `#ffffff` at 0.13 opacity |

A flat corner-to-corner ramp into a brighter blue reads purple at the bottom
right and is wrong — the navy base plus the offset radial glow is what gives the
brand look.

## The two failure modes

Both of these have already happened. Check for them.

### 1. Cropping — pass the container's real aspect ratio

The banner is rendered into `<img class="object-cover">`. If the SVG's ratio does
not match its container, `object-cover` scales it to fill and **crops the
overflow** — taking the logo and arc with it. A 400×200 (2:1) banner in a 380×170
(2.24:1) box loses ~15% off the top and bottom.

Always pass the container's actual dimensions:

```tsx
// container is `style={{ height: '170px' }}`, ~380px wide
getCourseImageUrl(course.imageUrl, course.id, course.title, { width: 380, height: 170 })
getCourseBannerDataUrl({ width: 380, height: 170, title: course.title })  // onError
```

Current call sites and their ratios:

| File | Container | Size to pass |
|---|---|---|
| `CourseList.tsx` grid card | `height: 170px` | `380×170` |
| `CourseList.tsx` 16/9 card | `aspect-[16/9]` | `400×225` |
| `CourseList.tsx` table row | `h-10 w-10` | `100×100` (thumbnail) |
| `TrainerMyClasses.tsx` | `h-40` | `380×160` |
| `CourseEditor.tsx` previews | `aspect-video` | `400×225` |

### 2. Overflow — scale off the smaller dimension

Inside the generator, scale from `Math.min(width / 400, height / 200)`, never
`width / 400` alone. In a short wide box, scaling off width pushes the logo and
arc outside the frame.

## Sizes

- **Banner** (≥160px wide): full composition.
- **Thumbnail** (<160px wide): logo mark only, centred, no wordmark or title —
  the title is illegible at 40px, so it is dropped rather than shrunk.

## Verifying a change

Rendering the raw SVG is not enough — it will not show the crop, because the crop
comes from `object-cover` in the card. Render at the **real container ratio** and
composite with the card's rounded corner:

```bash
# 1. strip TS types so node can run the generator
# 2. emit the SVG at the container's true dimensions
# 3. rasterise, then mask with the card's border-radius
rsvg-convert -w 760 card.svg -o card.png
python3 -c "
from PIL import Image, ImageDraw
im = Image.open('card.png').convert('RGB').resize((385,172))
m = Image.new('L', im.size, 0)
ImageDraw.Draw(m).rounded_rectangle([0,0,384,171], radius=16, fill=255)
bg = Image.new('RGB',(425,240),(19,26,43)); bg.paste(im,(20,34),m); bg.save('out.png')"
```

Then **look at the PNG**. Check: logo fully visible and clear of the corner, arc
inside the frame, title centred in the band below the header, colour deep navy
rather than bright/purple. Test a long title (3-line wrap + ellipsis), a short
one, and the 100×100 thumbnail.

## Multi-tenant

The wordmark is currently the literal `BRAND_NAME` constant. If another tenant
(Chariot, Intellisoft) needs this banner, **gate it on tenant config** — take the
brand name and logo colour from a tenant record or env var. Per `CLAUDE.md`, never
hardcode a second tenant name into shared logic or fork the file.
