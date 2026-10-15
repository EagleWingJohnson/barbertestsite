/**
 * Barber shop booking backend — Google Apps Script
 *
 * Runs from the shop owner's Google account. It:
 *   - stores the shop's settings (services, barbers, hours, days off, contact info)
 *   - works out open time slots by reading each barber's Google Calendar
 *   - puts every new booking straight onto that calendar
 *   - powers the owner's admin page (sign-in, bookings list, cancellations, settings)
 *   - emails customers a confirmation (and a notice if a booking is cancelled)
 *
 * Setup is in README.md. In short: run "setup" once,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

// Starting password for the admin page, set when you run setup().
// This file is public on GitHub, so after you first sign in, change it on the admin page
// (Account > Change password). Running setup() again resets it to this value.
const INITIAL_ADMIN_PASSWORD = 'demodemo';

const PROPS = PropertiesService.getScriptProperties();
const CACHE = CacheService.getScriptCache();
const SESSION_SECONDS = 15 * 60;       // admin is signed out after 15 minutes without activity
const MAX_FAILED_LOGINS = 10;          // per 10 minutes, across all visitors

const DEFAULT_SETTINGS = {
  shop: {
    name: 'Wasatch Barber Co.',
    about: 'Classic and modern cuts, straight-razor shaves and beard work from barbers who take their time. Book online in under a minute.',
    phone: '(801) 555-0100',
    email: 'hello@wasatchbarber.example',
    address: '214 E Main Street',
    city: 'Your City, ST 00000',
    notifyOwner: true,
    ownerEmail: ''
  },
  services: [
    { id: 'cut',   name: 'Classic Cut',          price: 35, dur: 30, desc: 'Scissor or clipper cut, wash and style.', active: true },
    { id: 'fade',  name: 'Skin Fade',            price: 40, dur: 45, desc: 'Detailed fade, foil-finish blend, line-up.', active: true },
    { id: 'beard', name: 'Beard Trim',           price: 20, dur: 20, desc: 'Shape, line-up and hot towel.', active: true },
    { id: 'shave', name: 'Straight-Razor Shave', price: 38, dur: 40, desc: 'Hot lather, two passes, cold towel finish.', active: true },
    { id: 'combo', name: 'Cut + Beard',          price: 52, dur: 60, desc: 'Any cut plus a full beard trim.', active: true },
    { id: 'kids',  name: "Kids' Cut",            price: 25, dur: 30, desc: 'Ages 12 and under.', active: true }
  ],
  barbers: [
    { id: 'marco', name: 'Marco R.',    init: 'MR', bio: 'Owner. 15 years behind the chair. Fades and tapers.', calendarId: 'primary', daysOff: [1], active: true },
    { id: 'dee',   name: 'Dee Alvarez', init: 'DA', bio: 'Scissor work and longer styles. Textured hair specialist.', calendarId: 'primary', daysOff: [2], active: true },
    { id: 'tom',   name: 'Tom Becker',  init: 'TB', bio: 'Straight-razor shaves and beard sculpting.', calendarId: 'primary', daysOff: [3], active: true }
  ],
  // Keyed by weekday (0 = Sunday). [open, close] in minutes after midnight, or null when closed.
  hours: { '0': null, '1': [540, 1140], '2': [540, 1140], '3': [540, 1140], '4': [540, 1200], '5': [540, 1200], '6': [480, 960] },
  slotStep: 30,     // minutes between start times
  windowDays: 21,   // how far ahead customers can book
  minNotice: 60,    // minutes of notice required
  closures: []      // { id, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', barberId: '' (whole shop) or barber id, note }
};

/* ------------------------------------------------------------------ */
/* One-time setup — run this from the editor                           */
/* ------------------------------------------------------------------ */

