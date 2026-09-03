(ns kigali.seed
  "Idempotent baseline data. Runs on startup; every insert is guarded so a
   restart is a no-op. No secrets here — the initial owner account is only
   created when ADMIN_INITIAL_PASSWORD is provided via the environment."
  (:require [buddy.hashers :as hashers]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [clojure.tools.logging :as log]
            [com.stuartsierra.component :as component]
            [kigali.db :as db]
            [kigali.images :as images]
            [kigali.util :as util]))

;; ---------------------------------------------------------------------------
;; Content

(def property-content
  {:name "Kigali Keys"
   :tagline "Keys to a furnished home in Kigali — and to the car outside."
   :summary "The whole of a two-bedroom duplex on a quiet gated street in Kigali. Sleeps four."
   :description "Kigali Keys is the whole of a two-bedroom duplex on a quiet gated street on the Gacuriro–Kagugu border, in the Kinyinya sector, about fifteen minutes from the city centre. The ground floor has an open kitchen, a dining table that seats four, and an air-conditioned living room that opens onto a small planted terrace. Upstairs are two en-suite bedrooms — one with a king bed, one with a queen — each with blackout curtains and a standing fan. Fast fibre runs throughout, and the dining table doubles as a desk for anyone working from Kigali.\n\nThe house comes with automatic backup power, 24-hour gated security, a weekly linen and towel change, and a starter supply of coffee, tea, sugar, salt, oil and spices. A 2019 Kia Sorento is kept in the driveway; you can add it to your stay for USD 45 a day, arranged with your booking and paid on site."
   :neighbourhood "Gacuriro / Kagugu, Kigali"
   :neighbourhoodText "A quiet, upmarket residential pocket on the Gacuriro–Kagugu border, in the Kinyinya sector of Gasabo district — gated streets, embassies and family homes, about fifteen minutes from the city centre, with a supermarket and a couple of cafés a short drive away."
   :maxGuests 4
   :bedrooms 2
   :bathrooms 2
   :beds [{:room "Primary bedroom" :type "King"}
          {:room "Second bedroom" :type "Queen"}]
   :amenities [{:key "wifi" :label "Fast fibre wifi, about 100 Mbps" :category "work" :icon "wifi"}
               {:key "desk" :label "Dining table doubles as a workspace" :category "work" :icon "desk"}
               {:key "backupPower" :label "Automatic backup power" :category "building" :icon "power"}
               {:key "kitchen" :label "Full kitchen with oven, hob and a coffee machine" :category "kitchen" :icon "kitchen"}
               {:key "washer" :label "Washing machine" :category "comfort" :icon "washer"}
               {:key "aircon" :label "Air conditioning in the living room, standing fans in the bedrooms" :category "comfort" :icon "aircon"}
               {:key "security" :label "24-hour gated security" :category "safety" :icon "shield"}
               {:key "parking" :label "Private off-street parking" :category "building" :icon "parking"}
               {:key "car" :label "Kia Sorento on site (USD 45/day add-on)" :category "building" :icon "car"}]
   :included ["Water and electricity" "Automatic backup power" "Weekly linen and towel change" "24-hour gated security" "A starter supply of coffee, tea, sugar, salt, oil and spices"]
   :notIncluded ["Daily housekeeping" "Airport pickup unless arranged" "The car unless added to your booking" "Guaranteed early check-in"]
   :checkIn {:fromTime "14:00"
             :untilTime "21:00"
             :method "Self check-in with a lockbox"
             :processSteps ["Peter, the host, emails you the exact address and lockbox code once your request is approved."
                            "Let the gate security know the name the booking is under."
                            "Collect the keys from the lockbox by the front door, and message Peter to let him know you have arrived."]
             :publicPreview "Self check-in from 14:00 via a lockbox. The exact address is shared once your request is approved."}
   :houseRulesSummary ["No smoking indoors" "No parties or events" "Quiet hours 22:00–06:00" "Maximum 4 guests"]
   ;; Approximate area coordinates for the Gacuriro/Kagugu border; the owner
   ;; fine-tunes these in the admin Settings screen. The exact pin is never
   ;; exposed publicly.
   :location {:approxLat -1.9300
              :approxLng 30.0930
              :showExactAddress false
              ;; CDN-relative, served at rest from the frontend deploy (not
              ;; proxied). See api-contract.md "Media URLs".
              ;; NB: .jpg, not .png — the source map re-encodes far smaller as a
              ;; JPEG (flagged to the frontend as a contract tweak).
              :staticMapUrl "/media/map/approx.jpg"
              :pointsOfInterest [{:name "Kigali International Airport" :minutesByCar 20 :km 11 :category "transport"}
                                 {:name "City centre / CBD" :minutesByCar 15 :km 7 :category "transport"}
                                 {:name "Local supermarket, Kinyinya" :minutesByCar 5 :km 2 :category "amenity"}
                                 {:name "Volcanoes National Park" :minutesByCar 150 :km 105 :category "trip"}
                                 {:name "Lake Kivu (Rubavu)" :minutesByCar 180 :km 155 :category "trip"}]}
   :arrivalGuide "Most guests arrive at Kigali International Airport (KGL). A metered taxi or a pre-arranged transfer to Gacuriro/Kagugu (Kinyinya) is roughly USD 20–25 and takes about 20 minutes; the host can arrange a trusted driver if you send your flight details. Buy a local SIM (MTN or Airtel) at the airport for a few dollars, or set up an eSIM before you fly. Mobile money is used everywhere; cards work in larger shops and hotels. The currency is the Rwandan franc; plugs are type C/J at 230V. Kigali is calm and safe to walk in daytime; normal city sense at night."
   :gettingAroundWithoutCar "Moto-taxis (helmet provided) are the fastest way around and cost roughly RWF 1,000–2,000 for a short hop; use the Move or YegoMoto apps for a metered fare. Ride-hail cars via the same apps cost about RWF 3,000–6,000 across town. The house is a 5-minute drive from a small supermarket and two cafés."
   :faq [{:question "How fast is the wifi?" :answer "Fibre, about 100 Mbps download, with a mobile backup line that takes over automatically if it drops."}
         {:question "Is there a proper workspace?" :answer "Fast fibre runs throughout and the dining table works well as a desk. A dedicated desk and chair are being added."}
         {:question "Can I do laundry?" :answer "Yes — there is a washing machine, and a weekly linen and towel change is included."}
         {:question "Are pets allowed?" :answer "No — the household is allergy-sensitive, so we are not able to allow pets."}
         {:question "Are children welcome?" :answer "Yes. The maximum is four guests in total, including children, and a travel cot can be arranged."}
         {:question "How is payment handled?" :answer "No payment is taken on this site. Peter confirms the final amount and how to pay — usually a bank transfer to hold the dates, with the balance on arrival — when he approves your request."}
         {:question "What is the cancellation policy?" :answer "See the cancellation and stay terms page. In short, you can cancel free of charge up to 14 days before check-in."}]})

