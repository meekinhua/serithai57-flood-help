"""Weather for the village with automatic warnings, built to survive shared-IP hosting.

Providers are tried in order until one answers:
  1. Open-Meteo  - free, no key, but its free tier has a DAILY quota per IP. On a hosting pod the
                   egress IP is shared with other tenants, so the quota can be gone before we ask.
  2. MET Norway  - free, no key, no per-IP daily quota (they identify apps by User-Agent).
A provider that fails is backed off (a daily-quota 429 until the next 00:00 UTC; other errors
exponentially up to 30 min) instead of being hammered every minute.

The last good result is kept in MongoDB, so a restart during an outage still has something to
show (marked stale). Stale data older than 3 h produces no warnings: a shifted forecast window
would warn about the wrong hours.

The animated wind/rain/cloud map in the app is Windy's free embed, loaded by each phone itself.
"""
import asyncio
import json
import logging
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

log = logging.getLogger("weather")

LAT, LNG = 13.7958, 100.6700  # บ้านสหกรณ์เคหะสถาน 4
BKK = timezone(timedelta(hours=7))
CACHE_S = 600  # serve from memory for 10 min
STALE_NO_ALERTS_S = 3 * 3600
HOURS = 12
# MET Norway asks every app to identify itself; override with a contact e-mail/URL if you have one.
USER_AGENT = os.environ.get("WEATHER_USER_AGENT", "serithai57-flood-help/1.0 (+https://github.com/meekinhua/serithai57-flood-help)")

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LNG}"
    "&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m"
    "&hourly=precipitation,precipitation_probability,weather_code,wind_gusts_10m"
    f"&forecast_hours={HOURS}&timezone=Asia%2FBangkok"
)
MET_URL = f"https://api.met.no/weatherapi/locationforecast/2.0/complete?lat={LAT}&lon={LNG}"

# Thresholds tuned for a village that is already flooded: more rain matters sooner than usual.
RAIN_HOUR_WARN, RAIN_HOUR_DANGER = 10.0, 20.0  # mm in one hour
RAIN_6H_WARN, RAIN_6H_DANGER = 20.0, 50.0  # mm over the next 6 hours
STEADY_RAIN_MM, STEADY_RAIN_PROB = 10.0, 80  # "rain keeps coming" warning
GUST_WARN, GUST_DANGER = 40.0, 60.0  # km/h
THUNDER = {95, 96, 99}

WMO = {
    0: ("☀️", "ท้องฟ้าแจ่มใส"), 1: ("🌤️", "มีเมฆบางส่วน"), 2: ("⛅", "มีเมฆเป็นส่วนมาก"), 3: ("☁️", "เมฆครึ้ม"),
    45: ("🌫️", "มีหมอก"), 48: ("🌫️", "หมอกน้ำค้างแข็ง"),
    51: ("🌦️", "ฝนปรอยเล็กน้อย"), 53: ("🌦️", "ฝนปรอย"), 55: ("🌧️", "ฝนปรอยหนาแน่น"),
    61: ("🌧️", "ฝนตกเล็กน้อย"), 63: ("🌧️", "ฝนตกปานกลาง"), 65: ("🌧️", "ฝนตกหนัก"),
    80: ("🌦️", "ฝนซู่เล็กน้อย"), 81: ("🌧️", "ฝนซู่ปานกลาง"), 82: ("⛈️", "ฝนซู่หนักมาก"),
    95: ("⛈️", "พายุฝนฟ้าคะนอง"), 96: ("⛈️", "พายุฝนฟ้าคะนองมีลูกเห็บ"), 99: ("⛈️", "พายุฝนฟ้าคะนองรุนแรงมีลูกเห็บ"),
}

