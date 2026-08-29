(ns kigali.tokens
  "Signed guest tokens for the booking status page link (P6)."
  (:require [buddy.sign.jwt :as jwt]))

(defn sign-booking-token
  "Signs a token that lets a guest open /booking/:reference without re-entering
   their email. Valid for 60 days."
  [secret reference]
  (jwt/sign {:ref reference
             :exp (+ (quot (System/currentTimeMillis) 1000) (* 60 24 60 60))}
            secret))

(defn verify-booking-token
  "Returns the booking reference the token was issued for, or nil."
  [secret token]
  (try
    (:ref (jwt/unsign token secret))
    (catch Exception _ nil)))
