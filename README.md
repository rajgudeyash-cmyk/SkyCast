# SkyCast - Smart Weather Forecast

A mobile-first weather app: search any city in the world, see live conditions, the next 24 hours and a 7-day forecast. Built with **Python + Flask** (backend) and **HTML / CSS / JavaScript** (frontend). It is a **PWA**, so you can install it on your Android home screen.

Weather data comes from the free [Open-Meteo](https://open-meteo.com/) APIs. **No API key and no account is needed.**

## Features

- City search with suggestions, recent searches and favorites
- Current location weather (asks permission first)
- Temperature, feels-like, humidity, wind speed and direction, pressure, cloud cover, precipitation, UV index, sunrise, sunset
- Scrollable 24-hour forecast and a 7-day forecast (with UV index)
- Celsius / Fahrenheit, light / dark theme (both remembered on the device)
- Weather background animations (rain, snow, stars, clouds, sun glow, fog, lightning)
- Auto refresh every 10 minutes, plus a refresh button
- Works offline as an app shell. If you are offline it shows your last saved weather, clearly labelled as saved. It never invents data.

## Project structure

```
SkyCast/
├── app.py                 Flask server + JSON API
├── requirements.txt       Python packages
├── render.yaml            Render deployment config
├── README.md
├── .gitignore
├── templates/
│   ├── base.html          shared layout (header, menu)
│   ├── index.html         home dashboard
│   ├── favorites.html
│   └── about.html
├── static/
│   ├── css/style.css
│   ├── js/script.js
│   ├── images/            app icons (192, 512, app-icon.png)
│   ├── manifest.json      PWA manifest
│   └── service-worker.js  offline support
└── screenshots/           put your own screenshots here
```

(`base.html`, `render.yaml` and the extra icon sizes are the only additions to the structure you asked for. They are needed for a shared layout, Render, and Android install.)

---

## Part 1 - Run it on your Android phone with Termux

You do everything on the phone. You need about 300 MB of free space.

### 1. Install Termux
Install **Termux from F-Droid** (<https://f-droid.org/packages/com.termux/>). F-Droid is the recommended source. Open the page in Chrome, tap *Download F-Droid* (or *Download APK*), and allow "install unknown apps" when Android asks.

### 2. Prepare Termux
Open Termux and run these one at a time (press Enter after each). If it asks `Y/n`, type `y`.

```bash
pkg update && pkg upgrade
pkg install python unzip git
termux-setup-storage
```

`termux-setup-storage` shows an Android permission pop-up. Tap **Allow**. This lets Termux see your Downloads folder.

> Do not run `pip install --upgrade pip` in Termux. It is not needed and can break things.

### 3. Get the project into Termux
1. Download **SkyCast.zip** from this chat to your phone (it goes to *Downloads*).
2. In Termux:

```bash
cp ~/storage/downloads/SkyCast.zip ~
cd ~
unzip SkyCast.zip
cd SkyCast
```

If the file has a different name (for example `SkyCast (1).zip`), type `ls ~/storage/downloads` to see the exact name.

### 4. Install and start the app

```bash
pip install -r requirements.txt
python app.py
```

You should see `Running on http://127.0.0.1:5000`.

### 5. Open it in your browser
Open **Chrome** and go to:

```
http://localhost:5000
```

Search for a city, or tap the target icon to use your location. Chrome treats `localhost` as secure, so location, the service worker and "install" all work.

To stop the app: go back to Termux and press **Ctrl + C** (the Termux extra-keys row has a CTRL button). Swipe down the Termux notification and tap **Acquire wakelock** if Android keeps pausing it.

### Editing code later
Files live in `~/SkyCast`. Edit with `pkg install nano` then `nano static/css/style.css`. Reload the page to see changes. If an old version seems stuck, change `APP_VERSION` at the top of `app.py`, or clear the site data in Chrome.

---

## Part 2 - Upload to GitHub (from the phone)

### 1. Create a GitHub account and an empty repository
1. In Chrome go to <https://github.com> and sign up / sign in.
2. Tap the **+** at the top, choose **New repository**.
3. Name it `SkyCast`. Leave "Add a README" **unchecked**. Tap **Create repository**.

### 2. Create an access token (this is your password for pushing)
1. GitHub > your profile picture > **Settings** > **Developer settings** > **Personal access tokens** > **Tokens (classic)** > **Generate new token (classic)**.
2. Note: `termux`. Expiration: 30 days. Tick the **repo** box. Tap **Generate token**.
3. **Copy the token now** (it starts with `ghp_`). You cannot see it again. Never share it or put it in your code.

### 3. Push the code
In Termux, inside the `SkyCast` folder (replace `YOURNAME` and the email):

```bash
git config --global user.name "YOURNAME"
git config --global user.email "you@example.com"
git init
git add .
git commit -m "SkyCast first version"
git branch -M main
git remote add origin https://github.com/YOURNAME/SkyCast.git
git push -u origin main
```

When it asks **Username**, type your GitHub username. When it asks **Password**, paste the **token** (you will not see it appear; that is normal) and press Enter.

Later, after changing files: `git add . && git commit -m "describe change" && git push`.

---

## Part 3 - Deploy on Render (public website)

1. Go to <https://render.com> and sign up (use *Sign in with GitHub*).
2. Tap **New +** > **Blueprint** and connect your `SkyCast` repository. Render reads `render.yaml` and fills in everything. Tap **Apply** / **Deploy**.

   *Alternative without Blueprint:* **New +** > **Web Service** > pick the repo, then set:
   - Runtime: **Python 3**
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn app:app --workers 1 --threads 4 --timeout 30 --bind 0.0.0.0:$PORT`
   - Health check path: `/healthz`
   - Instance type: **Free**
3. Wait a few minutes for the build. When it says **Live**, Render shows your address, like `https://skycast-xxxx.onrender.com`.
4. That address is **public**. Anyone you send it to can use SkyCast.

**Free plan facts** (from Render's docs at the time of writing): the service goes to sleep after 15 minutes without visitors, and the next visit takes about a minute to wake it. Each visit after that is fast. Free instances get 750 hours per month. Every push to GitHub redeploys automatically.

---

## Part 4 - Install SkyCast on your Android home screen

1. Open your Render address (or `http://localhost:5000` while Termux is running) in **Chrome**.
2. Tap the **⋮** menu at the top right.
3. Tap **Install app** (or **Add to Home screen**) and confirm.
4. The SkyCast icon appears with your apps and opens full-screen like a normal app.

There is also an **Install SkyCast** button on the About page when Chrome allows installing.

---

## API (for reference)

All responses look like `{"ok": true, "data": ...}` or `{"ok": false, "error": {"code": "...", "message": "..."}}`.

| Endpoint | What it does |
|---|---|
| `GET /api/search?q=Paris` | Up to 6 matching cities with coordinates |
| `GET /api/weather?lat=48.85&lon=2.35` | Current weather, next 24 hours, 7 days (metric units) |
| `GET /healthz` | Health check |

The server validates input, uses request timeouts (4 s connect, 10 s read), caches results briefly (cities 1 hour, weather 2 minutes), and limits each visitor to 120 API calls per minute.

## Troubleshooting

| Problem | Fix |
|---|---|
| `pip: command not found` | Run `pkg install python` |
| Page does not open | Make sure `python app.py` is still running in Termux, and use `http://localhost:5000` |
| `Address already in use` | Another copy is running. Close it, or use `PORT=5001 python app.py` and open port 5001 |
| "Location permission denied" | Chrome > ⋮ > Settings > Site settings > Location > allow for the site |
| "Location only works on HTTPS or localhost" | Open the app through `localhost` or your Render `https://` address |
| `git push` says authentication failed | Use the **token** as the password, not your GitHub password |
| Render site is slow the first time | Normal on the free plan: it was asleep and takes about a minute to wake |
| Old design after an update | Chrome > ⋮ > Settings > Site settings > find the site > Clear & reset |

## Data, licence and limits

Weather data and city search: [Open-Meteo.com](https://open-meteo.com/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (the app credits them in the footer and About page). Open-Meteo's free service is **for non-commercial use only** and has limits of about 600 calls per minute, 5,000 per hour and 10,000 per day. If you ever want to charge for the app or show ads, you need one of their paid plans (see <https://open-meteo.com/en/pricing>).
