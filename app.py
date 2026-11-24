"""SkyCast - Flask backend.

Serves the web pages and a small JSON API that sits in front of the free
Open-Meteo Geocoding and Forecast APIs (no API key needed).

Routes
------
Pages:  /            dashboard
        /favorites   saved cities
        /about       about page
PWA:    /manifest.json, /service-worker.js
API:    /api/search?q=<city>
        /api/weather?lat=<float>&lon=<float>[&fresh=1]
Misc:   /healthz     health check (used by Render)

Every API response has the same shape:
    success -> {"ok": true,  "data": ...}
    failure -> {"ok": false, "error": {"code": "...", "message": "..."}}
"""

import logging
import math
import os
import re
import time
from collections import deque
from threading import Lock

import requests
from flask import Flask, Response, jsonify, render_template, request, send_from_directory

APP_VERSION = "1.0.0"

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# (connect timeout, read timeout) in seconds
HTTP_TIMEOUT = (4, 10)

GEO_CACHE_SECONDS = 60 * 60       # city lookups rarely change
WEATHER_CACHE_SECONDS = 2 * 60    # Open-Meteo updates "current" every ~15 min

RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "120"))

# Letters (any language), digits, spaces and a few punctuation marks used in city names.
QUERY_PATTERN = re.compile(r"^[\w\s.,'’()/\-]+$", re.UNICODE)