# MET Norway symbol codes (without _day/_night) -> closest WMO code, so one describe()/alert path serves both.
MET_SYMBOL = {
    "clearsky": 0, "fair": 1, "partlycloudy": 2, "cloudy": 3, "fog": 45,
    "lightrain": 61, "rain": 63, "heavyrain": 65,
    "lightrainshowers": 80, "rainshowers": 81, "heavyrainshowers": 82,
    "lightsleet": 61, "sleet": 63, "heavysleet": 65, "lightsnow": 61, "snow": 63, "heavysnow": 65,
    "lightsleetshowers": 80, "sleetshowers": 81, "heavysleetshowers": 82,
    "lightsnowshowers": 80, "snowshowers": 81, "heavysnowshowers": 82,
}


def describe(code: int) -> tuple[str, str]:
    return WMO.get(code, ("🌡️", "ไม่ทราบสภาพอากาศ"))


def compass(deg: float) -> str:
    names = ["เหนือ", "ตะวันออกเฉียงเหนือ", "ตะวันออก", "ตะวันออกเฉียงใต้", "ใต้", "ตะวันตกเฉียงใต้", "ตะวันตก", "ตะวันตกเฉียงเหนือ"]
    return names[round((deg % 360) / 45) % 8]


def hhmm(iso_local: str) -> str:
    return iso_local[11:16]


def met_code(symbol: str) -> int:
    base = (symbol or "").split("_")[0]
    if "thunder" in base:
        return 95
    return MET_SYMBOL.get(base, 3)


def build_alerts(current: dict, hours: list[dict]) -> list[dict]:
    alerts = []
    six = hours[:6]
    storm = next((h for h in six if h["code"] in THUNDER), None)
    if current["code"] in THUNDER or storm:
        when = "ตอนนี้" if current["code"] in THUNDER else f"ประมาณ {hhmm(storm['time'])} น."
        alerts.append({"level": "danger", "icon": "⛈️", "title": f"พายุฝนฟ้าคะนอง {when}",
                       "detail": "งดออกนอกบ้าน ห้ามลุยน้ำใกล้เสาไฟ/สายไฟ ถอดปลั๊กเครื่องใช้ไฟฟ้า"})

    peak = max(six, key=lambda h: h["precip"], default=None)
    total6 = round(sum(h["precip"] for h in six), 1)
    probs = [h["prob"] for h in six if h.get("prob") is not None]
    if peak and peak["precip"] >= RAIN_HOUR_WARN:
        danger = peak["precip"] >= RAIN_HOUR_DANGER
        alerts.append({"level": "danger" if danger else "warning", "icon": "🌧️",
                       "title": f"ฝนตกหนัก {peak['precip']:.0f} มม./ชม. ช่วง {hhmm(peak['time'])} น.",
                       "detail": "ระดับน้ำอาจเพิ่มขึ้นเร็ว ยกของขึ้นที่สูง เตรียมอพยพผู้สูงอายุ/ผู้ป่วย"})
    elif total6 >= RAIN_6H_WARN:
        danger = total6 >= RAIN_6H_DANGER
        alerts.append({"level": "danger" if danger else "warning", "icon": "🌧️",
                       "title": f"ฝนสะสม 6 ชม.ข้างหน้า {total6:.0f} มม.",
                       "detail": "น้ำอาจขึ้นเพิ่ม เฝ้าระวังระดับน้ำและแจ้งในแอปถ้าน้ำขึ้น"})
    elif total6 >= STEADY_RAIN_MM and (not probs or max(probs) >= STEADY_RAIN_PROB):
        # MET Norway gives no probability here; a forecast of >=10 mm is itself the signal.
        alerts.append({"level": "warning", "icon": "🌦️", "title": f"ฝนตกต่อเนื่อง 6 ชม.ข้างหน้า (~{total6:.0f} มม.)",
                       "detail": "น้ำยังไม่น่าลดเร็ว ๆ นี้ เฝ้าระวังระดับน้ำ"})

    winds = [current.get("gust") or current["wind"]] + [h.get("gust") or 0 for h in six]
    gust = max(winds)
    if gust >= GUST_WARN:
        danger = gust >= GUST_DANGER
        kind = "ลมกระโชกแรง" if current.get("gust") else "ลมแรง"
        alerts.append({"level": "danger" if danger else "warning", "icon": "🌬️", "title": f"{kind} {gust:.0f} กม./ชม.",
                       "detail": "ระวังกิ่งไม้หัก ป้าย/สังกะสีปลิว และเสาไฟล้ม หลีกเลี่ยงการใช้เรือเล็ก"})
    order = {"danger": 0, "warning": 1}
    return sorted(alerts, key=lambda a: order[a["level"]])


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def _package(provider: str, current: dict, hours: list[dict]) -> dict:
    icon, text = describe(current["code"])
    current = {**current, "icon": icon, "text": text}
    for h in hours:
        h["icon"] = describe(h["code"])[0]
    return {
        "source": provider,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "current": current,
        "hours": hours,
        "rain_next_6h": round(sum(x["precip"] for x in hours[:6]), 1),
        "alerts": build_alerts(current, hours),
        "stale": False,
    }