(def pricing
  {:currency "USD" :nightlyRate 70 :cleaningFee 30 :minNights 3})

(def vehicle
  {:offered true
   :name "Kia Sorento"
   :year 2019
   :bodyType "SUV"
   :transmission "Automatic"
   :seats 7
   :fuel "Diesel"
   :luggage "3 large cases"
   :dailyRate 45
   :currency "USD"
   :pickUpLocation "On site at the property"
   :description "A 2019 Kia Sorento kept at the house. Automatic, diesel, seven seats, air conditioning, reversing camera and Bluetooth. Comfortable on Kigali's hills and fine on the main roads to Musanze or Kivu. Collected and returned at the property; there is no airport desk."
   :driverRequirements ["Primary driver at least 23 years old"
                        "Full driving licence held for at least 2 years"
                        "Licence and passport presented at collection"]
   :minDriverAge 23
   :minLicenceYears 2
   :covered ["Third-party liability insurance" "Local breakdown assistance"]
   :notCovered ["Damage excess up to USD 500" "Fuel" "Traffic fines and tolls" "Cross-border travel (not permitted)"]
   :depositAmount 500
   :geographicLimit "Within Rwanda only"})

(def settings
  ;; Guest-facing contact is Peter, the host. Grace is internal only (admin
  ;; login, booking queue) and is never named on the public site or in guest
  ;; emails. The owner can still overwrite publicEmail, publicPhone and
  ;; newRequestNotificationEmails in the admin Settings screen.
  ;; approxLat/approxLng are the Gacuriro/Kagugu border area, fine-tuned in admin.
  {:hostDisplayName "Peter"
   :publicEmail "info@kigalikeys.rw"
   :publicPhone nil ;; TODO real number — until then GET /property exposes contact.phone as null
   :newRequestNotificationEmails ["info@kigalikeys.rw"]
   :timezone "Africa/Kigali"
   :currency "USD"
   :approxLat -1.9300
   :approxLng 30.0930
   :revealExactAddressAfterApproval true
   :guestResponseTimeText "Typically within 24–48 hours"})

