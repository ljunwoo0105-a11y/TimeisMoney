# Time is Money ⏱️💸

A tracker that makes you **feel the money cost of wasted time**. Start a timer,
label what you're doing (Instagram, gaming, YouTube, movies…), and watch the
value of your time burn away in real time — then see daily, weekly, monthly, and
yearly reports of where your hours (and your money) actually went.

The point: every hour scrolling is an hour you could have spent adding value to
your life. Seeing it in dollars makes that trade-off impossible to ignore.

Built as a **PWA** (pure HTML/CSS/JS, no build step, no server, no account).
Everything stays **on your device**. You develop it 100% on Windows and install
it to your iPhone home screen straight from Safari — no Mac, no App Store, no fee.

---

## What it does

- **Tap-to-track timer.** One tap on an activity starts the clock; the screen
  shows the money your time is worth draining away by the second. Or just hit
  the big **Start** button to begin a generic timer without picking a label.
- **Commit the money to good.** When you stop a session, choose to put that
  amount toward **📈 Invest / 🏦 Save / 💝 Donate** — your committed totals are
  summed in Reports under "♻️ Turned around," so wasted time funds something real.
- **Labels.** Presets (Instagram, TikTok, YouTube, Gaming, Movies, Social,
  Browsing) plus a custom **Other…** label for anything else.
- **Reports** — Day / Week / Month / Year, with a bar chart, a total in money +
  time, and a breakdown by activity (which habit is costing you most).
