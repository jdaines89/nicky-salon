"""Usage: npm run build with NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co, then
   python scripts/ui_smoke.py out screenshots   (CHROMIUM=/path/to/chrome optional)

Drive every screen of the static build in a headless browser with Supabase
faked at the network layer (fixtures), at phone and desktop widths. Fails on
page errors, console errors, and horizontal overflow on the phone."""
import base64, functools, http.server, json, os, random, sys, threading, time, uuid
from datetime import date, timedelta, datetime, timezone
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]; SHOTS = sys.argv[2]; os.makedirs(SHOTS, exist_ok=True)
random.seed(4)
today = date.today()
def d(n): return str(today + timedelta(days=n))
cats = [("Gel Overlays", "Gel Overlay", 280, 60), ("Gel Overlays", "Gel Overlay + Removal", 300, 75),
        ("Waxing", "Brow Wax", 90, 15), ("Pedicures", "Full Pedicure", 300, 60), ("Nail Art", "Add Nail Art Per Nail", 15, 10),
        ("Packages", "Mani + Pedi Deal", 520, 120)]
services = [{"id": str(uuid.uuid4()), "category": c, "name": n, "price": p, "duration_minutes": m, "active": True, "created_at": None} for c, n, p, m in cats]
names = ["Thandi Mbeki", "Lerato Dlamini", "Zanele Khumalo", "Anne-Marie O'Brien", "Kyra", "Margaret Smith", "R&B <Nails>", "Corienne van der Merwe"]
clients = [{"id": str(uuid.uuid4()), "name": n, "phone": "082 123 45%02d" % i if i % 3 else None, "shape": "Almond", "shade": "Nude",
            "birthday": today.strftime("%m-") + "%02d" % (i + 1) if i < 3 else None, "prior_visits": [], "created_at": None} for i, n in enumerate(names)]
bookings = []
for i in range(160):
    c = random.choice(clients); s = random.choice(services[:5]); dd = random.randint(-120, 21)
    st = "confirmed" if dd < 0 else random.choice(["confirmed", "pending"])
    if dd < 0 and random.random() < 0.06: st = random.choice(["pending", "no-show", "cancelled"])
    bid = str(uuid.uuid4())
    bookings.append({"id": bid, "client_id": c["id"], "series_id": None, "date": d(dd), "time": "%02d:%s:00" % (random.randint(8, 17), random.choice(["00", "30"])),
                     "duration_minutes": s["duration_minutes"], "status": st, "discount": 0, "tip": 0, "notes": None,
                     "payment_method": random.choice([None, "cash", "card"]), "created_at": None,
                     "booking_services": [{"id": str(uuid.uuid4()), "booking_id": bid, "service_id": s["id"], "service_name": s["name"], "price_at_time": s["price"]}]})
for t in ["09:00:00", "11:30:00"]:
    c = clients[0]; s = services[0]; bid = str(uuid.uuid4())
    bookings.append({"id": bid, "client_id": c["id"], "series_id": None, "date": d(0), "time": t, "duration_minutes": 60, "status": "confirmed",
                     "discount": 0, "tip": 0, "notes": "Wants a darker shade", "payment_method": None, "created_at": None,
                     "booking_services": [{"id": str(uuid.uuid4()), "booking_id": bid, "service_id": s["id"], "service_name": s["name"], "price_at_time": s["price"]}]})
TABLES = {"clients": clients, "services": services, "bookings": bookings, "recurring_series": [], "client_photos": [], "booking_services": []}
writes = []