;; ---------------------------------------------------------------------------
;; Legal / agreement document bodies

(def legal-docs
  [{:type "stayTerms" :version 3 :effective-date "2026-01-01"
    :summary ["A booking is a request until the host approves it in writing."
              "Free cancellation up to 14 days before check-in."
              "The final amount and payment method are set in the approval email."]
    :body "# Booking & Stay Terms (v3)\n\n## 1. What a booking is\nSubmitting the form on this site creates a **booking request**. It is not confirmed until the host approves it by email. The host may decline any request.\n\n## 2. Price and payment\nThe figures shown on the site are an estimate. The binding amount, the deposit (if any) and the payment method are stated in the approval email. No payment is taken on this website.\n\n## 3. Cancellation\nYou may cancel at no cost up to 14 days before check-in. Inside 14 days the first night is non-refundable. No-shows are charged the first night. If the host cancels, you receive a full refund of anything paid.\n\n## 4. Changes\nDate changes are subject to availability and are treated as a new request.\n\n## 5. During your stay\nThe house rules (published separately and versioned) form part of these terms. Maximum occupancy is 4 guests.\n\n## 6. Liability\nThe host is not liable for loss caused by circumstances outside their reasonable control. Nothing in these terms limits liability that cannot be limited by Rwandan law.\n\n## 7. Governing law\nThese terms are governed by the law of Rwanda."}

   {:type "houseRules" :version 3 :effective-date "2026-01-01"
    :summary ["No smoking indoors and no parties or events."
              "Quiet hours 22:00–06:00."
              "Maximum 4 guests; register visitors with gate security."]
    :body "# House Rules (v3)\n\n- **Occupancy:** maximum 4 guests. Only guests named on the booking may stay overnight.\n- **Smoking:** no smoking or vaping indoors. Smoking is allowed on the terrace.\n- **Parties and events:** not permitted.\n- **Quiet hours:** 22:00–06:00. The neighbourhood is residential and gated.\n- **Visitors:** daytime visitors are welcome; please register them with gate security.\n- **Pets:** not allowed in this house.\n- **Damage:** please tell the host about any breakage. Accidental damage is usually covered; deliberate or negligent damage is charged at cost.\n- **Check-out:** by 11:00. Wash up, bag rubbish, and leave the keys in the lockbox.\n- **Energy and water:** please switch off the AC when you go out."}

   {:type "websiteTerms" :version 2 :effective-date "2025-06-01"
    :summary ["Use the site lawfully and for genuine booking enquiries."
              "Content is provided in good faith without warranty of accuracy."
              "Rwandan law governs your use of the site."]
    :body "# Website Terms of Use (v2)\n\n## 1. Acceptable use\nThis site is for reading about the property and making genuine booking enquiries. Do not attempt to disrupt the service, scrape it at scale, or submit false information.\n\n## 2. Accuracy\nDescriptions, photos, travel times and prices are provided in good faith but may change. Nothing on the site is a binding offer until the host confirms a booking in writing.\n\n## 3. Intellectual property\nThe text and photographs on this site belong to the property owner and may not be reused without permission.\n\n## 4. Liability\nThe site is provided \"as is\". To the extent permitted by law the owner is not liable for indirect or consequential loss arising from use of the site.\n\n## 5. Governing law\nRwandan law applies. Contact: info@kigalikeys.rw."}

   {:type "privacy" :version 3 :effective-date "2026-01-01"
    :summary ["We collect the contact and trip details you enter, plus driver licence details if you add the car."
              "We store the IP address and browser string recorded when you accept an agreement."
              "Data is used to process your booking and kept for up to 24 months."]
    :body "# Privacy Policy (v3)\n\n## What we collect\n- **Contact and trip details:** name, email, phone, country of residence, purpose of stay, your message, dates and party size.\n- **Driver details (only if you add the car):** driver full name, date of birth, licence number and issuing country.\n- **Agreement acceptance metadata:** which document versions you accepted, the timestamp, and the IP address and browser user-agent recorded at that moment.\n- **Operational data:** emails we send you about your booking.\n\n## Why, and lawful basis\nWe use this data to assess and process your booking request (steps taken at your request prior to a contract) and to meet our records obligations for the vehicle rental agreement (legitimate interest / legal obligation).\n\n## Retention\nBooking and acceptance records are kept for up to 24 months after the stay, then deleted or anonymised. Driver licence numbers are removed sooner, once the rental is closed out.\n\n## Third parties\nWe use an email delivery provider to send booking emails and a map/image host to render location images. We do not sell your data. Payment is handled off-platform by the host.\n\n## Your rights\nYou can ask for a copy of your data, correction, or deletion by emailing info@kigalikeys.rw. If you are in the EU/EEA you may also complain to your local supervisory authority.\n\n## Controller\nThe property owner, Kigali. Contact: info@kigalikeys.rw."}

   {:type "cancellationPolicy" :version 3 :effective-date "2026-01-01"
    :summary ["Free cancellation up to 14 days before check-in."
              "Inside 14 days the first night is non-refundable; no-shows are charged the first night."
              "If the host cancels, anything paid is refunded in full."]
    :body "# Cancellation & Stay Terms (v3)\n\n## Requesting and approval\nA booking is a request until the host approves it. You are not charged to submit a request.\n\n## Cancellation by the guest\n- **More than 14 days before check-in:** full refund of anything paid.\n- **14 days or fewer before check-in:** the first night is non-refundable; the rest is refunded.\n- **No-show or same-day cancellation:** the first night is charged.\n\n## Changes to dates\nTreated as a new request, subject to availability and current pricing.\n\n## Cancellation by the host\nIf the host has to cancel, you receive a full refund of anything paid and help finding an alternative where possible.\n\n## The car\nThe car add-on can be cancelled up to 48 hours before pick-up at no cost. It is paid on site, so no refund is involved before then.\n\n_(A paid-booking refund section will be added here when online payment is introduced.)_"}

   {:type "vehicleRentalAgreement" :version 4 :effective-date "2026-07-01"
    :summary ["You are responsible for damage up to the USD 500 excess."
              "Return the car with the same fuel level."
              "Rwanda only; no cross-border travel."
              "Report any accident to the host and the police within 24 hours."]
    :body "# Kia Sorento Rental Agreement (v4)\n\n## 1. Parties\nThis agreement is between the property owner (\"the Owner\") and the guest named as primary driver on the booking (\"the Renter\").\n\n## 2. Vehicle\n2019 Kia Sorento, automatic, diesel, kept at the property in Gacuriro/Kagugu, Kigali.\n\n## 3. Rental period and rate\nThe car is rented for the pick-up and drop-off dates on the approved booking at USD 45 per calendar day, payable on site at collection. A day is each 24-hour period or part thereof.\n\n## 4. Security deposit and excess\nA refundable deposit of USD 500 is taken at collection (cash or card pre-authorisation) and returned after the car is checked in undamaged. The Renter is responsible for damage up to the USD 500 excess; deliberate or negligent damage is charged in full.\n\n## 5. Permitted use and geographic limit\nThe car may be driven within Rwanda only. Cross-border travel is not permitted. The car may not be used for hire or reward, motorsport, towing, or to carry more passengers than seatbelts.\n\n## 6. Driver eligibility\nThe primary driver must be at least 23 years old and have held a full licence for at least 2 years, and must present the licence and passport at collection. Only drivers approved by the Owner may drive the car.\n\n## 7. Insurance\nThird-party liability insurance is included. Damage to the rented vehicle is the Renter's responsibility up to the excess in clause 4. Fines, tolls and impound fees are the Renter's responsibility.\n\n## 8. Fuel and mileage\nThe car is provided with a set fuel level and must be returned at the same level; otherwise refuelling is charged plus a service fee. Mileage is unlimited within Rwanda.\n\n## 9. Condition on return\nThe car is returned to the property clean enough for inspection, on the agreed date and time. Late return is charged at the daily rate.\n\n## 10. Breakdown and accident\nIn a breakdown, call the assistance number provided at collection. In any accident the Renter must inform the Owner and the Rwanda National Police within 24 hours and must not admit liability.\n\n## 11. Prohibited uses\nDriving under the influence of alcohol or drugs, off-road use, and use by an unapproved driver each void the insurance and make the Renter liable for all resulting loss.\n\n## 12. Termination\nThe Owner may end the rental immediately for a serious breach of this agreement.\n\n## 13. Liability\nNothing in this agreement excludes liability that cannot be excluded under Rwandan law.\n\n## 14. Governing law\nThis agreement is governed by the law of Rwanda.\n\n## 15. Acceptance\nBy ticking the acceptance box in the booking flow the Renter confirms they have read and agree to this agreement in the version shown."}])

