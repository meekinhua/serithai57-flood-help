"""Weather for the village from Open-Meteo (free, no key), with automatic warnings.

One upstream request per 10 minutes no matter how many residents are looking;
if Open-Meteo is unreachable we keep serving the last good answer, marked stale.
The animated wind/rain/cloud map in the app is Windy's free embed (frontend only).
"""
import asyncio
import json
import logging
import time
import urllib.request
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

log = logging.getLogger("weather")

LAT, LNG = 13.7958, 100.6700  # บ้านสหกรณ์เคหะสถาน 4
CACHE_S = 600
HOURS = 12
URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LNG}"
    "&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m"
    "&hourly=precipitation,precipitation_probability,weather_code,wind_gusts_10m"
    f"&forecast_hours={HOURS}&timezone=Asia%2FBangkok"
)

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


def describe(code: int) -> tuple[str, str]:
    return WMO.get(code, ("🌡️", "ไม่ทราบสภาพอากาศ"))


def compass(deg: float) -> str:
    names = ["เหนือ", "ตะวันออกเฉียงเหนือ", "ตะวันออก", "ตะวันออกเฉียงใต้", "ใต้", "ตะวันตกเฉียงใต้", "ตะวันตก", "ตะวันตกเฉียงเหนือ"]
    return names[round((deg % 360) / 45) % 8]


def hhmm(iso_local: str) -> str:
    return iso_local[11:16]


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
    elif total6 >= STEADY_RAIN_MM and max((h["prob"] or 0) for h in six) >= STEADY_RAIN_PROB:
        alerts.append({"level": "warning", "icon": "🌦️", "title": f"ฝนตกต่อเนื่อง 6 ชม.ข้างหน้า (~{total6:.0f} มม.)",
                       "detail": "น้ำยังไม่น่าลดเร็ว ๆ นี้ เฝ้าระวังระดับน้ำ"})

    gust = max([current["gust"]] + [h["gust"] for h in six])
    if gust >= GUST_WARN:
        danger = gust >= GUST_DANGER
        alerts.append({"level": "danger" if danger else "warning", "icon": "🌬️", "title": f"ลมกระโชกแรง {gust:.0f} กม./ชม.",
                       "detail": "ระวังกิ่งไม้หัก ป้าย/สังกะสีปลิว และเสาไฟล้ม หลีกเลี่ยงการใช้เรือเล็ก"})
    order = {"danger": 0, "warning": 1}
    return sorted(alerts, key=lambda a: order[a["level"]])


def _fetch() -> dict:
    req = urllib.request.Request(URL, headers={"User-Agent": "serithai57-flood-help/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        raw = json.load(r)
    c, h = raw["current"], raw["hourly"]
    icon, text = describe(c["weather_code"])
    current = {
        "time": c["time"], "temp": c["temperature_2m"], "humidity": c["relative_humidity_2m"], "precip": c["precipitation"],
        "code": c["weather_code"], "icon": icon, "text": text,
        "wind": c["wind_speed_10m"], "gust": c["wind_gusts_10m"], "wind_dir": compass(c["wind_direction_10m"]),
    }
    hours = [
        {"time": h["time"][i], "precip": h["precipitation"][i] or 0.0, "prob": h["precipitation_probability"][i],
         "code": h["weather_code"][i], "icon": describe(h["weather_code"][i])[0], "gust": h["wind_gusts_10m"][i] or 0.0}
        for i in range(min(HOURS, len(h["time"])))
    ]
    return {
        "source": "Open-Meteo",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "current": current,
        "hours": hours,
        "rain_next_6h": round(sum(x["precip"] for x in hours[:6]), 1),
        "alerts": build_alerts(current, hours),
        "stale": False,
    }


def build_router() -> APIRouter:
    router = APIRouter(prefix="/api")
    cache: dict = {"data": None, "at": 0.0}
    lock = asyncio.Lock()

    @router.get("/weather")
    async def weather():
        async with lock:  # one upstream call at a time; everyone else gets the cached copy
            if cache["data"] and time.monotonic() - cache["at"] < CACHE_S:
                return cache["data"]
            try:
                cache["data"] = await asyncio.to_thread(_fetch)
                cache["at"] = time.monotonic()
            except Exception as e:
                log.warning("open-meteo failed: %s", e)
                if not cache["data"]:
                    raise HTTPException(503, "ดึงข้อมูลสภาพอากาศไม่ได้ชั่วคราว")
                cache["data"] = {**cache["data"], "stale": True}
                cache["at"] = time.monotonic() - CACHE_S + 60  # retry in a minute
                return cache["data"]
            return cache["data"]

    return router