function setup() {
  if (!INITIAL_ADMIN_PASSWORD || INITIAL_ADMIN_PASSWORD.length < 8) {
    throw new Error('Set INITIAL_ADMIN_PASSWORD (8+ characters) at the top of Code.gs, then run setup again.');
  }
  setPassword_(INITIAL_ADMIN_PASSWORD);
  if (!PROPS.getProperty('settings')) {
    const s = clone_(DEFAULT_SETTINGS);
    s.shop.ownerEmail = Session.getEffectiveUser().getEmail();
    PROPS.setProperty('settings', JSON.stringify(s));
  }
  // Touch the services so Google asks for permission now, not on the first booking.
  Logger.log('Default calendar: ' + CalendarApp.getDefaultCalendar().getName());
  Logger.log('Emails left today: ' + MailApp.getRemainingDailyQuota());
  Logger.log('Time zone: ' + Session.getScriptTimeZone());
  Logger.log('Setup complete. Now deploy as a web app.');
}

/* ------------------------------------------------------------------ */
/* Web app entry points                                                */
/* ------------------------------------------------------------------ */

function doGet() {
  return respond_(() => ({ ok: true, service: 'barber-booking', version: 1 }));
}

function doPost(e) {
  return respond_(() => {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return handle_(req);
  });
}