def fetch_open_meteo() -> dict:
    raw = _get_json(OPEN_METEO_URL)
    c, h = raw["current"], raw["hourly"]
    current = {
        "time": c["time"], "temp": c["temperature_2m"], "humidity": c["relative_humidity_2m"], "precip": c["precipitation"],
        "code": c["weather_code"], "wind": c["wind_speed_10m"], "gust": c["wind_gusts_10m"], "wind_dir": compass(c["wind_direction_10m"]),
    }
    hours = [
        {"time": h["time"][i], "precip": h["precipitation"][i] or 0.0, "prob": h["precipitation_probability"][i],
         "code": h["weather_code"][i], "gust": h["wind_gusts_10m"][i] or 0.0}
        for i in range(min(HOURS, len(h["time"])))
    ]
    return _package("Open-Meteo", current, hours)


def fetch_met_norway() -> dict:
    raw = _get_json(MET_URL)
    now = datetime.now(timezone.utc)
    series = [
        t for t in raw["properties"]["timeseries"]
        if datetime.fromisoformat(t["time"].replace("Z", "+00:00")) >= now - timedelta(hours=1) and "next_1_hours" in t["data"]
    ][:HOURS]
    if not series:
        raise ValueError("MET Norway: no hourly data")

    def local(iso_utc: str) -> str:
        return datetime.fromisoformat(iso_utc.replace("Z", "+00:00")).astimezone(BKK).strftime("%Y-%m-%dT%H:%M")

    def gust_kmh(d: dict):
        g = d.get("wind_speed_of_gust")
        return round(g * 3.6, 1) if g is not None else None  # not provided for every location

    first = series[0]["data"]
    inst = first["instant"]["details"]
    current = {
        "time": local(series[0]["time"]), "temp": inst["air_temperature"], "humidity": round(inst.get("relative_humidity", 0)),
        "precip": first["next_1_hours"]["details"].get("precipitation_amount", 0.0),
        "code": met_code(first["next_1_hours"]["summary"]["symbol_code"]),
        "wind": round(inst["wind_speed"] * 3.6, 1), "gust": gust_kmh(inst), "wind_dir": compass(inst.get("wind_from_direction", 0)),
    }
    hours = []
    for t in series:  # starts at the current hour, like Open-Meteo
        n1 = t["data"]["next_1_hours"]
        hours.append({
            "time": local(t["time"]),
            "precip": n1["details"].get("precipitation_amount", 0.0) or 0.0,
            "prob": n1["details"].get("probability_of_precipitation"),
            "code": met_code(n1["summary"]["symbol_code"]),
            "gust": gust_kmh(t["data"]["instant"]["details"]) or 0.0,
        })
    return _package("MET Norway", current, hours)