def handle(route, request):
    u = urlparse(request.url); path = u.path
    if path.startswith("/rest/v1/"):
        table = path.split("/")[3]
        if request.method == "GET":
            body = TABLES.get(table, [])
            if "vnd.pgrst.object" in (request.headers.get("accept") or ""): body = body[0] if body else {}
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        writes.append((request.method, table, request.post_data))
        data = json.loads(request.post_data or "{}") if request.method in ("POST", "PATCH") else {}
        row = (data[0] if isinstance(data, list) and data else data) or {}
        row = {"id": str(uuid.uuid4()), **row}
        if "vnd.pgrst.object" in (request.headers.get("accept") or ""):
            return route.fulfill(status=201, content_type="application/json", body=json.dumps(row))
        return route.fulfill(status=201, content_type="application/json", body=json.dumps([row]))
    if path.startswith("/storage/"):
        return route.fulfill(status=200, content_type="application/json", body="[]")
    if path.startswith("/auth/"):
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "u1", "email": "nicky@example.com", "aud": "authenticated"}))
    return route.fulfill(status=404, body="")

def jwt():
    b = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b"=").decode()
    exp = int(time.time()) + 36000
    return f'{b({"alg":"HS256","typ":"JWT"})}.{b({"sub":"u1","exp":exp,"role":"authenticated","email":"nicky@example.com"})}.sig'
SESSION = {"access_token": jwt(), "refresh_token": "r", "token_type": "bearer", "expires_in": 36000,
           "expires_at": int(time.time()) + 36000, "user": {"id": "u1", "email": "nicky@example.com", "aud": "authenticated", "app_metadata": {}, "user_metadata": {}}}

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=OUT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

ROUTES = ["/", "/bookings/", "/clients/", f"/clients/?id={clients[0]['id']}", "/services/", "/reports/", "/marketing/"]
failures = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)
    for label, vp in [("phone", {"width": 375, "height": 812}), ("desktop", {"width": 1280, "height": 900})]:
        ctx = b.new_context(viewport=vp)
        ctx.add_init_script(f"localStorage.setItem('sb-example-auth-token', {json.dumps(json.dumps(SESSION))})")
        ctx.route("https://example.supabase.co/**", handle)
        ctx.route("https://fonts.googleapis.com/**", lambda r, q: r.fulfill(status=200, body=""))
        for r in ROUTES:
            page = ctx.new_page(); errs = []
            page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            page.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
            page.goto(f"http://127.0.0.1:{srv.server_address[1]}" + r); page.wait_for_timeout(1800)
            ow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if label == "phone" and ow > 0: errs.append(f"horizontal overflow {ow}px")
            txt = page.inner_text("body")
            if "Loading" in txt and len(txt) < 200: errs.append("stuck loading")
            name = f"{label}_{r.strip('/').replace('/', '_').replace('?', '_').split('=')[0] or 'today'}.png"
            page.screenshot(path=os.path.join(SHOTS, name), full_page=True)
            if errs: failures.append((label, r, errs))
            print(("FAIL " if errs else "ok   ") + label, r, errs[:3])
            page.close()
        # The booking flow, tap by tap: the sheet is fixed, so these are viewport shots.
        page = ctx.new_page(); errs = []
        page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        page.goto(f"http://127.0.0.1:{srv.server_address[1]}/bookings/?new=1"); page.wait_for_timeout(1800)
        page.screenshot(path=os.path.join(SHOTS, f"{label}_sheet_1_open.png"))
        page.fill("input[aria-label='Search clients']", clients[0]["name"][:4])
        page.locator(".cp-list button.item").first.click()
        page.locator("button.sp-opt").nth(1).click()
        page.locator("button.ts-slot").nth(2).click()
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(SHOTS, f"{label}_sheet_2_filled.png"))
        page.evaluate("document.querySelector('.sheet').scrollTo(0, 99999)"); page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(SHOTS, f"{label}_sheet_3_bottom.png"))
        page.locator("button.bs-go").click(); page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(SHOTS, f"{label}_sheet_4_saved.png"))
        if page.locator(".sheet").count(): errs.append("booking sheet still open after Book")
        if errs: failures.append((label, "booking flow", errs))
        print(("FAIL " if errs else "ok   ") + label, "booking flow", errs[:3])
        page.close()
    b.close()
srv.shutdown()
sys.exit(1 if failures else 0)
