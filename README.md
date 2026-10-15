# Wasatch Barber Co. website + online booking

A barber shop website with online booking and an owner admin page. Bookings go straight onto the owner's Google Calendar.

| File | What it is |
|---|---|
| `index.html` | The public website with online booking |
| `admin.html` | The owner's admin page: bookings, services and prices, barbers, hours, days off, shop info, password |
| `styles.css`, `api.js` | Shared styles and the code that talks to the booking backend |
| `config.js` | Where you paste your Apps Script web app URL |
| `apps-script/Code.gs` | The backend. It runs in Google Apps Script, not on GitHub |

**Cost: $0.** GitHub Pages, Apps Script and Google Calendar are free. A custom domain (optional) is about $10–$20 a year.

**Starting admin password: `demodemo`.** Change it on the admin page's **Account** tab after you first sign in. This repository is public, so anyone can read the starting password here.

Do the Google steps from the **shop owner's Google account**, since that's whose calendar gets the bookings.

---

## Part 1: Set up the Apps Script (about 10 minutes)

### 1. Open the project
- Go to **script.google.com** and check the account picture in the top right is the shop's Google account.
- If you already have a **Barber booking** project, open it. Otherwise click **New project**, then click **Untitled project** at the top and rename it **Barber booking**.

### 2. Paste in the code
- Click **Code.gs** on the left.
- Click inside the code, press **Ctrl+A** (Cmd+A on Mac) to select everything, and delete it.
- Open `apps-script/Code.gs` from this project, copy all of it, and paste it in.
- Press **Ctrl+S** (Cmd+S) to save. You should see "Saved to Drive" at the top.

### 3. Check the time zone
- Click the **gear icon** (Project Settings) on the far left.
- Make sure **Time zone** is the shop's zone. For Utah, that's **(GMT-06:00) Mountain Time – Denver**.
- Click the **< >** icon on the left to go back to the code.

### 4. Run setup and allow access
- In the toolbar above the code, make sure the dropdown next to **Debug** says **setup**, then click **Run**.
- A box says **Authorization required**. Click **Review permissions** and pick the shop's Google account.
- If you see **"Google hasn't verified this app,"** click **Advanced**, then **Go to Barber booking (unsafe)**. This shows for any script you write yourself.
- Check the list. It should ask to manage your Google Calendar and send email as you. Click **Allow** (or **Continue**).
- The **Execution log** opens at the bottom. It should end with **"Setup complete. Now deploy as a web app."**
- If it shows an error instead, click **Run** again. The first run sometimes stops right after permissions are granted.

### 5. Deploy it as a web app
- Click the blue **Deploy** button (top right), then **New deployment**.
- Click the **gear icon** next to "Select type" and choose **Web app**.
- Fill in:
  - **Description:** Booking site (anything works)
  - **Execute as:** Me (your email)
  - **Who has access:** Anyone
- Click **Deploy**. If Google asks for access again, allow it the same way as step 4.
- Copy the **Web app URL**. It starts with `https://script.google.com/macros/s/` and ends with `/exec`.
- To check it works, open that URL in a new tab. You should see `{"ok":true,"service":"barber-booking","version":1}`.

### 6. Connect the website to it
Open `config.js` in any text editor (Notepad, TextEdit) and paste the URL between the quotes:

```js
window.BOOKING_API_URL = "https://script.google.com/macros/s/AKfy.../exec";
```

Save the file. This URL isn't a secret. It only does what the public website already does.

If you leave it empty, the site runs in **demo mode** with a blue bar at the top. Bookings stay in the visitor's browser only, and the admin password is `demodemo`.

---

## Part 2: Put the site on GitHub Pages (about 5 minutes)

1. Sign in at **github.com** → **+** (top right) → **New repository**.
2. Name it, e.g. `wasatch-barber`. Choose **Public** (free accounts need a public repository for Pages). Click **Create repository**.
3. Click **uploading an existing file**. Drag in `index.html`, `admin.html`, `styles.css`, `api.js`, `config.js`, `README.md`, and the `apps-script` folder. Make sure `index.html` sits at the top level, not inside a folder. Click **Commit changes**.
4. Go to **Settings** → **Pages**. Under "Build and deployment," set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, then **Save**.
5. After a minute or two, refresh the Pages settings. Your live address appears at the top: `https://YOUR-USERNAME.github.io/wasatch-barber/`
   - Admin page: add `admin.html` to the end, or click **Owner login** at the bottom of the site.