function respond_(fn) {
  let out;
  try { out = fn(); }
  catch (err) { out = { error: (err && err.message) || String(err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  switch (req.action) {
    case 'getConfig':  return publicConfig_();
    case 'getSlots':   return { slots: computeSlots_(req.date, req.serviceId, req.barberId || 'any') };
    case 'book':       return book_(req);
    case 'adminLogin': return adminLogin_(req.password);
  }

  requireAdmin_(req.token);
  switch (req.action) {
    case 'adminGetAll':
      return { settings: getSettings_(), calendars: listCalendars_(), timezone: Session.getScriptTimeZone() };
    case 'adminSave':
      return { settings: saveSettings_(req.settings) };
    case 'adminBookings':
      return { bookings: listBookings_(req.from, req.to) };
    case 'adminCancel':
      return cancelBooking_(req);
    case 'adminPing':
      return { ok: true };
    case 'adminChangePassword':
      checkPassword_(req.currentPassword, 'Your current password isn\'t right.');
      if (!req.newPassword || String(req.newPassword).length < 8) throw new Error('Use a password with at least 8 characters.');
      setPassword_(String(req.newPassword));
      return { ok: true };
    case 'adminLogout':
      CACHE.remove('tok_' + req.token);
      return { ok: true };
  }
  throw new Error('Unknown request.');
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function getSettings_() {
  const raw = PROPS.getProperty('settings');
  return raw ? JSON.parse(raw) : clone_(DEFAULT_SETTINGS);
}

function publicConfig_() {
  const s = getSettings_();
  return {
    shop: { name: s.shop.name, about: s.shop.about, phone: s.shop.phone, email: s.shop.email, address: s.shop.address, city: s.shop.city },
    services: s.services.filter(x => x.active !== false).map(x => ({ id: x.id, name: x.name, price: x.price, dur: x.dur, desc: x.desc })),
    barbers: s.barbers.filter(b => b.active !== false).map(b => ({ id: b.id, name: b.name, init: b.init, bio: b.bio, daysOff: b.daysOff || [] })),
    hours: s.hours,
    slotStep: s.slotStep,
    windowDays: s.windowDays,
    minNotice: s.minNotice,
    closures: s.closures.map(c => ({ start: c.start, end: c.end, barberId: c.barberId || '' })),
    today: fmt_(new Date(), 'yyyy-MM-dd'),
    timezone: Session.getScriptTimeZone()
  };
}

function saveSettings_(input) {
  if (!input || typeof input !== 'object') throw new Error('Nothing to save.');
  const s = {
    shop: {
      name: clean_(input.shop && input.shop.name, 80) || 'Barber Shop',
      about: clean_(input.shop && input.shop.about, 400),
      phone: clean_(input.shop && input.shop.phone, 40),
      email: clean_(input.shop && input.shop.email, 120),
      address: clean_(input.shop && input.shop.address, 120),
      city: clean_(input.shop && input.shop.city, 120),
      notifyOwner: !!(input.shop && input.shop.notifyOwner),
      ownerEmail: clean_(input.shop && input.shop.ownerEmail, 120)
    },
    services: (input.services || []).map(x => {
      const name = clean_(x.name, 60);
      if (!name) throw new Error('Every service needs a name.');
      const price = Number(x.price), dur = Math.round(Number(x.dur));
      if (!(price >= 0)) throw new Error('Check the price for ' + name + '.');
      if (!(dur >= 5 && dur <= 480)) throw new Error('Check the length of ' + name + '.');
      return { id: cleanId_(x.id) || newId_(name), name: name, price: price, dur: dur, desc: clean_(x.desc, 200), active: x.active !== false };
    }),
    barbers: (input.barbers || []).map(b => {
      const name = clean_(b.name, 60);
      if (!name) throw new Error('Every barber needs a name.');
      return {
        id: cleanId_(b.id) || newId_(name), name: name, init: clean_(b.init, 3) || initials_(name), bio: clean_(b.bio, 200),
        calendarId: clean_(b.calendarId, 200) || 'primary',
        daysOff: (b.daysOff || []).map(Number).filter(d => d >= 0 && d <= 6),
        active: b.active !== false
      };
    }),
    hours: {},
    slotStep: clampInt_(input.slotStep, 5, 120, 30),
    windowDays: clampInt_(input.windowDays, 1, 120, 21),
    minNotice: clampInt_(input.minNotice, 0, 10080, 60),
    closures: (input.closures || []).map(c => {
      if (!isYmd_(c.start) || !isYmd_(c.end) || c.end < c.start) throw new Error('Check the dates on your days off.');
      return { id: cleanId_(c.id) || newId_('off'), start: c.start, end: c.end, barberId: cleanId_(c.barberId), note: clean_(c.note, 80) };
    })
  };
  for (let d = 0; d < 7; d++) {
    const h = input.hours && input.hours[String(d)];
    if (!h) { s.hours[String(d)] = null; continue; }
    const open = Math.round(Number(h[0])), close = Math.round(Number(h[1]));
    if (!(open >= 0 && close <= 1440 && close > open)) throw new Error('Closing time must be after opening time.');
    s.hours[String(d)] = [open, close];
  }
  // Check every barber's calendar exists before saving.
  s.barbers.forEach(b => getCal_(b.calendarId, b.name));
  const json = JSON.stringify(s);
  if (json.length > 9000) throw new Error('Too many settings to store. Remove old days off or unused services.');
  PROPS.setProperty('settings', json);
  return s;
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

function computeSlots_(dateStr, serviceId, barberId, settings) {
  const s = settings || getSettings_();
  if (!isYmd_(dateStr)) throw new Error('Pick a valid date.');
  const svc = s.services.find(x => x.id === serviceId && x.active !== false);
  if (!svc) throw new Error('That service is no longer offered. Refresh the page and pick another.');

  const today = fmt_(new Date(), 'yyyy-MM-dd');
  const lastDay = fmt_(new Date(Date.now() + s.windowDays * 864e5), 'yyyy-MM-dd');
  if (dateStr < today || dateStr > lastDay) return [];

  const wd = weekday_(dateStr);
  const hours = s.hours[String(wd)];
  if (!hours || closedOn_(s, dateStr, '')) return [];

  const barbers = s.barbers.filter(b =>
    b.active !== false &&
    (barberId === 'any' || b.id === barberId) &&
    (b.daysOff || []).indexOf(wd) === -1 &&
    !closedOn_(s, dateStr, b.id));
  if (!barbers.length) return [];

  const dayStart = dateAt_(dateStr, 0);
  const dayEnd = dateAt_(dateStr, 1439);
  dayEnd.setMinutes(dayEnd.getMinutes() + 1);

  // Read each calendar once, then work out what blocks each barber.
  // A booking tagged for another barber doesn't block this one; anything untagged
  // (the barber's own appointments, lunch, a personal event) does.
  const eventsByCal = {};
  const busy = {};
  barbers.forEach(b => {
    const cid = b.calendarId || 'primary';
    if (!eventsByCal[cid]) eventsByCal[cid] = getCal_(cid, b.name).getEvents(dayStart, dayEnd);
    busy[b.id] = eventsByCal[cid]
      .filter(ev => { const tag = ev.getTag('wbBarber'); return !tag || tag === b.id; })
      .map(ev => ev.isAllDayEvent()
        ? [dayStart.getTime(), dayEnd.getTime()]
        : [ev.getStartTime().getTime(), ev.getEndTime().getTime()]);
  });

  const earliest = Date.now() + (s.minNotice || 0) * 6e4;
  const out = [];
  for (let m = hours[0]; m + svc.dur <= hours[1]; m += (s.slotStep || 30)) {
    const st = dateAt_(dateStr, m).getTime();
    const en = st + svc.dur * 6e4;
    if (st < earliest) continue;
    const free = barbers.filter(b => !busy[b.id].some(iv => iv[0] < en && iv[1] > st)).map(b => b.id);
    if (free.length) out.push({ time: m, barbers: free });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Booking                                                             */
/* ------------------------------------------------------------------ */

function book_(r) {
  const s = getSettings_();
  const name = clean_(r.name, 80);
  const phone = clean_(r.phone, 30);
  const email = clean_(r.email, 120);
  const notes = clean_(r.notes, 500);
  const time = Number(r.time);
  if (!name) throw new Error('Enter your name so your barber knows who to expect.');
  if (phone.replace(/\D/g, '').length < 10) throw new Error('Enter a 10-digit phone number.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Check your email address.');
  const svc = s.services.find(x => x.id === r.serviceId && x.active !== false);
  if (!svc) throw new Error('That service is no longer offered. Refresh the page and pick another.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let result, barber, start, end, code;
  try {
    const wanted = r.barberId && r.barberId !== 'any' ? r.barberId : 'any';
    const slot = computeSlots_(r.date, r.serviceId, wanted, s).find(x => x.time === time);
    if (!slot) throw new Error('Sorry, that time was just taken. Pick another time.');
    const barberId = wanted === 'any' ? slot.barbers[0] : wanted;
    barber = s.barbers.find(b => b.id === barberId);
    start = dateAt_(r.date, time);
    end = new Date(start.getTime() + svc.dur * 6e4);
    code = 'WB-' + Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();

    const ev = getCal_(barber.calendarId, barber.name).createEvent(
      svc.name + ' – ' + name + ' (' + barber.name + ')', start, end, {
        description: [
          'Booked online · ' + code,
          'Customer: ' + name,
          'Phone: ' + phone,
          email ? 'Email: ' + email : '',
          'Service: ' + svc.name + ' ($' + svc.price + ', ' + svc.dur + ' min)',
          'Barber: ' + barber.name,
          notes ? 'Notes: ' + notes : ''
        ].filter(String).join('\n')
      });
    ev.setTag('wb', '1');
    ev.setTag('wbCode', code);
    ev.setTag('wbBarber', barber.id);
    ev.setTag('wbService', svc.name);
    ev.setTag('wbPrice', String(svc.price));
    ev.setTag('wbName', name);
    ev.setTag('wbPhone', phone);
    ev.setTag('wbEmail', email);
    ev.setTag('wbNotes', notes.slice(0, 500));
    result = { ok: true, code: code, barberId: barber.id, barberName: barber.name, date: r.date, time: time, service: svc.name };
  } finally {
    lock.releaseLock();
  }

  const when = fmt_(start, 'EEEE, MMMM d') + ' at ' + fmt_(start, 'h:mm a');
  if (email) {
    safeMail_({
      to: email,
      subject: 'You\'re booked: ' + svc.name + ', ' + when,
      body: 'Hi ' + name.split(' ')[0] + ',\n\n' +
        'You\'re booked at ' + s.shop.name + '.\n\n' +
        svc.name + ' with ' + barber.name + '\n' + when + '\n' +
        (s.shop.address ? s.shop.address + ', ' + s.shop.city + '\n' : '') +
        'Confirmation code: ' + code + '\n\n' +
        'Need to change or cancel? Call us at ' + s.shop.phone + '.\n\n' + s.shop.name,
      name: s.shop.name,
      replyTo: s.shop.email || undefined
    });
  }
  if (s.shop.notifyOwner) {
    safeMail_({
      to: s.shop.ownerEmail || Session.getEffectiveUser().getEmail(),
      subject: 'New booking: ' + name + ', ' + when,
      body: svc.name + ' with ' + barber.name + '\n' + when + '\n\n' +
        'Customer: ' + name + '\nPhone: ' + phone + (email ? '\nEmail: ' + email : '') +
        (notes ? '\nNotes: ' + notes : '') + '\n\nCode: ' + code,
      name: s.shop.name + ' bookings'
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

function adminLogin_(password) {
  checkPassword_(password, 'That password isn\'t right.');
  const token = Utilities.getUuid();
  CACHE.put('tok_' + token, '1', SESSION_SECONDS);
  return { token: token, idleMinutes: SESSION_SECONDS / 60 };
}

// Shared by sign-in and password change, so both count toward the lockout.
function checkPassword_(password, wrongMsg) {
  const fails = Number(CACHE.get('loginFails') || 0);
  if (fails >= MAX_FAILED_LOGINS) throw new Error('Too many wrong passwords. Wait 10 minutes and try again.');
  const salt = PROPS.getProperty('pwSalt');
  if (!salt) throw new Error('No admin password set yet. Run setup in the Apps Script editor.');
  if (hash_(salt + String(password || '')) !== PROPS.getProperty('pwHash')) {
    CACHE.put('loginFails', String(fails + 1), 600);
    throw new Error(wrongMsg);
  }
}

// Every admin request renews the session, so it only ends after 15 idle minutes.
function requireAdmin_(token) {
  if (!token || !CACHE.get('tok_' + token)) throw new Error('SESSION_EXPIRED');
  CACHE.put('tok_' + token, '1', SESSION_SECONDS);
}

function setPassword_(pw) {
  const salt = Utilities.getUuid();
  PROPS.setProperty('pwSalt', salt);
  PROPS.setProperty('pwHash', hash_(salt + pw));
}

function listCalendars_() {
  const def = CalendarApp.getDefaultCalendar().getId();
  return CalendarApp.getAllOwnedCalendars().map(c => ({
    id: c.getId() === def ? 'primary' : c.getId(),
    name: c.getName() + (c.getId() === def ? ' (main calendar)' : '')
  }));
}

function listBookings_(from, to) {
  const s = getSettings_();
  if (!isYmd_(from) || !isYmd_(to) || to < from) throw new Error('Pick a valid date range.');
  const start = dateAt_(from, 0);
  const end = dateAt_(to, 1439);
  if (end - start > 100 * 864e5) throw new Error('Pick a range of 100 days or less.');
  const names = {};
  s.barbers.forEach(b => names[b.id] = b.name);
  const cals = {};
  s.barbers.forEach(b => cals[b.calendarId || 'primary'] = true);
  const out = [];
  Object.keys(cals).forEach(cid => {
    getCal_(cid).getEvents(start, end).forEach(ev => {
      if (ev.getTag('wb') !== '1') return;
      const st = ev.getStartTime();
      const bid = ev.getTag('wbBarber');
      out.push({
        id: ev.getId(), calendarId: cid,
        date: fmt_(st, 'yyyy-MM-dd'),
        time: Number(fmt_(st, 'H')) * 60 + Number(fmt_(st, 'm')),
        dur: Math.round((ev.getEndTime() - st) / 6e4),
        service: ev.getTag('wbService') || ev.getTitle(),
        price: Number(ev.getTag('wbPrice') || 0),
        barberId: bid, barberName: names[bid] || 'Former barber',
        name: ev.getTag('wbName') || '', phone: ev.getTag('wbPhone') || '',
        email: ev.getTag('wbEmail') || '', notes: ev.getTag('wbNotes') || '',
        code: ev.getTag('wbCode') || ''
      });
    });
  });
  out.sort((a, b) => (a.date + pad_(a.time, 4)).localeCompare(b.date + pad_(b.time, 4)));
  return out;
}

function cancelBooking_(r) {
  const s = getSettings_();
  const allowed = s.barbers.map(b => b.calendarId || 'primary');
  if (allowed.indexOf(r.calendarId) === -1) throw new Error('That booking isn\'t on a shop calendar.');
  const ev = getCal_(r.calendarId).getEventById(r.eventId);
  if (!ev || ev.getTag('wb') !== '1') throw new Error('That booking was already cancelled or moved.');
  const email = ev.getTag('wbEmail');
  const name = ev.getTag('wbName') || '';
  const service = ev.getTag('wbService') || 'appointment';
  const when = fmt_(ev.getStartTime(), 'EEEE, MMMM d') + ' at ' + fmt_(ev.getStartTime(), 'h:mm a');
  ev.deleteEvent();
  let emailed = false;
  if (r.notify && email) {
    emailed = safeMail_({
      to: email,
      subject: 'Your booking was cancelled: ' + service + ', ' + when,
      body: 'Hi ' + name.split(' ')[0] + ',\n\n' +
        'Your ' + service + ' on ' + when + ' at ' + s.shop.name + ' has been cancelled.' +
        (r.reason ? '\n\n' + clean_(r.reason, 300) : '') +
        '\n\nTo book a new time, visit our website or call ' + s.shop.phone + '.\n\n' + s.shop.name,
      name: s.shop.name,
      replyTo: s.shop.email || undefined
    });
  }
  return { ok: true, emailed: emailed };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getCal_(id, who) {
  const cal = (!id || id === 'primary') ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
  if (!cal) throw new Error('Can\'t find the calendar' + (who ? ' for ' + who : '') + '. Pick another calendar on the Barbers tab.');
  return cal;
}

function safeMail_(opts) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return false;
    MailApp.sendEmail(opts);
    return true;
  } catch (e) {
    console.warn('Email failed: ' + e.message);
    return false;
  }
}

function tz_() { return Session.getScriptTimeZone(); }
function fmt_(d, pattern) { return Utilities.formatDate(d, tz_(), pattern); }
function pad_(n, w) { return String(n).padStart(w || 2, '0'); }
function isYmd_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function dateAt_(ymd, minutes) {
  return Utilities.parseDate(ymd + ' ' + pad_(Math.floor(minutes / 60)) + ':' + pad_(minutes % 60), tz_(), 'yyyy-MM-dd HH:mm');
}
function weekday_(ymd) { return Number(fmt_(dateAt_(ymd, 720), 'u')) % 7; } // 'u': 1 = Mon … 7 = Sun
function closedOn_(s, ymd, barberId) {
  return (s.closures || []).some(c => c.start <= ymd && c.end >= ymd && (!c.barberId || c.barberId === barberId));
}
function clean_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200); }
function cleanId_(v) { return String(v || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40); }
function newId_(name) {
  return (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'item') + '-' +
    Utilities.getUuid().slice(0, 4);
}
function initials_(name) { return name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase(); }
function clampInt_(v, lo, hi, dflt) { const n = Math.round(Number(v)); return n >= lo && n <= hi ? n : dflt; }
function clone_(o) { return JSON.parse(JSON.stringify(o)); }
function hash_(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