;; ---------------------------------------------------------------------------
;; Email templates

(def email-templates
  [{:key "bookingReceived"
    :subject "We've got your Kigali Keys request — {{bookingReference}}"
    :body "Hi {{guestFirstName}},\n\nThank you for your request to stay at Kigali Keys for {{stayDates}}. It is a request for now — the host, Peter, reviews every booking personally and will reply, usually within 24–48 hours.\n\nHere is what you asked for:\n\n{{priceBreakdown}}\n\nYou can check the status of your request at any time here: {{statusUrl}}\n\nWe will be in touch soon."}
   {:key "bookingApproved"
    :subject "Your Kigali Keys stay is confirmed — {{bookingReference}}"
    :body "Hi {{guestFirstName}},\n\nGreat news — your stay for {{stayDates}} is confirmed.\n\n{{priceBreakdown}}\n\n**Address:** {{addressLine}}\n\n**Check-in:** {{checkInInstructions}}\n\n**Your host:** {{hostContact}}\n\nSee your booking at any time: {{statusUrl}}"}
   {:key "bookingRejected"
    :subject "About your Kigali Keys request — {{bookingReference}}"
    :body "Hi {{guestFirstName}},\n\nThank you for your request for {{stayDates}}. Unfortunately the host is not able to take this booking:\n\n{{rejectionExplanation}}\n\nYou are welcome to send a new request for different dates. Details: {{statusUrl}}"}
   {:key "adminNewBooking"
    :subject "New booking request — {{bookingReference}} ({{stayDates}})"
    :body "A new request has come in.\n\nGuest: {{guestFirstName}}\nDates: {{stayDates}}\nReference: {{bookingReference}}\n\n{{priceBreakdown}}\n\nReview it: {{statusUrl}}"}
   {:key "contactAck"
    :subject "Thanks for contacting Kigali Keys"
    :body "Hi {{guestFirstName}},\n\nThank you for your message — the host will get back to you, usually within a day.\n\nIf it is about an existing request, quote your reference {{bookingReference}}."}
   {:key "adminInvite"
    :subject "You've been invited to help manage Kigali Keys"
    :body "Hi {{guestFirstName}},\n\nYou've been invited as an administrator for the Kigali Keys site. Set your password here: {{statusUrl}}\n\nThe link can be used once."}])