ON_RENDER = bool(os.environ.get("RENDER"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("skycast")

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
# Cache static files for a week in production; always revalidate while developing.
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 7 * 24 * 3600 if ON_RENDER else 0

if ON_RENDER:
    # Render puts a proxy in front of the app; trust it so rate limiting sees real client IPs.
    from werkzeug.middleware.proxy_fix import ProxyFix

    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


# --------------------------------------------------------------------------
# WMO weather codes -> (description, icon key). Icon keys are drawn by script.js.
# --------------------------------------------------------------------------
WMO_CODES = {
    0: ("Clear sky", "clear"),
    1: ("Mainly clear", "clear"),
    2: ("Partly cloudy", "partly"),
    3: ("Overcast", "cloudy"),
    45: ("Fog", "fog"),
    48: ("Freezing fog", "fog"),
    51: ("Light drizzle", "drizzle"),
    53: ("Drizzle", "drizzle"),
    55: ("Heavy drizzle", "drizzle"),
    56: ("Light freezing drizzle", "drizzle"),
    57: ("Freezing drizzle", "drizzle"),
    61: ("Light rain", "rain"),
    63: ("Rain", "rain"),
    65: ("Heavy rain", "rain"),
    66: ("Light freezing rain", "rain"),
    67: ("Freezing rain", "rain"),
    71: ("Light snow", "snow"),
    73: ("Snow", "snow"),
    75: ("Heavy snow", "snow"),
    77: ("Snow grains", "snow"),
    80: ("Light rain showers", "rain"),
    81: ("Rain showers", "rain"),
    82: ("Violent rain showers", "rain"),
    85: ("Light snow showers", "snow"),
    86: ("Heavy snow showers", "snow"),
    95: ("Thunderstorm", "thunder"),
    96: ("Thunderstorm with hail", "thunder"),
    99: ("Severe thunderstorm with hail", "thunder"),
}


def describe_code(code):
    """Return (label, icon) for a WMO weather code."""
    try:
        return WMO_CODES.get(int(code), ("Unknown", "cloudy"))
    except (TypeError, ValueError):
        return ("Unknown", "cloudy")


# --------------------------------------------------------------------------
# Small in-memory helpers: TTL cache and per-IP rate limiter.
# (Render is started with a single worker process, so these are shared.)
# --------------------------------------------------------------------------
class TTLCache:
    def __init__(self, max_items=512):
        self._items = {}
        self._lock = Lock()
        self._max = max_items

    def get(self, key):
        with self._lock:
            entry = self._items.get(key)
            if not entry:
                return None
            expires, value = entry
            if expires < time.time():
                self._items.pop(key, None)
                return None
            return value

    def set(self, key, value, ttl):
        with self._lock:
            if len(self._items) >= self._max:
                # drop the entry that expires soonest
                oldest = min(self._items, key=lambda k: self._items[k][0])
                self._items.pop(oldest, None)
            self._items[key] = (time.time() + ttl, value)


geo_cache = TTLCache()
weather_cache = TTLCache()

_hits = {}
_hits_lock = Lock()


def is_rate_limited(ip):
    now = time.monotonic()
    with _hits_lock:
        bucket = _hits.setdefault(ip, deque())
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT_PER_MINUTE:
            return True
        bucket.append(now)
        if len(_hits) > 5000:  # keep memory bounded
            for key in [k for k, v in _hits.items() if not v]:
                _hits.pop(key, None)
        return False


# --------------------------------------------------------------------------
# Errors and JSON helpers
# --------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def ok(data):
    return jsonify({"ok": True, "data": data})


def fail(status, code, message):
    response = jsonify({"ok": False, "error": {"code": code, "message": message}})
    response.status_code = status
    return response


@app.errorhandler(ApiError)
def handle_api_error(err):
    return fail(err.status, err.code, err.message)


@app.errorhandler(404)
def handle_404(_err):
    if request.path.startswith("/api/"):
        return fail(404, "not_found", "That API endpoint does not exist.")
    return Response("Page not found. <a href='/'>Go to SkyCast</a>", status=404, mimetype="text/html")


@app.errorhandler(405)
def handle_405(_err):
    return fail(405, "method_not_allowed", "That method is not allowed here.")


@app.errorhandler(500)
def handle_500(err):
    log.exception("Unhandled error: %s", err)
    if request.path.startswith("/api/"):
        return fail(500, "server_error", "Something went wrong on the server. Please try again.")
    return Response("Something went wrong. <a href='/'>Go to SkyCast</a>", status=500, mimetype="text/html")


# --------------------------------------------------------------------------
# Upstream (Open-Meteo) access
# --------------------------------------------------------------------------
def fetch_json(url, params):
    """GET a JSON document from Open-Meteo with timeouts and friendly errors."""
    try:
        resp = requests.get(
            url,
            params=params,
            timeout=HTTP_TIMEOUT,
            headers={"User-Agent": "SkyCast/%s" % APP_VERSION, "Accept": "application/json"},
        )
    except requests.exceptions.Timeout:
        raise ApiError(504, "upstream_timeout", "The weather service took too long to answer. Please try again.")
    except requests.exceptions.RequestException as exc:
        log.warning("Upstream connection problem: %s", exc)
        raise ApiError(502, "upstream_unreachable", "Could not reach the weather service. Check the connection and try again.")

    if resp.status_code == 429:
        raise ApiError(503, "upstream_busy", "The weather service is busy right now. Please try again in a minute.")
    if resp.status_code >= 400:
        reason = ""
        try:
            reason = resp.json().get("reason", "")
        except ValueError:
            pass
        log.warning("Upstream returned %s: %s", resp.status_code, reason)
        raise ApiError(502, "upstream_error", "The weather service returned an error. Please try again later.")

    try:
        return resp.json()
    except ValueError:
        raise ApiError(502, "upstream_error", "The weather service sent an unreadable response.")


def search_cities(query):
    key = query.lower()
    cached = geo_cache.get(key)
    if cached is not None:
        return cached

    raw = fetch_json(GEOCODE_URL, {"name": query, "count": 6, "language": "en", "format": "json"})
    results = []
    for item in raw.get("results") or []:
        lat, lon = item.get("latitude"), item.get("longitude")
        if lat is None or lon is None or not item.get("name"):
            continue
        results.append(
            {
                "name": item.get("name"),
                "admin1": item.get("admin1") or "",
                "country": item.get("country") or "",
                "country_code": item.get("country_code") or "",
                "latitude": round(float(lat), 4),
                "longitude": round(float(lon), 4),
                "timezone": item.get("timezone") or "",
            }
        )
    geo_cache.set(key, results, GEO_CACHE_SECONDS)
    return results


def _at(seq, index):
    """seq[index] or None when the list is missing/short."""
    try:
        return seq[index]
    except (IndexError, TypeError):
        return None


def normalize_weather(raw):
    """Turn the Open-Meteo response into the compact structure the front end uses.

    Units are metric: °C, km/h, hPa, mm, %.  The browser converts for display.
    """
    current = raw.get("current") or {}
    hourly = raw.get("hourly") or {}
    daily = raw.get("daily") or {}

    if not current or not hourly.get("time") or not daily.get("time"):
        raise ApiError(502, "upstream_error", "The weather service did not return forecast data for this place.")

    # Find the current hour inside the hourly list. Times are local "YYYY-MM-DDTHH:MM".
    times = hourly["time"]
    hour_key = str(current.get("time", ""))[:13] + ":00"
    start = 0
    for i, stamp in enumerate(times):
        if stamp >= hour_key:
            start = i
            break

    label, icon = describe_code(current.get("weather_code"))

    hours = []
    for i in range(start, min(start + 24, len(times))):
        h_label, h_icon = describe_code(_at(hourly.get("weather_code"), i))
        hours.append(
            {
                "time": times[i],
                "temp": _at(hourly.get("temperature_2m"), i),
                "precip_prob": _at(hourly.get("precipitation_probability"), i),
                "code": _at(hourly.get("weather_code"), i),
                "label": h_label,
                "icon": h_icon,
                "is_day": _at(hourly.get("is_day"), i),
            }
        )

    days = []
    for i, date in enumerate(daily["time"]):
        d_label, d_icon = describe_code(_at(daily.get("weather_code"), i))
        days.append(
            {
                "date": date,
                "code": _at(daily.get("weather_code"), i),
                "label": d_label,
                "icon": d_icon,
                "temp_max": _at(daily.get("temperature_2m_max"), i),
                "temp_min": _at(daily.get("temperature_2m_min"), i),
                "uv_max": _at(daily.get("uv_index_max"), i),
                "sunrise": _at(daily.get("sunrise"), i),
                "sunset": _at(daily.get("sunset"), i),
                "precip_sum": _at(daily.get("precipitation_sum"), i),
                "precip_prob": _at(daily.get("precipitation_probability_max"), i),
            }
        )

    today = days[0] if days else {}

    return {
        "location": {
            "latitude": raw.get("latitude"),
            "longitude": raw.get("longitude"),
            "elevation": raw.get("elevation"),
            "timezone": raw.get("timezone"),
            "utc_offset_seconds": raw.get("utc_offset_seconds", 0),
        },
        "current": {
            "time": current.get("time"),
            "temperature": current.get("temperature_2m"),
            "feels_like": current.get("apparent_temperature"),
            "humidity": current.get("relative_humidity_2m"),
            "wind_speed": current.get("wind_speed_10m"),
            "wind_direction": current.get("wind_direction_10m"),
            "pressure": current.get("pressure_msl"),
            "cloud_cover": current.get("cloud_cover"),
            "precipitation": current.get("precipitation"),
            "uv_index": _at(hourly.get("uv_index"), start),
            "is_day": current.get("is_day"),
            "code": current.get("weather_code"),
            "label": label,
            "icon": icon,
            "sunrise": today.get("sunrise"),
            "sunset": today.get("sunset"),
            "temp_max": today.get("temp_max"),
            "temp_min": today.get("temp_min"),
        },
        "hourly": hours,
        "daily": days,
        "units": {"temperature": "C", "wind": "km/h", "pressure": "hPa", "precipitation": "mm"},
        "fetched_at": int(time.time()),
    }


def get_weather(lat, lon, fresh=False):
    key = "%.3f,%.3f" % (lat, lon)
    if not fresh:
        cached = weather_cache.get(key)
        if cached is not None:
            return cached

    raw = fetch_json(
        FORECAST_URL,
        {
            "latitude": "%.3f" % lat,
            "longitude": "%.3f" % lon,
            "current": ",".join(
                [
                    "temperature_2m",
                    "relative_humidity_2m",
                    "apparent_temperature",
                    "is_day",
                    "precipitation",
                    "weather_code",
                    "cloud_cover",
                    "pressure_msl",
                    "wind_speed_10m",
                    "wind_direction_10m",
                ]
            ),
            "hourly": "temperature_2m,precipitation_probability,weather_code,is_day,uv_index",
            "daily": ",".join(
                [
                    "weather_code",
                    "temperature_2m_max",
                    "temperature_2m_min",
                    "uv_index_max",
                    "sunrise",
                    "sunset",
                    "precipitation_sum",
                    "precipitation_probability_max",
                ]
            ),
            "timezone": "auto",
            "forecast_days": 7,
        },
    )
    data = normalize_weather(raw)
    weather_cache.set(key, data, WEATHER_CACHE_SECONDS)
    return data


# --------------------------------------------------------------------------
# Request hooks
# --------------------------------------------------------------------------
@app.context_processor
def inject_globals():
    return {"app_version": APP_VERSION}


@app.before_request
def limit_api_rate():
    if request.path.startswith("/api/") and is_rate_limited(request.remote_addr or "unknown"):
        raise ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.")


@app.after_request
def add_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self), camera=(), microphone=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    )
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/favorites")
def favorites():
    return render_template("favorites.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/healthz")
