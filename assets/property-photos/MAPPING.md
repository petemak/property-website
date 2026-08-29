# Property photo mapping — real images to wire into the gallery

Source of truth for wiring the owner-supplied photos in `assets/property-photos/`
into the site, replacing the neutral placeholders. Backend owns the seed +
property copy; frontend owns the mock fixtures. Read this whole file first.

## Gallery images

Categories are the fixed set from api-contract.md §2:
`Exterior & grounds`, `Living`, `Kitchen`, `Bedroom 1`, `Bedroom 2`,
`Bathrooms`, `Workspace`, `The car`.

| Category | Source files (in `assets/property-photos/`) | Notes |
|---|---|---|
| Exterior & grounds | `exterior-and-grounds/front-yard.jpg`, `exterior-and-grounds/front-yard2.jpg`, `exterior-and-grounds/fonrt-yard3.jpg`, `exterior-and-grounds/backyard.jpg` | `front-yard.jpg` is the **lead image** for the whole gallery |
| Living | `living/sitting-room1.jpg`, `living/sitting-room2.jpg`, `living/sitting-room3.jpg`, `dining/dinning.jpg`, `dining/washcorner.jpg` | `dinning.jpg` is the dining area; `washcorner.jpg` is a hand-wash corner **in the dining room** — caption both as dining-area shots. All in the Living category (no separate Dining category) |
| Kitchen | `kitchen/kitchen1.jpg`, `kitchen/kitchen2.jpg` | |
| Bedroom 1 | `bedroom-1/master-bedroom1.jpg` … `master-bedroom4.jpg` | Primary bedroom, **king** bed |
| Bedroom 2 | `bedroom-2/second-bedroom1.jpg` … `second-bedroom3.jpg` | Second bedroom, **queen** bed |
| Bathrooms | `bathrooms/masster-bathroom1.jpg`, `bathrooms/master-bathroom2.jpg`, `bathrooms/master-bathroom3.jpg`, `bathrooms/secondary-bathroom1.jpg`, `bathrooms/secondaty-bathroom2.jpg` | filenames have the owner's typos — use as-is |
| The car | `the-car/sorento1.jpeg`, `the-car/sorento2.jpeg` | one exterior, one interior of the Kia Sorento |
| Workspace | *(none)* | **Remove this category from the gallery seed entirely.** No desk installed yet; a photo will be supplied later. Do not emit a Workspace tile. |

- Total: **25** gallery images across 7 categories. Per-category: Exterior 4,
  Living 5, Kitchen 2, Bedroom 1 = 4, Bedroom 2 = 3, Bathrooms 5, The car 2.
- Write real, specific `alt` text and short `caption`s per image, in the brand
  voice (warm, precise, concrete — see brand-brief.md). No "nestled in paradise".
- Order: Exterior first (lead), then Living, Kitchen, Bedroom 1, Bedroom 2,
  Bathrooms, The car.
- Every image needs real width/height in the response (read the actual files).

## Location map

| Public map (`location.staticMapUrl` / `/api/media/map/approx.png`) | `location-map/approximate-location.png` |
|---|---|
| `location-map/exact-location.png` | **Do NOT publish.** Keep it out of the seed and out of `/api/media`. It may be used later inside the post-approval email only. |

## Property copy changes (backend seed — `property-content`)

The current seed copy over-promises a workspace and a 6-seat table that the
photos don't support. Adjust, keeping the brand voice and the digital-nomad
audience (fast internet + room to work is still true):

1. **`description`** — remove "There is a dedicated desk with a proper chair and
   a wired-and-wireless fibre connection for anyone working from here." Replace
   with a sentence that keeps the fibre/connectivity selling point but frames
   the **dining table as the work spot**, e.g. "Fast fibre runs throughout, and
   the dining table works well as a desk for anyone working from Kigali."
2. **`amenities`** — the `:key "desk"` entry ("Dedicated desk and ergonomic
   chair") becomes something accurate, e.g. label "Dining table doubles as a
   workspace", keep `:category "work"`. Keep the `wifi` amenity as-is.
3. **`faq`** — the "Is there a proper workspace?" answer: drop the "dedicated
   desk with an ergonomic chair" claim; say there's fast fibre and the dining
   table serves as a desk, and that a dedicated desk is being added.
4. **Dining table size** — anywhere it says the table seats/for **six**
   (`description`, any fixture alt/caption), change to **four** (the photo shows
   a 4-seat table).
5. Leave the "planted terrace" mention alone unless you're also changing that
   line for #1 — not in scope here.

## Frontend fixtures

Update `src/frontend/mock/fixtures/gallery.json` (and any other fixture that
references gallery images or the dining-table-for-six / desk copy) to match the
mapping above: 25 images, 7 categories, no Workspace, `front-yard` lead,
real-ish alt/caption text consistent with the backend seed.