;; ---------------------------------------------------------------------------
;; Gallery
;;
;; Real owner-supplied photographs, wired per assets/property-photos/MAPPING.md.
;; Order: Exterior (lead first), Living, Kitchen, Bedroom 1, Bedroom 2,
;; Bathrooms, The car. No Workspace category (no desk installed yet).
;; Source basenames are kept verbatim, including the owner's spelling.
;; If a source file is missing, seed-gallery! falls back to a neutral grey
;; placeholder for that row.

(def gallery-seed
  ;; [category  source-relative-path  alt  caption]  — first entry is the lead
  [["Exterior & grounds" "exterior-and-grounds/front-yard.jpg"
    "The duplex seen from the front garden, with the paved parking area and the gated entrance"
    "The house and the parking area"]
   ["Exterior & grounds" "exterior-and-grounds/front-yard2.jpg"
    "The front of the duplex from the side, showing the covered entrance and wall planting"
    "The entrance, from the side"]
   ["Exterior & grounds" "exterior-and-grounds/fonrt-yard3.jpg"
    "The lawn and garden in front of the duplex"
    "Garden and lawn at the front"]
   ["Exterior & grounds" "exterior-and-grounds/backyard.jpg"
    "The enclosed back yard with a paved area and the garden wall"
    "The back yard"]

   ["Living" "living/sitting-room1.jpg"
    "The living room with two sofas, a coffee table and large windows"
    "The living room"]
   ["Living" "living/sitting-room2.jpg"
    "The living room looking toward the windows and the seating"
    "Living room, toward the windows"]
   ["Living" "living/sitting-room3.jpg"
    "The living room seating with the television and media unit"
    "Living room and TV corner"]
   ["Living" "dining/dinning.jpg"
    "The dining area beside the kitchen, with a table for four"
    "The dining table, seats four"]
   ["Living" "dining/washcorner.jpg"
    "A hand-wash corner in the dining room, with a basin and mirror"
    "Hand-wash corner in the dining room"]

   ["Kitchen" "kitchen/kitchen1.jpg"
    "The kitchen with a full-size oven, hob and fitted counters"
    "The kitchen"]
   ["Kitchen" "kitchen/kitchen2.jpg"
    "The kitchen from the other end, showing worktop and storage space"
    "Kitchen, worktop and storage"]

   ["Bedroom 1" "bedroom-1/master-bedroom1.jpg"
    "The primary bedroom with a king bed and bedside lamps"
    "Primary bedroom, king bed"]
   ["Bedroom 1" "bedroom-1/master-bedroom2.jpg"
    "The primary bedroom from the doorway, with the wardrobe"
    "Primary bedroom and wardrobe"]
   ["Bedroom 1" "bedroom-1/master-bedroom3.jpg"
    "The primary bedroom on the window side, with blackout curtains"
    "Primary bedroom, window side"]
   ["Bedroom 1" "bedroom-1/master-bedroom4.jpg"
    "A corner of the primary bedroom with the dresser"
    "Primary bedroom, dresser corner"]

   ["Bedroom 2" "bedroom-2/second-bedroom1.jpg"
    "The second bedroom with a queen bed"
    "Second bedroom, queen bed"]
   ["Bedroom 2" "bedroom-2/second-bedroom2.jpg"
    "The second bedroom from the doorway"
    "Second bedroom"]
   ["Bedroom 2" "bedroom-2/second-bedroom3.jpg"
    "The second bedroom on the window side, with the wardrobe"
    "Second bedroom, window and wardrobe"]

   ["Bathrooms" "bathrooms/masster-bathroom1.jpg"
    "The primary en-suite bathroom with a walk-in shower"
    "Primary en-suite, walk-in shower"]
   ["Bathrooms" "bathrooms/master-bathroom2.jpg"
    "The primary en-suite vanity and mirror"
    "Primary en-suite, vanity"]
   ["Bathrooms" "bathrooms/master-bathroom3.jpg"
    "The primary en-suite bathroom from the doorway"
    "Primary en-suite"]
   ["Bathrooms" "bathrooms/secondary-bathroom1.jpg"
    "The second bathroom with a shower over the bath"
    "Second bathroom"]
   ["Bathrooms" "bathrooms/secondaty-bathroom2.jpg"
    "The second bathroom vanity and toilet"
    "Second bathroom, vanity"]

   ["The car" "the-car/sorento1.jpeg"
    "The 2019 Kia Sorento parked at the property"
    "The Kia Sorento, on site"]
   ["The car" "the-car/sorento2.jpeg"
    "Inside the Kia Sorento, showing the dashboard and front seats"
    "Inside the Sorento"]])