- **Nudges.** A buzz + on-screen alert each time a running timer crosses an
  amount you set (e.g. every $5). Vibration works on Android; iPhone gets a
  sound + flash (web apps can't vibrate on iOS).
- **Weekly goal + streak.** Set a weekly limit ("keep distractions under $50").
  Reports show your progress bar and a 🔥 streak of consecutive weeks you stayed
  under budget.
- **Per-activity limits.** Cap individual habits (e.g. max $15/week on gaming).
  A stronger nudge fires the moment a running timer pushes that activity over its
  weekly cap, and the weekly report flags activities that blew their limit.
- **"Saved vs your average."** A green counter rewards your better days — when
  you waste less than your usual daily amount, you see how much you "saved."
- **Turn it around.** Whenever you've wasted money, a recommendation card shows
  positive ways to put the *next* equivalent amount to work — invest it (with a
  ~7%/10yr projection), save it, donate it, or spend it on learning.
- **Penalty / premium rates.** If your time is worth more at night, on weekends,
  or on public holidays, set multipliers (e.g. night ×1.5, weekend ×1.5, weekend
  night ×2, holiday ×2.5) with custom night hours, weekend days, and a holiday
  list. Wasting time in those windows then costs proportionally more, and the
  live cost integrates exactly across rate boundaries.
- **Your time's value** is computed from your income (salary + any extra),
  either by *work hours* (what an hour of work earns — the opportunity cost) or
  spread across *all hours* (24/7).
- **Any currency** — defaults to USD; switch it anytime in Settings.
- **Accounts (sign in / sign up)** — each person gets their own password-protected
  profile and their own saved reports, or "Continue without an account" as a guest.
  Accounts are **device-local** (passwords PBKDF2-hashed in the browser; nothing
  sent to a server), so they separate people sharing a device but don't sync across
  devices — that would need a cloud backend (Supabase/Firebase), which the code is
  structured to allow later.
- **Everything saved locally**, works offline once installed.

---

## Why it can't auto-detect your apps

You asked about automatic detection — here's the honest answer. A web app
**cannot see what other apps you open**: iOS deliberately walls apps off from
each other for privacy, and a browser-based app has no access to that at all.
So you tap the activity yourself when you start.

The only thing that *could* auto-detect screen time is a **native iPhone app**
using Apple's **Screen Time / DeviceActivity** API — and even that is heavily
restricted by Apple and **requires a Mac + Xcode to build** (impossible on a
Windows-only setup). Worse, Apple hides the raw minutes even from native apps,
so you couldn't cleanly turn "47 min on Instagram" into a dollar figure anyway.
So for now, one-tap manual tracking is the best a no-Mac, install-today app can
do. The tracking itself is still 100% real.

---

## Power user: auto-start a timer with iOS Shortcuts 🔗

The app accepts deep links, so you can start/stop timers from automations:

- `https://your-site/?start=Instagram` — starts a timer labelled *Instagram*
  (presets keep their emoji; any other word becomes a 🔗 custom label).
- `https://your-site/?stop` — stops and logs the running timer.

To make opening a distracting app start its timer automatically:
1. iOS **Shortcuts** app → **Automation** → **+** → **App**.
2. Choose the app (e.g. Instagram) → **Is Opened** → **Run Immediately**.
3. Add action **Open URLs** → `https://your-site/?start=Instagram`.

**Caveats (Apple limits, not bugs):** opening the link briefly switches you to
Time is Money, and there's **no reliable "app closed" trigger**, so it can't
auto-stop — stop manually, or with a `?stop` Shortcut / Back Tap. This is the
closest thing to auto-tracking possible without a native app + a Mac.

---

## Try it on your Windows PC

```powershell
cd "C:\Users\ljunw\Documents\Time is Money"
python devserver.py          # serves http://localhost:8042 with no caching
```

`devserver.py` disables browser caching so your edits show up immediately.
(Plain `python -m http.server 8000` also works for just running it, but caches
aggressively while you edit.)

---

## Put it on your iPhone (no Mac, no App Store)

Host the folder over **HTTPS**, then add it to your home screen:

### Netlify Drop (fastest, ~2 min)
1. Go to <https://app.netlify.com/drop>.
2. Drag the **whole `Time is Money` folder** onto the page → you get an
   `https://your-name.netlify.app` URL.
3. Open that URL **in Safari on your iPhone** → **Share** → **Add to Home Screen**.

### GitHub Pages (free, permanent)
Upload the files to a repo → **Settings → Pages → Deploy from branch → main /
root** → open `https://<user>.github.io/<repo>/` in Safari → **Add to Home Screen**.

> iOS only installs (and runs offline) over a secure origin — `localhost` counts
> on your PC, but the phone needs a hosted HTTPS URL like the two above.

---

## How the cost is calculated

1. Your incomes are summed into a yearly total.
2. That becomes an **hourly value of your time**:
   - **Work hours:** `yearly ÷ (hours-per-week × 52.18)` — what an hour of work
     is worth (the opportunity cost of goofing off). *Default.*
   - **All hours:** `yearly ÷ 8766` — spread across every hour you're alive.
3. **Penalty multipliers** (if enabled) scale the rate during night / weekend /
   weekend-night / holiday windows. The live cost integrates the rate across any
   boundaries a session spans (e.g. half an hour at 1× + half at 1.5×).
4. Each tracked session stores `cost = Σ(valuePerSecond × multiplier × seconds)`,
   captured at the time, so changing your income later won't rewrite past reports.

All logic lives in [`app.js`](app.js); styling in [`styles.css`](styles.css).

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell — Timer, Reports, Settings + tab bar |
| `styles.css` | Dark, mobile-first UI |
| `app.js` | Timer, session logging, reports, time-value math |
| `manifest.webmanifest` | PWA metadata |
| `service-worker.js` | Offline support (network-first, so updates always win) |
| `devserver.py` | No-cache local dev server |
| `icons/` · `generate_icons.py` | App icon (gold `$` + clock) |

> **Note on caching:** assets are loaded as `app.js?b=2` / `styles.css?b=2`. If
> you edit those files and want a clean browser to pick them up without a hard
> refresh, bump `b=2` → `b=3` in `index.html`. (The dev server and service
> worker handle this for you in normal use.)

---

## Later (optional): a real Apple Watch app

A genuine watch app / Screen-Time auto-detection needs native **SwiftUI** +
Xcode on macOS. Good starting points if you ever get Mac access:
[aheze/Setting](https://github.com/aheze/Setting) (settings UI),
[MilanistaDev/WatchConnectivitySampleForSwiftUI](https://github.com/MilanistaDev/WatchConnectivitySampleForSwiftUI)
(iPhone↔Watch), [miniLV/Paytick](https://github.com/miniLV/Paytick) (earnings logic).
The time-value math here ports over directly.
