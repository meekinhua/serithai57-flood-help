"""Split the village into zones A, B, C… for relief teams, and put a truck drop point per zone
on the main road (Seri Thai 57), where big trucks can go but the small sois can't take them.

    python make_zones.py            # writes zones.json next to this file

How: each building goes to its nearest soi; sois are ordered along the main road by where they
join it (their "mouth"); consecutive sois are grouped into zones of roughly equal house counts,
so a zone is one stretch of the main road with the sois on both sides. The drop point is the soi
mouth on the main road nearest the middle of the zone's houses. Stdlib only.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET_PER_ZONE = 170  # houses; ~one team-day of door-to-door
FAR_M = 30  # a house farther than this from its soi is "off the sois" (on an unmapped lane / a separate block)
LINK_M = 90  # off-soi houses closer than this belong to the same block (the NE block has 60–90 m gaps)
# Drop points the volunteer teams actually used on the ground (volunteer LINE group, 29 Sep 2026),
# replacing the computed "soi mouth nearest the middle of the zone". Zones not listed keep the computed one.
#   soi:   the soi mouth on the main road, or at: an exact [lat, lng] for a shop between sois
#   extra: second points in the same zone
FIELD_DROPS = {
    "A": {"soi": "5", "place": "หน้าร้านมู้ด ซอย 5 (พี่โอ)"},  # 30 Sep: moved from ปากซอย 4
    "B": {"soi": "10", "place": "ซอย 10 หน้าบ้านผึ้ง (มีโต๊ะ)"},  # 30 Sep: moved from ร้านสายชล ซ.11
    "D": {"soi": "19", "place": "ร้านเพื่อนบ้าน ปากซอย 19 (มีโต๊ะวางของ)", "extra": [{"soi": "21", "place": "บังดำ ปากซอย 21 (ร้านมอไซค์ / ลูกชิ้น)"}]},
    "E": {"soi": "28", "place": "ปากซอย 28 (ดูแลซอย 22–33)"},
    # 30 Sep 09:26: F split off to พี่ไจ๋ at ปากซอย 32; G·H stay at ร้านไอซ์มาร์ท — the main point where big trucks unload,
    # covering from the shop to ซอย 67
    "F": {"soi": "32", "place": "ปากซอย 32 บ้านหัวมุม ริมถนนหลัก (พี่ไจ๋)"},
    "G": {"at": [13.797297, 100.669162], "soi": "34–36", "place": "ร้านไอซ์มาร์ท ระหว่างซอย 34–36 (จุดหลัก G·H · รถใหญ่ลงที่นี่)"},
    "H": {"same_as": "G"},
    "I": {"soi": "71", "place": "Triple wood ซอย 71 (จุดหลักท้ายหมู่บ้าน)"},
}
COLORS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#9333ea", "#0891b2", "#ea580c", "#4f46e5", "#65a30d", "#db2777", "#0d9488", "#b45309"]

KX = 111320 * math.cos(math.radians(13.8))
KY = 110540


def xy(p):
    return (p[1] * KX, p[0] * KY)


def seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = xy(p), xy(a), xy(b)
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def soi_key(s):
    a, _, b = s.partition("/")
    return (int(a), int(b or 0))


def main():
    sois = json.loads((HERE / "sois.json").read_text(encoding="utf-8"))["sois"]
    buildings = json.loads((HERE / "buildings.json").read_text(encoding="utf-8"))["buildings"]

    # 1. main-road axis: principal direction of all soi geometry (the village is a long strip along it)
    pts = [xy(p) for s in sois.values() for ln in s["lines"] for p in ln]
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(ang), math.sin(ang)  # along the road
    along = lambda p: (xy(p)[0] - mx) * ux + (xy(p)[1] - my) * uy  # noqa: E731
    across = lambda p: -(xy(p)[0] - mx) * uy + (xy(p)[1] - my) * ux  # noqa: E731

    # 2. soi mouth = the end of the soi closest to the road axis (sois hang off both sides of it)
    mouths = {}
    for name, s in sois.items():
        ends = [ln[0] for ln in s["lines"]] + [ln[-1] for ln in s["lines"]]
        mouths[name] = min(ends, key=lambda p: abs(across(p)))
    # main road polyline through the mouths, ordered along the axis, lightly smoothed
    order = sorted(sois, key=lambda n: along(mouths[n]))
    if soi_key(order[0]) > soi_key(order[-1]):  # letter zones from soi 1 (the entrance end)
        order.reverse()
    road = [mouths[n] for n in order]
    smooth = []
    for i in range(len(road)):
        w = road[max(0, i - 2): i + 3]
        smooth.append([round(sum(p[0] for p in w) / len(w), 6), round(sum(p[1] for p in w) / len(w), 6)])

    # 3. houses per soi (nearest soi segment)
    segs = [(n, ln[i], ln[i + 1]) for n, s in sois.items() for ln in s["lines"] for i in range(len(ln) - 1)]
    count = {n: 0 for n in sois}
    home = []  # (building, soi)
    for b in buildings:
        best = min(segs, key=lambda s: seg_dist(b, s[1], s[2]))[0]
        count[best] += 1
        home.append((b, best))
    total = sum(count.values())
    n_zones = max(2, round(total / TARGET_PER_ZONE))
    per = total / n_zones

    # 4. consecutive sois along the road → zones with about `per` houses each
    zones, cur, acc = [], [], 0
    for n in order:
        cur.append(n)
        acc += count[n]
        if acc >= per * (len(zones) + 1) - count[n] / 2 and len(zones) < n_zones - 1:
            zones.append(cur)
            cur = []
    if cur:
        zones.append(cur)

    # 5. houses well away from every soi (e.g. the block north-east of the main road) are reached as one
    # group, not soi by soi: keep each such block together in its majority zone instead of splitting
    # it between the zones of whichever soi happens to be nearest.
    zone_i = {n: i for i, names in enumerate(zones) for n in names}
    # zone boundaries as cut points on the main road itself: position = distance along the (curved)
    # road to the nearest point of it. A straight axis misplaces houses far from a bend.
    rxy = [xy(p) for p in smooth]
    cum = [0.0]
    for i in range(len(rxy) - 1):
        cum.append(cum[-1] + math.hypot(rxy[i + 1][0] - rxy[i][0], rxy[i + 1][1] - rxy[i][1]))

    def arc(p):
        px, py = xy(p)
        best = (float("inf"), 0.0)
        for i in range(len(rxy) - 1):
            (ax, ay), (bx, by) = rxy[i], rxy[i + 1]
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d < best[0]:
                best = (d, cum[i] + t * math.sqrt(L2))
        return best[1]

    cuts = [(max(arc(mouths[n]) for n in zones[i]) + min(arc(mouths[n]) for n in zones[i + 1])) / 2 for i in range(len(zones) - 1)]
    band = lambda p: sum(1 for c in cuts if arc(p) > c)  # noqa: E731
    hz = [zone_i[n] for _, n in home]
    far = [k for k, (b, n) in enumerate(home) if min(seg_dist(b, s[1], s[2]) for s in segs if s[0] == n) > FAR_M]
    parent = {k: k for k in far}

    def root(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    for i, a in enumerate(far):
        for b in far[i + 1:]:
            pa, pb = xy(home[a][0]), xy(home[b][0])
            if math.hypot(pa[0] - pb[0], pa[1] - pb[1]) <= LINK_M:
                parent[root(a)] = root(b)
    blocks = {}
    for k in far:
        blocks.setdefault(root(k), []).append(k)
    for ks in blocks.values():
        if len(ks) < 5:  # a few stray houses: the zone of the stretch of main road they face
            for k in ks:
                hz[k] = band(home[k][0])
            continue
        votes = {}
        for k in ks:
            votes[hz[k]] = votes.get(hz[k], 0) + 1
        best = max(votes, key=votes.get)
        for k in ks:
            hz[k] = best

    out = []
    for i, names in enumerate(zones):
        letter = chr(ord("A") + i)
        houses = sum(1 for z in hz if z == i)
        # drop point: the soi mouth nearest the middle (by houses) of the zone, on the main road
        mid_along = sum(along(mouths[n]) * count[n] for n in names) / max(1, sum(count[n] for n in names))
        drop_soi = min(names, key=lambda n: abs(along(mouths[n]) - mid_along))
        fd = FIELD_DROPS.get(letter, {})
        fd = FIELD_DROPS[fd["same_as"]] if "same_as" in fd else fd
        if "at" in fd:
            dp, drop_soi = fd["at"], fd["soi"]
        elif "soi" in fd:
            drop_soi = fd["soi"]
            dp = mouths[drop_soi]
        else:
            dp = mouths[drop_soi]
        place = fd.get("place", f"ปากซอย {drop_soi}")
        root = FIELD_DROPS.get(letter, {}).get("same_as", letter)  # zones sharing one drop point
        shared = [chr(ord("A") + j) for j in range(len(zones)) if FIELD_DROPS.get(chr(ord("A") + j), {}).get("same_as", chr(ord("A") + j)) == root]
        zb = [b for k, (b, n) in enumerate(home) if hz[k] == i]
        # label spot: middle of the houses on the busier side of the road, so it doesn't sit under the drop pin
        road_side = lambda p: across(p) - across(dp)  # noqa: E731
        side = [p for p in zb if road_side(p) > 0]
        other = [p for p in zb if road_side(p) <= 0]
        pick = side if len(side) >= len(other) else other
        pick = pick or zb or [dp]
        cy = sum(p[0] for p in pick) / len(pick)
        cx = sum(p[1] for p in pick) / len(pick)
        out.append({
            "id": letter, "color": COLORS[i % len(COLORS)], "sois": sorted(names, key=soi_key), "houses": houses,
            "center": [round(cy, 6), round(cx, 6)],
            "drop": {"lat": round(dp[0], 6), "lng": round(dp[1], 6), "soi": drop_soi, "place": place, "shared": shared,
                     "label": f"จุดลงของ {'·'.join(shared)} · {place}",
                     "extra": [{**x, "lat": round(mouths[x["soi"]][0], 6), "lng": round(mouths[x["soi"]][1], 6)} for x in fd.get("extra", [])]},
        })
        print(f"{letter}: {houses:4d} บ้าน · ซอย {', '.join(sorted(names, key=soi_key))} · จุดลงของ {place}")

    zone_of = {n: z["id"] for z in out for n in z["sois"]}
    idx = {z["id"]: i for i, z in enumerate(out)}
    data = {"source": "sois.json + buildings.json (© OpenStreetMap contributors, ODbL)", "generated_by": "make_zones.py",
            "target_per_zone": TARGET_PER_ZONE, "total_houses": total, "main_road": smooth, "zones": out,
            "soi_zone": zone_of,
            # every house as [lat, lng, zone index] so maps can colour them
            "houses": [[round(b[0], 6), round(b[1], 6), hz[k]] for k, (b, n) in enumerate(home)]}
    (HERE / "zones.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"{len(out)} โซน · {total} บ้าน")


if __name__ == "__main__":
    main()