**Updating later:** open a file on GitHub, click the pencil icon, edit, and **Commit changes**. Changes go live in a minute or two. If you still see the old version, hard-refresh (Ctrl+Shift+R, or Cmd+Shift+R on Mac).

**Custom domain (optional):** buy one from any registrar, add it under **Settings → Pages → Custom domain**, follow GitHub's DNS instructions, and tick **Enforce HTTPS** once it's available.

---

## Part 3: Set up the shop and test

1. Open the admin page and sign in with **`demodemo`**.
2. Go to the **Account** tab and change the password to one only you know.
3. Work through the other tabs, then click **Save changes**:
   - **Services & prices:** names, prices, lengths, and whether each can be booked online.
   - **Barbers:** names, bios, which Google Calendar their bookings go on, and regular days off.
   - **Hours:** weekly hours, time between start times, how far ahead people can book, and minimum notice.
   - **Days off:** holidays (whole shop) or vacations (one barber).
   - **Shop info:** name, address, phone, email, home-page intro, and new-booking email alerts.
4. Make a test booking on the site with your own email. Check that:
   - it appears on Google Calendar,
   - the confirmation email arrives (and the owner alert, if it's on),
   - it shows on the admin **Bookings** tab.
5. Cancel it from the Bookings tab, and check that the time opens up again on the site.

---

## Day-to-day use

- **New bookings** appear on the barber's Google Calendar within seconds.
- **Moving a booking:** drag it in Google Calendar. The site and admin page pick it up automatically. Call the customer to let them know.
- **Blocking time** (lunch, an errand): add an event to that barber's calendar.
- **Cancelling:** use **Cancel** on the Bookings tab. It removes the event, frees the slot, and can email the customer. Deleting the event straight from Google Calendar frees the slot but sends no email.
- **Security:** the admin page signs out after 15 minutes without activity, with a one-minute warning. After 10 wrong passwords it locks for 10 minutes.
- **Forgot the password?** Run **setup** again in the Apps Script editor. It resets the password to `demodemo` and keeps all your settings.

## Separate calendars per barber (optional)

Anything on a barber's calendar blocks that barber's time on the site. If all barbers share one calendar, a personal event blocks *everyone* at that time. To avoid that, in Google Calendar click **+** next to "Other calendars" → **Create new calendar**, make one per barber, then pick each barber's calendar on the admin **Barbers** tab and save.

## Updating the Apps Script code

After changing the code in the Apps Script editor: **Deploy** → **Manage deployments** → pencil icon → **Version: New version** → **Deploy**. This keeps the same URL. A brand-new deployment gives you a new URL that you'd have to paste into `config.js` again.

## Limits to know about

- Free Gmail accounts send about **100 emails a day** (Google Workspace: 1,500). Each booking sends up to two. If the limit is hit, bookings still work and only the emails are skipped.
- Apps Script usually answers in 1–3 seconds, so "Checking open times…" may show briefly.
- Customers can't cancel online. Their confirmation email tells them to call the shop.
- GitHub's guidelines say Pages isn't meant as free hosting for sites focused mainly on commercial transactions. This site takes no payments and its bookings run through Google, but if GitHub ever asks you to move, Cloudflare Pages and Netlify both host these same files for free.

## Troubleshooting

| Problem | Fix |
|---|---|
| Site shows the blue "Demo mode" bar | `config.js` has no URL, or GitHub hasn't updated yet. Check the file on GitHub and hard-refresh. |
| "Couldn't reach the booking system" | The URL in `config.js` should end in `/exec`, and the deployment's access should be **Anyone**. |
| "The booking system sent back something unexpected" | The deployment is set to "Only myself" or "Anyone with Google account". Edit it to **Anyone**. |
| "No admin password set yet" | Run **setup** in the Apps Script editor (Part 1, step 4). |
| `demodemo` doesn't work | It only works until you change it, or if setup hasn't run. Run **setup** again to reset it. |
| A barber shows no times | Check their days off, the Days off tab, and their calendar for all-day events (those block the whole day). |
| Times are off by an hour or more | Set the script's time zone (Part 1, step 3), then deploy a new version. |
| "Can't find the calendar for …" | That calendar was deleted or unshared. Pick another on the Barbers tab and save. |
| GitHub page shows 404 | Wait two minutes after turning on Pages, and make sure `index.html` is at the top level of the repo. |
