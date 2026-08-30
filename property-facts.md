# Property Facts — Kigali Keys

**Purpose.** One living source of truth for concrete facts about the property.
Anything you learn or change about the house goes here first; the backend seed
(`src/backend/kigali/seed.clj`) is kept as a transcription of this file. After
launch the **admin panel** (Property content, Pricing, Settings screens) is the
authoritative editor and this file becomes the seed-of-record.

`TODO` marks a fact still needed or unconfirmed.

## Contacts

| Role | Name | Public email | Public phone / WhatsApp | Named on the public site? |
|---|---|---|---|---|
| Host / owner — **guest-facing contact** | Peter | `info@kigalikeys.rw` (preliminary) | none shown for now | **Yes** — Contact page + booking emails |
| Property manager — internal (processes the booking queue, approvals, check-in) | Grace | n/a (not shown) | n/a | **No** |

- The Contact page, the `hostContact` in booking emails, and `hostDisplayName`
  all use **Peter's** name and `info@kigalikeys.rw`.
- **No public phone number yet** — the site shows email only. When a number is
  available it goes in the admin Settings screen (`publicPhone`).
- Both Peter and Grace get admin logins (Peter = owner role; Grace = admin role
  and processes the booking queue).
- `info@kigalikeys.rw` is preliminary — confirm the domain mailbox exists before
  production.

## The property

- Whole **2-bedroom duplex**, 2 storeys, on the **Gacuriro–Kagugu border**
  (Kinyinya sector, Gasabo district), Kigali. Gated street, ~15 min to the CBD,
  ~20 min from Kigali International Airport.
- **Sleeps 4.** Max occupancy 4 (including children).
- Ground floor: open kitchen; dining room (table seats **four**, plus a
  hand-wash corner); living room opening to a small planted terrace.
- Upstairs: **2 bedrooms, each en-suite** — primary with a **king** bed,
  second with a **queen** bed. Blackout curtains.
- Workspace: space for a desk (**desk not yet installed** — photo + fuller
  copy to follow); fast fibre throughout, ~100 Mbps, with mobile failover.

## Climate control

- **Living room:** air conditioning.
- **Bedrooms:** standing fans (no AC, no ceiling fans).
  *(Corrects the earlier seed text "ceiling fans and AC in both bedrooms".)*

## Kitchen & equipment

- **Gas cooker with oven** · fridge · microwave · blender · coffee machine ·
  electric kettle. **No dishwasher.**
- Crockery and utensils: dishes, cups, glasses, cutlery.
- Provided consumables: a starter supply of **coffee, tea, sugar, salt, oil and
  spices**.

## What's included with the stay

- Water and electricity
- **Automatic backup power**
- **24/7 gated security**
- Weekly linen and towel change
- Private off-street parking
- Washing machine (confirmed present)

## Not included

- Daily housekeeping
- Airport pickup unless arranged
- The car unless added to the booking
- Guaranteed early check-in

## The car (paid add-on)

- 2019 **Kia Sorento**, automatic, diesel, 7 seats, air-con, reversing camera,
  Bluetooth. Kept on the premises.
- **USD 45 / day**, collected and returned at the property, paid on site.
- Refundable deposit **USD 500**. Third-party liability insurance included;
  damage excess up to USD 500. Rwanda only, no cross-border travel.
- Driver: 23+, full licence held 2+ years, licence + passport at collection.
- Binding rental agreement accepted per booking when the car is added.

## Pricing

- **USD 70 / night.**
- **One-time cleaning fee USD 30** per stay (reduced from 35).
- **Minimum stay 3 nights.**
- The site shows an estimate; the manager confirms the final amount and the
  payment method in the approval email. No payment is taken online (v1).

## Check-in / check-out

- Check-in from **14:00** (until ~21:00), **self check-in via a lockbox**.
- The exact address and lockbox code are sent only **after the booking request
  is approved**. The public site shows an approximate area only.
- Check-out by **11:00**: wash up, bag rubbish, leave keys in the lockbox.
  *(No dishwasher — remove the "start the dishwasher" line from the current
  house-rules seed text.)*

## House rules

- No smoking or vaping indoors (allowed on the terrace).
- No parties or events.
- Quiet hours 22:00–06:00 (residential, gated neighbourhood).
- Maximum 4 guests; only guests named on the booking stay overnight.
- Daytime visitors welcome — register them with gate security.
- No pets (allergy-sensitive household).
- Tell Peter about any breakage; accidental damage is usually covered.

## Getting around

- Airport: metered taxi or pre-arranged transfer to Gacuriro/Kagugu ≈
  USD 20–25, ~20 min.
- Without the car: moto-taxis (Move / YegoMoto apps) ≈ RWF 1,000–2,000 a hop;
  ride-hail cars ≈ RWF 3,000–6,000 across town.
- Local supermarket and cafés a short drive away in Kinyinya.