;; ---------------------------------------------------------------------------
;; Seeder

(defn- content-missing? [db k]
  (nil? (db/q1 db ["SELECT doc_key FROM content_documents WHERE doc_key = ?" k])))

(defn- put-content! [db k data]
  (when (content-missing? db k)
    (db/exec! db ["INSERT INTO content_documents (doc_key, data, updated_at) VALUES (?,?,?)"
                  k (util/->json data) (util/now-iso)])))

(defn- seed-legal! [db]
  (doseq [{:keys [type version effective-date summary body]} legal-docs]
    (when-not (db/q1 db ["SELECT id FROM legal_documents WHERE doc_type = ? AND version = ?" type version])
      (db/exec! db
                ["INSERT INTO legal_documents
                  (id, doc_type, version, effective_date, body_markdown, body_hash,
                   summary_points, published_at, published_by, is_current)
                  VALUES (?,?,?,?,?,?,?,?,?,1)"
                 (util/short-id "doc") type version effective-date body
                 (util/body-hash body) (util/->json summary) (util/now-iso) "Seed"]))))

(defn- seed-email-templates! [db]
  (doseq [{:keys [key subject body]} email-templates]
    (when-not (db/q1 db ["SELECT template_key FROM email_templates WHERE template_key = ?" key])
      (db/exec! db ["INSERT INTO email_templates (template_key, subject, body_markdown, updated_at)
                     VALUES (?,?,?,?)" key subject body (util/now-iso)]))))

(defn- basename [rel] (last (str/split rel #"/")))
(defn- stem [name] (str/replace name #"\.[^.]+$" ""))

(def ^:private gallery-seed-by-stem
  ;; source basename stem -> [category rel alt caption]. Lets the media
  ;; normaliser re-derive a seed row's source photo from its (old- or
  ;; new-scheme) filename with no schema change — every stem in gallery-seed is
  ;; unique (front-yard, sorento1, …).
  (into {} (map (fn [[_ rel :as entry]] [(stem (basename rel)) entry]))
        gallery-seed))

(defn- place-gallery-file!
  "Re-encodes a real source photo into the media dir as a web-optimised
   progressive JPEG (within the size budget — never the camera-original) plus a
   thumbnail, and returns the stored image's {:width :height}. Falls back to a
   neutral grey placeholder when the source file is absent (should not happen
   once every category has a photo)."
  [^java.io.File src ^java.io.File full ^java.io.File thumb]
  (io/make-parents full)
  (if (.exists src)
    (let [{:keys [width height]} (images/write-web-image! src full)]
      (images/write-thumbnail! full thumb)
      {:width width :height height})
    (do (log/warn "gallery source photo missing, using placeholder" {:src (str src)})
        (images/write-solid-placeholder! full 2000 1333)
        (images/write-solid-placeholder! thumb 800 533)
        {:width 2000 :height 1333})))

(defn- seed-gallery! [db media-dir photos-dir]
  (when (empty? (db/q db ["SELECT id FROM gallery_images LIMIT 1"]))
    (doseq [[i [category rel alt caption]] (map-indexed vector gallery-seed)]
      ;; Normalise to <stem>.jpg — every stored gallery image is a JPEG after
      ;; re-encode, and the frontend bundle (clojure -X:export-media) uses the
      ;; same names. Keeps the owner's stem (e.g. front-yard, sorento1).
      (let [base (str (stem (basename rel)) ".jpg")
            thumb-name (str (stem (basename rel)) "_thumb.jpg")
            src (io/file photos-dir rel)
            full (io/file media-dir "gallery" base)
            thumb (io/file media-dir "gallery" thumb-name)
            {:keys [width height]} (place-gallery-file! src full thumb)]
        (db/exec! db
                  ["INSERT INTO gallery_images
                    (id, filename, thumb_filename, alt, caption, category, width, height, position, is_lead, origin, created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
                   (util/short-id "img") base thumb-name
                   alt caption category width height (inc i) (if (zero? i) 1 0)
                   "seed" (util/now-iso)])))))

(defn- seed-map!
  "Publishes only the approximate-location map as an optimised map/approx.jpg.
   The exact-location image is deliberately never copied into the media dir."
  [media-dir photos-dir]
  (let [dest (io/file media-dir "map" "approx.jpg")
        src (io/file photos-dir "location-map/approximate-location.png")]
    (when-not (.exists dest)
      (io/make-parents dest)
      (if (.exists src)
        (images/write-web-image! src dest 1200 120000)
        (images/write-solid-placeholder! dest 640 400)))))

(def ^:private stale-map-urls
  #{"/api/media/map/approx.png" "/media/map/approx.png"})

(defn- expected-full-dims
  "Pixel dimensions images/write-web-image! would produce for src, read from the
   file header without a full decode. Mirrors images/resize-to-max geometry."
  [^java.io.File src]
  (if (.exists src)
    (let [{:keys [width height]} (images/source-dimensions src)]
      (images/scaled-dimensions width height images/full-max-edge))
    {:width 2000 :height 1333})) ;; matches place-gallery-file!'s placeholder branch

(defn- gallery-row-current?
  "True when a seed row already matches a fresh seed-gallery! +
   `clojure -X:export-media` result: canonical <stem>.jpg / <stem>_thumb.jpg
   names, both files present and within the size budget, and width/height equal
   to the re-encoded full image. Keeps normalisation idempotent — a fresh DB and
   a second run do no re-encoding and no row churn."
  [row media-dir photos-dir]
  (let [st (stem (:filename row))
        [_ rel] (gallery-seed-by-stem st)]
    (boolean
     (and rel
          (= (:filename row) (str st ".jpg"))
          (= (:thumb_filename row) (str st "_thumb.jpg"))
          (let [^java.io.File full  (io/file media-dir "gallery" (:filename row))
                ^java.io.File thumb (io/file media-dir "gallery" (:thumb_filename row))
                {ew :width eh :height} (expected-full-dims (io/file photos-dir rel))]
            (and (.exists full) (.exists thumb)
                 (<= (.length full) images/full-max-bytes)
                 (<= (.length thumb) images/thumb-max-bytes)
                 (= (:width row) ew) (= (:height row) eh)
                 (let [d (images/source-dimensions full)]
                   (and d (= (:width d) ew) (= (:height d) eh)))))))))

(defn- normalize-gallery-row!
  "Re-encodes one seed row's source photo into MEDIA_DIR exactly as
   seed-gallery! does, renames the row and its files to <stem>.jpg /
   <stem>_thumb.jpg, deletes the stale old-extension files when the name
   changed, and refreshes width/height from the re-encoded full image. Returns
   :renamed, :re-encoded, or nil when the row has no known seed source."
  [db media-dir photos-dir row]
  (if-let [[_ rel] (gallery-seed-by-stem (stem (:filename row)))]
    (let [st        (stem (:filename row))
          new-base  (str st ".jpg")
          new-thumb (str st "_thumb.jpg")
          renamed?  (or (not= (:filename row) new-base)
                        (not= (:thumb_filename row) new-thumb))
          src       (io/file photos-dir rel)
          full      (io/file media-dir "gallery" new-base)
          thumb     (io/file media-dir "gallery" new-thumb)
          {:keys [width height]} (place-gallery-file! src full thumb)]
      (when (not= (:filename row) new-base)
        (.delete ^java.io.File (io/file media-dir "gallery" (:filename row))))
      (when (not= (:thumb_filename row) new-thumb)
        (.delete ^java.io.File (io/file media-dir "gallery" (:thumb_filename row))))
      (db/exec! db ["UPDATE gallery_images
                     SET filename = ?, thumb_filename = ?, width = ?, height = ?
                     WHERE id = ?"
                    new-base new-thumb width height (:id row)])
      (if renamed? :renamed :re-encoded))
    (do (log/warn "gallery seed row has no matching source, left as-is"
                  {:id (:id row) :filename (:filename row)})
        nil)))

(defn- normalize-gallery!
  "Brings every origin='seed' gallery row — the row and the files in MEDIA_DIR —
   in line with a fresh seed. Rows already in that form are left untouched."
  [db media-dir photos-dir]
  (let [rows     (db/q db ["SELECT * FROM gallery_images WHERE origin = 'seed'"])
        outcomes (doall
                  (keep (fn [row]
                          (when-not (gallery-row-current? row media-dir photos-dir)
                            (normalize-gallery-row! db media-dir photos-dir row)))
                        rows))]
    {:re-encoded (count outcomes)
     :renamed   (count (filter #{:renamed} outcomes))
     :untouched (- (count rows) (count outcomes))}))

(defn- normalize-property-media!
  "Idempotent fix-up for already-seeded deployments upgrading to the /media/ CDN
   scheme (api-contract.md 'Media URLs'):
     - the public map URL moved to /media/map/approx.jpg (.png -> .jpg); rewrite
       a known stale value, leave an owner-customised one alone;
     - every origin='seed' gallery row is re-encoded / renamed so the row and
       the files in MEDIA_DIR are identical to what a fresh seed-gallery! +
       `clojure -X:export-media` produce (<stem>.jpg / <stem>_thumb.jpg, within
       budget, real post-resize width/height).
   Safe on every boot and against a fresh DB (no-op). Returns a summary map."
  [db media-dir photos-dir]
  (let [map-rewritten?
        (boolean
         (when-let [prop (some-> (db/q1 db ["SELECT data FROM content_documents WHERE doc_key = 'property'"])
                                 :data util/<-json)]
           (when (stale-map-urls (get-in prop [:location :staticMapUrl]))
             (db/exec! db ["UPDATE content_documents SET data = ? WHERE doc_key = 'property'"
                           (util/->json (assoc-in prop [:location :staticMapUrl] "/media/map/approx.jpg"))])
             true)))
        gallery (normalize-gallery! db media-dir photos-dir)]
    (log/info "normalize-property-media!"
              {:map-url-rewritten map-rewritten?
               :gallery-seed-rows (+ (:re-encoded gallery) (:untouched gallery))
               :re-encoded (:re-encoded gallery)
               :renamed (:renamed gallery)
               :untouched (:untouched gallery)})
    {:map-url-rewritten map-rewritten? :gallery gallery}))

(defn- seed-owner! [db {:keys [admin-email admin-password admin-name]}]
  (when (and admin-password (seq admin-password))
    (when-not (db/q1 db ["SELECT id FROM admin_users WHERE email = ?" admin-email])
      (db/exec! db
                ["INSERT INTO admin_users (id, name, email, password_hash, role, status, created_at)
                  VALUES (?,?,?,?,?,?,?)"
                 (util/short-id "usr") admin-name admin-email
                 (hashers/derive admin-password) "owner" "active" (util/now-iso)])
      (log/info "Seeded initial owner account" {:email admin-email}))))

(defrecord Seeder [config db]
  component/Lifecycle
  (start [this]
    (put-content! db "property" property-content)
    (put-content! db "pricing" pricing)
    (put-content! db "vehicle" vehicle)
    (put-content! db "settings" settings)
    (seed-legal! db)
    (seed-email-templates! db)
    (let [media-dir (get-in config [:media :dir])
          photos-dir (get-in config [:seed :photos-dir])]
      (normalize-property-media! db media-dir photos-dir)
      (seed-gallery! db media-dir photos-dir)
      (seed-map! media-dir photos-dir))
    (seed-owner! db (:seed config))
    (log/info "Seed complete")
    this)
  (stop [this] this))

(defn new-seeder [] (map->Seeder {}))
