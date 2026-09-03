(ns kigali.caching-test
  "Cache-Control on read-only GETs (api-contract.md 'Caching';
   engineering-standards 'Performance & delivery')."
  (:require [clojure.test :refer [deftest is testing use-fixtures]]
            [kigali.middleware :as mw]
            [kigali.test-helpers :as h :refer [request]]))

(use-fixtures :each h/with-system)

(defn- cc [resp] (get-in resp [:headers "Cache-Control"]))

(deftest cacheable-content-gets-long-swr
  (doseq [path ["/api/property" "/api/gallery" "/api/vehicle"
                "/api/documents/stayTerms/current"]]
    (let [resp (request :get path)]
      (is (= 200 (:status resp)) path)
      (is (= "public, max-age=300, stale-while-revalidate=86400" (cc resp)) path))))

(deftest availability-gets-short-max-age
  (let [resp (request :get "/api/availability" :query {:from "2026-10-01" :to "2026-10-31"})]
    (is (= 200 (:status resp)))
    (is (= "public, max-age=120" (cc resp)))))

(deftest media-is-immutable-long-cached
  (let [resp (request :get "/api/media/map/approx.jpg")]
    (is (= 200 (:status resp)))
    (is (= "public, max-age=31536000, immutable" (cc resp)))))

(deftest admin-routes-are-no-store
  (let [cookie (h/session-cookie)]
    (doseq [path ["/api/admin/bookings" "/api/admin/settings" "/api/admin/gallery"
                  "/api/admin/auth/session"]]
      (let [resp (request :get path :cookie cookie)]
        (is (= "no-store" (cc resp)) (str path " -> " (:status resp)))))))

(deftest guest-booking-lookup-is-no-store
  (let [resp (request :get "/api/bookings/KK-NOPE99" :query {:email "x@y.z"})]
    (is (= "no-store" (cc resp)))))

(deftest posts-are-no-store
  (testing "a POST never carries a cacheable header, even on validation failure"
    (let [resp (request :post "/api/quote" :body {})]
      (is (= "no-store" (cc resp))))
    (let [resp (request :post "/api/contact" :body {:name "A" :email "a@b.co"
                                                    :topic "other" :message "hello there"})]
      (is (= "no-store" (cc resp)))))
  (testing "unauthenticated admin POST is still no-store (never cached by omission)"
    (let [resp (request :post "/api/admin/gallery")]
      (is (= "no-store" (cc resp))))))

(deftest cache-control-for-is-pure-and-defaults-closed
  (is (= "no-store" (mw/cache-control-for {:request-method :get :uri "/api/admin/property"})))
  (is (= "no-store" (mw/cache-control-for {:request-method :post :uri "/api/property"})))
  (is (= "no-store" (mw/cache-control-for {:request-method :get :uri "/api/anything-new"})))
  (is (= "public, max-age=300, stale-while-revalidate=86400"
         (mw/cache-control-for {:request-method :get :uri "/api/property"}))))
