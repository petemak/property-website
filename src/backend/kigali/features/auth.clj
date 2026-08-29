(ns kigali.features.auth
  "§11–13 admin sessions (incl. §13b POST /admin/auth/accept-invite),
   §27 administrator accounts (owner-only).

   §13b: consumes the single-use set-password link from the §27 invite email.
   Invalid / already-used / expired token -> HTTP 410, error code `conflict`."
  (:require [buddy.hashers :as hashers]
            [kigali.db :as db]
            [kigali.features.notifications :as notify]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.util :as util]))

;; ---------------------------------------------------------------------------
;; Helpers

(defn- user->json [u]
  {:id (:id u) :name (:name u) :email (:email u) :role (:role u)
   :status (:status u) :lastLoginAt (:last_login_at u)})

(defn- public-user [u] (select-keys (user->json u) [:id :name :email :role]))

(defn- session-cookie [ctx token]
  (let [{:keys [cookie-name ttl-hours secure?]} (get-in ctx [:config :session])]
    {cookie-name {:value token
                  :path "/"
                  :http-only true
                  :secure secure?
                  :same-site :lax
                  :max-age (* ttl-hours 3600)}}))

(defn- clear-cookie [ctx]
  (let [{:keys [cookie-name secure?]} (get-in ctx [:config :session])]
    {cookie-name {:value "" :path "/" :http-only true :secure secure?
                  :same-site :lax :max-age 0}}))

(defn- create-session! [dbc user-id]
  (let [token (str (util/uuid) (util/uuid))]
    (db/exec! dbc ["INSERT INTO admin_sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)"
                   token user-id (util/now-iso) (util/plus-hours-iso (* 24 365))])
    token))

;; ---------------------------------------------------------------------------
;; §11–13

(def login-schema
  [:map [:email :string] [:password [:string {:min 1}]]])

(defn- login [ctx req]
  (let [db (:db ctx)
        {:keys [email password]} (mw/validate! login-schema (:body-params req))
        user (db/q1 db ["SELECT * FROM admin_users WHERE lower(email) = lower(?)" email])]
    (if (and user
             (= "active" (:status user))
             (:password_hash user)
             (:valid (hashers/verify password (:password_hash user))))
      (let [token (create-session! db (:id user))]
        (db/exec! db ["UPDATE admin_users SET last_login_at = ? WHERE id = ?" (util/now-iso) (:id user)])
        (-> (respond/ok {:user (public-user user)})
            (assoc :cookies (session-cookie ctx token))))
      (respond/error :unauthorized "Email or password is incorrect."))))

(defn- logout [ctx req]
  (let [db (:db ctx)
        cookie-name (get-in ctx [:config :session :cookie-name])
        token (get-in req [:cookies cookie-name :value])]
    (when (seq token)
      (db/exec! db ["DELETE FROM admin_sessions WHERE token = ?" token]))
    (-> (respond/no-content) (assoc :cookies (clear-cookie ctx)))))

(defn- session [ctx req]
  (if-let [user (mw/current-user ctx req)]
    (respond/ok {:user (select-keys user [:id :name :email :role])})
    (respond/error :unauthorized "Not signed in.")))

;; ---------------------------------------------------------------------------
;; §27 administrator accounts (owner only)

(defn- owner-count [dbc]
  (:c (db/q1 dbc ["SELECT COUNT(*) AS c FROM admin_users WHERE role = 'owner' AND status = 'active'"])))

(defn- list-users [ctx _req]
  (respond/ok {:users (mapv user->json (db/q (:db ctx) ["SELECT * FROM admin_users ORDER BY created_at"]))}))

(def user-create-schema
  [:map
   [:name [:string {:min 1 :max 120}]]
   [:email [:fn {:error/message "must be a valid email"} util/email?]]
   [:role [:enum "owner" "admin"]]])

(defn- send-invite! [ctx user invite-token]
  (notify/send-email! ctx :adminInvite (:email user)
                      {:guestFirstName (:name user)
                       :statusUrl (str "/admin/accept-invite?token=" invite-token)}))

(defn- create-user [ctx req]
  (let [db (:db ctx)
        {:keys [name email role]} (mw/validate! user-create-schema (:body-params req))]
    (when (db/q1 db ["SELECT id FROM admin_users WHERE lower(email) = lower(?)" email])
      (respond/throw-error! :conflict "A user with that email already exists."))
    (let [id (util/short-id "usr")
          invite-token (str (util/uuid) (util/uuid))]
      (db/exec! db ["INSERT INTO admin_users
                     (id, name, email, role, status, invite_token, invite_expires_at, created_at)
                     VALUES (?,?,?,?,?,?,?,?)"
                    id name email role "invited" invite-token
                    (util/plus-hours-iso 72) (util/now-iso)])
      (send-invite! ctx {:name name :email email} invite-token)
      (respond/created (user->json (db/q1 db ["SELECT * FROM admin_users WHERE id = ?" id]))))))

(def user-patch-schema
  [:map
   [:role {:optional true} [:enum "owner" "admin"]]
   [:status {:optional true} [:enum "active" "disabled"]]])