def healthz():
    return jsonify({"status": "ok", "version": APP_VERSION})


# --------------------------------------------------------------------------
# PWA files (served from the site root so the service worker can control every page)
# --------------------------------------------------------------------------
@app.route("/manifest.json")
def manifest():
    response = send_from_directory(app.static_folder, "manifest.json", mimetype="application/manifest+json")
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/service-worker.js")
def service_worker():
    path = os.path.join(app.static_folder, "service-worker.js")
    with open(path, "r", encoding="utf-8") as handle:
        body = handle.read().replace("__APP_VERSION__", APP_VERSION)
    response = Response(body, mimetype="application/javascript")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Service-Worker-Allowed"] = "/"
    return response


# --------------------------------------------------------------------------
# JSON API
# --------------------------------------------------------------------------
@app.route("/api/search")
def api_search():
    query = " ".join(request.args.get("q", "").split())  # trim + collapse whitespace
    if len(query) < 2:
        raise ApiError(400, "invalid_input", "Type at least 2 letters of a city name.")
    if len(query) > 80:
        raise ApiError(400, "invalid_input", "That city name is too long.")
    if not QUERY_PATTERN.match(query):
        raise ApiError(400, "invalid_input", "City names can only contain letters, spaces and . , ' - ( ).")
    return ok({"query": query, "results": search_cities(query)})


@app.route("/api/weather")
def api_weather():
    try:
        lat = float(request.args.get("lat", ""))
        lon = float(request.args.get("lon", ""))
    except ValueError:
        raise ApiError(400, "invalid_input", "Latitude and longitude must be numbers.")
    if not (math.isfinite(lat) and math.isfinite(lon)):
        raise ApiError(400, "invalid_input", "Latitude and longitude must be real numbers.")
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        raise ApiError(400, "invalid_input", "Latitude must be -90 to 90 and longitude -180 to 180.")
    fresh = request.args.get("fresh") == "1"
    return ok(get_weather(lat, lon, fresh=fresh))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG") == "1"
    # 0.0.0.0 lets other devices on your Wi-Fi open the app; use 127.0.0.1 to keep it phone-only.
    host = os.environ.get("HOST", "127.0.0.1")
    app.run(host=host, port=port, debug=debug)