_ALL_PROVIDERS = {"open-meteo": fetch_open_meteo, "met-norway": fetch_met_norway}
# Order/choice can be set per deployment, e.g. WEATHER_PROVIDERS=met-norway on a shared-IP host.
PROVIDERS = [
    (name, _ALL_PROVIDERS[name])
    for name in os.environ.get("WEATHER_PROVIDERS", "open-meteo,met-norway").replace(" ", "").split(",")
    if name in _ALL_PROVIDERS
] or list(_ALL_PROVIDERS.items())


def _next_utc_midnight() -> float:
    now = datetime.now(timezone.utc)
    return (datetime(now.year, now.month, now.day, tzinfo=timezone.utc) + timedelta(days=1, minutes=5)).timestamp()


def build_router(db) -> APIRouter:
    router = APIRouter(prefix="/api")
    state = {"data": None, "at": 0.0, "loaded": False}
    backoff: dict[str, dict] = {name: {"until": 0.0, "delay": 60.0, "reason": ""} for name, _ in PROVIDERS}
    lock = asyncio.Lock()

    def penalise(name: str, err: Exception):
        b = backoff[name]
        body = ""
        if isinstance(err, urllib.error.HTTPError):
            try:
                body = err.read().decode(errors="replace")
            except Exception:
                pass
        if isinstance(err, urllib.error.HTTPError) and err.code == 429 and "daily" in body.lower():
            b["until"], b["reason"] = _next_utc_midnight(), "daily quota exceeded (shared IP)"
        else:
            b["until"] = time.time() + b["delay"]
            b["reason"] = str(err)[:200]
            b["delay"] = min(b["delay"] * 2, 1800)
        log.warning("weather provider %s failed (%s); skipping until %s", name, b["reason"],
                    datetime.fromtimestamp(b["until"], timezone.utc).isoformat(timespec="minutes"))

    async def load_saved():
        if state["loaded"]:
            return
        state["loaded"] = True
        saved = await db.weather_cache.find_one({"_id": "latest"})
        if saved and not state["data"]:
            state["data"] = saved["data"]

    def with_age(data: dict) -> dict:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(data["fetched_at"])).total_seconds()
        stale = age > CACHE_S * 2
        out = {**data, "stale": stale, "age_minutes": round(age / 60)}
        if age > STALE_NO_ALERTS_S:
            out["alerts"] = []  # forecast window has moved on; don't warn about the wrong hours
        return out

    @router.get("/weather")
    async def weather():
        async with lock:  # one refresh at a time; everyone else gets the cached copy
            await load_saved()
            if state["data"] and time.monotonic() - state["at"] < CACHE_S:
                return with_age(state["data"])
            for name, fetch in PROVIDERS:
                if time.time() < backoff[name]["until"]:
                    continue
                try:
                    data = await asyncio.to_thread(fetch)
                except Exception as e:
                    penalise(name, e)
                    continue
                backoff[name].update(until=0.0, delay=60.0, reason="")
                state["data"], state["at"] = data, time.monotonic()
                await db.weather_cache.replace_one({"_id": "latest"}, {"_id": "latest", "data": data}, upsert=True)
                return with_age(data)
            # Every provider failed or is backing off: don't retry for a minute, serve what we have.
            state["at"] = time.monotonic() - CACHE_S + 60
            if state["data"]:
                return with_age(state["data"])
            return {"unavailable": True, "alerts": [], "providers": {n: b["reason"] for n, b in backoff.items()}}

    @router.get("/weather/status")
    async def weather_status():
        """For whoever runs the pod: which provider answered last and who is backing off."""
        return {
            "last_source": (state["data"] or {}).get("source"),
            "last_fetched_at": (state["data"] or {}).get("fetched_at"),
            "providers": {
                n: {"skipping_until": datetime.fromtimestamp(b["until"], timezone.utc).isoformat() if b["until"] > time.time() else None, "last_error": b["reason"] or None}
                for n, b in backoff.items()
            },
        }

    return router
