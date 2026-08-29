(ns kigali.pricing
  "Pure price calculation. The output is a structured line-item breakdown with a
   real total (authoritative-capable); v1 copy labels it an estimate."
  (:require [kigali.respond :as respond]
            [kigali.util :as util]))

(def disclaimer
  "Estimate only. The host confirms the final amount when approving your request. Car rental is paid on site.")

(defn- bad! [msg] (respond/throw-error! :validationError msg))

(defn validate-stay-dates!
  "Returns [check-in check-out nights] or throws validationError."
  [check-in check-out min-nights]
  (let [ci (util/parse-date check-in)
        co (util/parse-date check-out)]
    (when-not (and ci co) (bad! "checkIn and checkOut must be valid YYYY-MM-DD dates."))
    (when-not (.isBefore ci co) (bad! "checkOut must be after checkIn."))
    (let [nights (util/days-between ci co)]
      (when (< nights min-nights)
        (bad! (str "The minimum stay is " min-nights " nights.")))
      [ci co nights])))

(defn validate-car-dates!
  "Returns car-days or throws. pickUp/dropOff must sit within the stay."
  [pick-up drop-off ci co]
  (let [pu (util/parse-date pick-up)
        do* (util/parse-date drop-off)]
    (when-not (and pu do*) (bad! "car.pickUp and car.dropOff must be valid YYYY-MM-DD dates."))
    (when (.isBefore pu ci) (bad! "car.pickUp cannot be before checkIn."))
    (when (.isAfter do* co) (bad! "car.dropOff cannot be after checkOut."))
    (when-not (.isBefore pu do*) (bad! "car.dropOff must be after car.pickUp."))
    (util/days-between pu do*)))

(defn compute-quote
  "pricing: {:currency :nightlyRate :cleaningFee :minNights}
   vehicle: {:dailyRate ...}
   req: {:checkIn :checkOut :guests :car {:requested :pickUp :dropOff}}
   max-guests: integer.
   Returns the §4 response map. Throws validationError on rule breaches."
  [{:keys [currency nightlyRate cleaningFee minNights]} {:keys [dailyRate]} max-guests
   {:keys [checkIn checkOut guests car]}]
  (let [[ci co nights] (validate-stay-dates! checkIn checkOut minNights)
        _ (when (and guests (or (< guests 1) (> guests max-guests)))
            (bad! (str "guests must be between 1 and " max-guests ".")))
        car-requested? (boolean (:requested car))
        car-days (if car-requested?
                   (validate-car-dates! (:pickUp car) (:dropOff car) ci co)
                   0)
        accommodation (* nightlyRate nights)
        line-items (cond-> [{:code "accommodation"
                             :label (format "%s %s x %d nights" currency (str nightlyRate) nights)
                             :amount accommodation}
                            {:code "cleaningFee" :label "Cleaning fee" :amount cleaningFee}]
                     car-requested?
                     (conj {:code "carRental"
                            :label (format "%s x %d days (%s %s/day, paid on site)"
                                           "Kia Sorento" car-days currency (str dailyRate))
                            :amount (* dailyRate car-days)}))
        subtotal (reduce + 0 (map :amount line-items))]
    {:currency currency
     :nights nights
     :carDays car-days
     :lineItems line-items
     :estimatedSubtotal subtotal
     :estimatedTotal subtotal
     :disclaimer disclaimer}))

(defn quote->estimate
  "The trimmed estimate object stored on a booking / returned by booking reads:
   { currency, lineItems, estimatedTotal }."
  [q]
  {:currency (:currency q)
   :lineItems (:lineItems q)
   :estimatedTotal (:estimatedTotal q)})
