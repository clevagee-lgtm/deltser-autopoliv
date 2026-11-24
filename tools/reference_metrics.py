"""Inspect a local engineer PDF. Print anonymous measurements, never copy the drawing."""
import argparse
import json
import math
import re
from statistics import median

import fitz


def rgb(color):
    return tuple(round(v, 2) for v in color or ())


def strip_contains(points, point):
    """Ray crossing, including a point exactly on a straight edge."""
    inside = False
    for a, b in zip(points, points[1:] + points[:1]):
        dx, dy = b.x-a.x, b.y-a.y
        if abs(dx*(point.y-a.y)-dy*(point.x-a.x)) <= 1e-8 and (
            min(a.x, b.x)-1e-8 <= point.x <= max(a.x, b.x)+1e-8 and
            min(a.y, b.y)-1e-8 <= point.y <= max(a.y, b.y)+1e-8
        ):
            return True
        if (a.y > point.y) != (b.y > point.y):
            if point.x < a.x + (point.y-a.y)*dx/dy:
                inside = not inside
    return inside


def receives_spray(point, circle):
    origin, radius, arc, start = circle
    offset = point-origin
    if abs(offset) > radius+1e-8:
        return False
    if abs(offset) <= 1e-8:
        return True
    angle = (math.degrees(math.atan2(offset.y, offset.x))-start) % 360
    return angle <= arc+1e-8 or angle >= 360-1e-8


def locate_strip_targets(strips, symbols, words):
    """Match a printed model and square nozzle symbol to a footprint anchor."""
    targets = []
    for index, strip in enumerate(strips):
        corners = strip[:4]
        if len(corners) != 4:
            continue
        edges = list(zip(corners, corners[1:] + corners[:1]))
        longest = max(abs(b-a) for a,b in edges)
        shortest = min(abs(b-a) for a,b in edges)
        midpoints = [(a+b)*.5 for a,b in edges if abs(b-a) > longest*.95]
        matches = []
        for x0,y0,x1,y1,model,*_ in words:
            if model not in {"MPLCS515", "MPRCS515", "MPSS530"}:
                continue
            anchors = midpoints if model == "MPSS530" else corners
            for symbol in symbols:
                point = (symbol.tl+symbol.br)*.5
                # Exports centre a small equipment label immediately below the symbol.
                if abs((x0+x1)*.5-point.x) > symbol.width*.25:
                    continue
                if not 0 <= y0-point.y <= symbol.height*1.5:
                    continue
                if any(abs(point-anchor) <= max(.015, shortest*.01) for anchor in anchors):
                    matches.append((model, point))
        if len(matches) == 1:
            model, point = matches[0]
            targets.append((index, model, point))
    return targets


def measure(page):
    sectors, circles, strip_count = [], [], 0
    strips = []
    square_symbols = []
    black_paths = set()
    drip_parts = []
    for d in page.get_drawings():
        items = d["items"]
        if d["type"] == "fs" and rgb(d["fill"]) == (1,1,1) and rgb(d["color"]) == (0,0,0):
            box = d["rect"]
            if box.width > 0 and .95 <= box.height/box.width <= 1.05 and (
                (len(items) == 1 and items[0][0] == 're') or
                (len(items) == 4 and all(item[0] == 'l' for item in items))
            ):
                square_symbols.append(box)
        if d["type"] == "s":
            # The reference exports stroke drip runs twice along the same geometry.
            signature = tuple(tuple(str(v) for v in item) for item in items)
            if rgb(d["color"]) == (0, 0, 0):
                black_paths.add(signature)
            elif d["dashes"] != "[] 0" and signature in black_paths:
                drip_parts.append(d)
        if rgb(d["fill"]) != (0, .46, .76) or d["fill_opacity"] != .25:
            continue
        sectors.append(d)
        curves = [it for it in items if it[0] == "c"]
        if not curves:
            strip_count += 1
            if all(item[0] == "l" for item in items):
                strips.append([item[1] for item in items] + [items[-1][2]])
            elif len(items) == 1 and items[0][0] == "re":
                box = items[0][1]
                strips.append([box.tl, box.tr, box.br, box.bl])
            continue
        if items[0][0] == "l":
            centre = items[0][1]
            radius = abs(items[0][2] - centre)
        elif len(curves) == 4:
            a, b, c = [curve[1] for curve in curves[:3]]
            u, v = b-a, c-a
            det = 2*(u.x*v.y-u.y*v.x)
            if abs(det)<1e-6:
                continue
            centre = a+fitz.Point((abs(u)**2*v.y-abs(v)**2*u.y)/det,
                                  (u.x*abs(v)**2-v.x*abs(u)**2)/det)
            radius = abs(a-centre)
        else:
            continue
        if radius <= 0:
            continue
        # CCW/CW independent sum of the short arc between successive Bezier endpoints.
        angle = 0
        for _, a, _, _, b in curves:
            u, v = a - centre, b - centre
            angle += math.degrees(math.atan2(u.x*v.y-u.y*v.x, u.x*v.x+u.y*v.y))
        start_vector = (curves[0][1] if angle >= 0 else curves[-1][4])-centre
        start = math.degrees(math.atan2(start_vector.y, start_vector.x))
        circles.append((centre, radius, abs(angle), start))
    ratios = []
    radial_reached = 0
    any_reached = 0
    for i,(centre,radius,_,_) in enumerate(circles):
        reached = any(receives_spray(centre, other) for j, other in enumerate(circles) if i != j)
        radial_reached += reached
        any_reached += reached or any(strip_contains(strip, centre) for strip in strips)
        if len(circles)>1:
            ratios.append(min(abs(centre-other[0]) for j,other in enumerate(circles) if j!=i)/radius)
    strip_targets = locate_strip_targets(strips, square_symbols, page.get_text('words'))
    strip_reached = sum(
        any(receives_spray(point, circle) for circle in circles)
        or any(strip_contains(other, point) for j,other in enumerate(strips) if i != j)
        for i, _, point in strip_targets
    )
    lines = page.get_text().splitlines()
    zones=[]
    for i,line in enumerate(lines[:-5]):
        if line in ('Дождевание','Капельная') and re.fullmatch(r'\d+шт',lines[i+1]) and lines[i+2].endswith('л/мин'):
            zones.append(dict(kind=line, consumers=int(lines[i+1][:-2]), flow=float(lines[i+2][:-5].replace(',','.'))))
    return dict(footprints=len(sectors),straight_shapes=strip_count,drip=bool(drip_parts),
                curved_drip=any(any(it[0]=='c' for it in d['items']) for d in drip_parts),
                radial=len(circles),radial_reached_by_radial=radial_reached,
                radial_reached_by_any=any_reached,straight_sources_measured=len(strips),
                straight_targets_located=len(strip_targets),straight_reached_by_any=strip_reached,
                near_quarter=sum(80<=a<=100 for _,_,a,_ in circles),
                near_half=sum(170<=a<=190 for _,_,a,_ in circles),
                near_full=sum(a>=350 for _,_,a,_ in circles),
                median_spacing_ratio=round(median(ratios),2) if ratios else None,zones=zones)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf')
    args=parser.parse_args()
    with fitz.open(args.pdf) as document:
        print(json.dumps([measure(page) for page in document],ensure_ascii=False,indent=2))