(defn- patch-user [ctx req]
  (let [db (:db ctx)
        id (get-in req [:path-params :id])
        me (get-in req [:admin-user :id])
        target (db/q1 db ["SELECT * FROM admin_users WHERE id = ?" id])
        body (mw/validate! user-patch-schema (:body-params req))]
    (when-not target (respond/throw-error! :notFound "No such user."))
    (let [last-owner? (and (= "owner" (:role target)) (= "active" (:status target)) (<= (owner-count db) 1))]
      (when (and last-owner? (or (= "admin" (:role body)) (= "disabled" (:status body))))
        (respond/throw-error! :conflict "You cannot demote or disable the last active owner."))
      (when (and (= id me) (= "disabled" (:status body)))
        (respond/throw-error! :conflict "You cannot disable your own account."))
      (let [role (or (:role body) (:role target))
            status (or (:status body) (:status target))]
        (db/exec! db ["UPDATE admin_users SET role = ?, status = ? WHERE id = ?" role status id])
        (respond/ok (user->json (db/q1 db ["SELECT * FROM admin_users WHERE id = ?" id])))))))

(defn- delete-user [ctx req]
  (let [db (:db ctx)
        id (get-in req [:path-params :id])
        me (get-in req [:admin-user :id])
        target (db/q1 db ["SELECT * FROM admin_users WHERE id = ?" id])]
    (cond
      (nil? target) (respond/error :notFound "No such user.")
      (= id me) (respond/error :conflict "You cannot delete your own account.")
      (and (= "owner" (:role target)) (= "active" (:status target)) (<= (owner-count db) 1))
      (respond/error :conflict "You cannot delete the last active owner.")
      :else (do (db/exec! db ["DELETE FROM admin_sessions WHERE user_id = ?" id])
                (db/exec! db ["DELETE FROM admin_users WHERE id = ?" id])
                (respond/no-content)))))

(defn- resend-invite [ctx req]
  (let [db (:db ctx)
        id (get-in req [:path-params :id])
        target (db/q1 db ["SELECT * FROM admin_users WHERE id = ?" id])]
    (cond
      (nil? target) (respond/error :notFound "No such user.")
      (not= "invited" (:status target)) (respond/error :conflict "That user has already accepted their invite.")
      :else
      (let [invite-token (str (util/uuid) (util/uuid))]
        (db/exec! db ["UPDATE admin_users SET invite_token = ?, invite_expires_at = ? WHERE id = ?"
                      invite-token (util/plus-hours-iso 72) id])
        (send-invite! ctx target invite-token)
        (respond/accepted {:sent true})))))

(def accept-invite-schema
  [:map [:token [:string {:min 1}]] [:password [:string {:min 10 :max 200}]]])

(defn- invite-token-problem
  "nil when the token is usable, otherwise a human message describing why not.
   A consumed token no longer matches any row (it is nulled on use), so an
   unknown token is reported as 'already used or invalid'."
  [user]
  (cond
    (nil? user) "That invite link is invalid or has already been used."
    (not= "invited" (:status user)) "That invite link has already been used."
    (or (nil? (:invite_expires_at user))
        (not (pos? (compare (:invite_expires_at user) (util/now-iso)))))
    "That invite link has expired — ask the owner to resend your invite."
    :else nil))

(defn- accept-invite [ctx req]
  (let [db (:db ctx)
        {:keys [token password]} (mw/validate! accept-invite-schema (:body-params req))
        user (db/q1 db ["SELECT * FROM admin_users WHERE invite_token = ?" token])]
    (if-let [problem (invite-token-problem user)]
      ;; Contract §13b: a spent/invalid/expired invite link -> HTTP 410, code conflict.
      (respond/error :conflict problem 410)
      (do
        (db/exec! db ["UPDATE admin_users
                       SET password_hash = ?, status = 'active', invite_token = NULL, invite_expires_at = NULL
                       WHERE id = ?"
                      (hashers/derive password) (:id user)])
        (let [tok (create-session! db (:id user))]
          (-> (respond/ok {:user (public-user user)})
              (assoc :cookies (session-cookie ctx tok))))))))

;; ---------------------------------------------------------------------------

(defn routes [ctx]
  [["/admin/auth/login"
    {:post {:handler #(login ctx %)
            :middleware [[mw/wrap-rate-limit ctx "POST /admin/auth/login"]]}}]
   ["/admin/auth/logout" {:post {:handler #(logout ctx %)}}]
   ["/admin/auth/session" {:get {:handler #(session ctx %)}}]
   ["/admin/auth/accept-invite" {:post {:handler #(accept-invite ctx %)}}]
   ["/admin/users"
    {:get {:handler #(list-users ctx %) :middleware [[mw/wrap-admin ctx true]]}
     :post {:handler #(create-user ctx %) :middleware [[mw/wrap-admin ctx true]]}}]
   ["/admin/users/:id"
    {:patch {:handler #(patch-user ctx %) :middleware [[mw/wrap-admin ctx true]]}
     :delete {:handler #(delete-user ctx %) :middleware [[mw/wrap-admin ctx true]]}}]
   ["/admin/users/:id/resend-invite"
    {:post {:handler #(resend-invite ctx %) :middleware [[mw/wrap-admin ctx true]]}}]])
