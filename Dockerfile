# Kigali Keys backend — Clojure API (reitit + ring + component, SQLite).
#
# Build context is the repo root: the app's deps.edn lives there and :paths
# points at src/backend. assets/property-photos is baked in so the first-run
# seeder can copy the gallery originals into MEDIA_DIR.
#
# The app is AOT-compiled at build time. Running `clojure -M:run` uncompiled on
# a small shared CPU took ~170s to boot (compiling every namespace from source
# on start); AOT brings cold start down to ~6s, which is what keeps it inside
# the CDN proxy's timeout. This file is deployment config only — it does not
# modify application source or deps.edn.

# ---- build: fetch deps + AOT compile ---------------------------------------
FROM clojure:temurin-21-tools-deps-bookworm AS build
WORKDIR /app

COPY deps.edn ./
RUN clojure -P

COPY src/backend ./src/backend
RUN mkdir -p classes \
 && clojure -Sdeps '{:paths ["src/backend" "src/backend/resources" "classes"]}' \
      -M -e "(compile 'kigali.main)" \
 && printf 'classes:%s' "$(clojure -Spath)" > classpath.txt

# ---- runtime: JRE only ----------------------------------------------------
FROM eclipse-temurin:21-jre-noble
WORKDIR /app

# Headless AWT (ImageIO thumbnail generation) needs these.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libfreetype6 fontconfig \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /root/.m2 /root/.m2
COPY --from=build /app/classes ./classes
COPY --from=build /app/classpath.txt ./classpath.txt
COPY --from=build /app/src/backend ./src/backend
COPY assets/property-photos ./assets/property-photos

ENV HTTP_HOST=0.0.0.0 \
    PORT=8080 \
    SEED_PHOTOS_DIR=/app/assets/property-photos \
    JAVA_TOOL_OPTIONS="-Djava.awt.headless=true -XX:MaxRAMPercentage=70 -XX:+UseSerialGC"

EXPOSE 8080
CMD ["sh", "-c", "exec java -cp \"$(cat classpath.txt)\" kigali.main"]
