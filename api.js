/*
 * Booking API client, shared by the public site and the admin page.
 * With BOOKING_API_URL set (config.js) it talks to the Google Apps Script backend.
 * Without it, a demo backend runs in this browser so the site can be tried out.
 */
(function () {
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const fmtTime = m => { const h = Math.floor(m / 60), mm = m % 60; return ((h + 11) % 12 + 1) + ':' + pad(mm) + ' ' + (h >= 12 ? 'PM' : 'AM'); };
  const fmtDate = (s, opts) => parseYmd(s).toLocaleDateString('en-US', opts || { weekday: 'short', month: 'short', day: 'numeric' });
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const closedOn = (closures, date, barberId) => (closures || []).some(c => c.start <= date && c.end >= date && (!c.barberId || c.barberId === barberId));
  const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  window.BookingUtil = { pad, ymd, parseYmd, addDays, fmtTime, fmtDate, esc, closedOn, DAYNAMES };

  const API_URL = String(window.BOOKING_API_URL || '').trim();
  const live = /^https:\/\/script\.google(usercontent)?\.com\//.test(API_URL);

  async function liveCall(action, payload) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // plain text avoids a CORS preflight Apps Script can't answer
        body: JSON.stringify(Object.assign({ action }, payload || {}))
      });
    } catch (e) {
      throw new Error("Couldn't reach the booking system. Check your connection and try again.");
    }
    let data;
    try { data = await res.json(); }
    catch (e) { throw new Error('The booking system sent back something unexpected. Check that the Apps Script web app is deployed with access set to "Anyone".'); }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  /* ---------------- Demo backend (mirrors Code.gs) ---------------- */

  const DEFAULTS = {
    shop: {
      name: 'Wasatch Barber Co.',
      about: 'Classic and modern cuts, straight-razor shaves and beard work from barbers who take their time. Book online in under a minute.',
      phone: '(801) 555-0100', email: 'hello@wasatchbarber.example',
      address: '214 E Main Street', city: 'Your City, ST 00000',
      notifyOwner: true, ownerEmail: 'owner@wasatchbarber.example'
    },
    services: [
      { id: 'cut', name: 'Classic Cut', price: 35, dur: 30, desc: 'Scissor or clipper cut, wash and style.', active: true },
      { id: 'fade', name: 'Skin Fade', price: 40, dur: 45, desc: 'Detailed fade, foil-finish blend, line-up.', active: true },
      { id: 'beard', name: 'Beard Trim', price: 20, dur: 20, desc: 'Shape, line-up and hot towel.', active: true },
      { id: 'shave', name: 'Straight-Razor Shave', price: 38, dur: 40, desc: 'Hot lather, two passes, cold towel finish.', active: true },
      { id: 'combo', name: 'Cut + Beard', price: 52, dur: 60, desc: 'Any cut plus a full beard trim.', active: true },
      { id: 'kids', name: "Kids' Cut", price: 25, dur: 30, desc: 'Ages 12 and under.', active: true }
    ],
    barbers: [
      { id: 'marco', name: 'Marco R.', init: 'MR', bio: 'Owner. 15 years behind the chair. Fades and tapers.', calendarId: 'primary', daysOff: [1], active: true },
      { id: 'dee', name: 'Dee Alvarez', init: 'DA', bio: 'Scissor work and longer styles. Textured hair specialist.', calendarId: 'primary', daysOff: [2], active: true },
      { id: 'tom', name: 'Tom Becker', init: 'TB', bio: 'Straight-razor shaves and beard sculpting.', calendarId: 'primary', daysOff: [3], active: true }
    ],
    hours: { '0': null, '1': [540, 1140], '2': [540, 1140], '3': [540, 1140], '4': [540, 1200], '5': [540, 1200], '6': [480, 960] },
    slotStep: 30, windowDays: 21, minNotice: 60, closures: []
  };
  const STORE_KEY = 'wb-demo-v2';
  let db = null;

  function works(s, barber, date) {
    const wd = parseYmd(date).getDay();
    return barber.active !== false && s.hours[wd] && !(barber.daysOff || []).includes(wd) && !closedOn(s.closures, date, '') && !closedOn(s.closures, date, barber.id);
  }

  function seed() {
    const s = JSON.parse(JSON.stringify(DEFAULTS));
    const today = ymd(new Date());
    const samples = [
      [0, 960, 'marco', 'fade', 'Chris Palmer', '(801) 555-0123', 'chris@example.com', 'Low fade, keep length on top'],
      [1, 600, 'dee', 'cut', 'Andre Lewis', '(801) 555-0188', '', ''],
      [1, 660, 'tom', 'shave', 'Sam Ortega', '(801) 555-0147', 'sam@example.com', ''],
      [2, 540, 'marco', 'combo', 'Jordan Smith', '(801) 555-0142', 'jordan@example.com', 'First visit'],
      [2, 840, 'tom', 'beard', 'Eli Brooks', '(801) 555-0171', '', ''],
      [3, 720, 'dee', 'kids', 'Mason Reed (age 8)', '(801) 555-0109', 'reedfamily@example.com', 'Parent: Kate Reed'],
      [4, 1020, 'marco', 'cut', 'Ty Nguyen', '(801) 555-0155', '', '']
    ];
    const bookings = [];
    samples.forEach(([off, time, barberId, serviceId, name, phone, email, notes]) => {
      let date = addDays(today, off), guard = 0;
      const b = s.barbers.find(x => x.id === barberId);
      while (!works(s, b, date) && guard++ < 7) date = addDays(date, 1);
      const svc = s.services.find(x => x.id === serviceId);
      bookings.push({ id: 'demo-' + Math.random().toString(36).slice(2, 9), calendarId: b.calendarId, date, time, dur: svc.dur,
        service: svc.name, price: svc.price, barberId, name, phone, email, notes, code: 'WB-' + Math.random().toString(36).slice(2, 7).toUpperCase() });
    });
    return { settings: s, bookings, password: 'demodemo', tokens: {} };
  }
  function load() {
    if (db) return db;
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) db = JSON.parse(raw); } catch (e) { /* storage blocked */ }
    if (!db) { db = seed(); save(); }
    return db;
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* keep in memory */ } }

  function computeSlots(s, bookings, date, serviceId, barberId) {
    const svc = s.services.find(x => x.id === serviceId && x.active !== false);
    if (!svc) throw new Error('That service is no longer offered. Refresh the page and pick another.');
    const today = ymd(new Date());
    if (date < today || date > addDays(today, s.windowDays)) return [];
    const hours = s.hours[parseYmd(date).getDay()];
    if (!hours) return [];
    const barbers = s.barbers.filter(b => (barberId === 'any' || b.id === barberId) && works(s, b, date));
    const earliest = Date.now() + s.minNotice * 6e4;
    const out = [];
    for (let m = hours[0]; m + svc.dur <= hours[1]; m += s.slotStep) {
      const d = parseYmd(date); d.setMinutes(m);
      if (d.getTime() < earliest) continue;
      const free = barbers.filter(b => !bookings.some(k => k.barberId === b.id && k.date === date && k.time < m + svc.dur && k.time + k.dur > m)).map(b => b.id);
      if (free.length) out.push({ time: m, barbers: free });
    }
    return out;
  }

  const mock = {
    getConfig() {
      const s = load().settings;
      return {
        shop: { name: s.shop.name, about: s.shop.about, phone: s.shop.phone, email: s.shop.email, address: s.shop.address, city: s.shop.city },
        services: s.services.filter(x => x.active !== false),
        barbers: s.barbers.filter(b => b.active !== false).map(b => ({ id: b.id, name: b.name, init: b.init, bio: b.bio, daysOff: b.daysOff })),
        hours: s.hours, slotStep: s.slotStep, windowDays: s.windowDays, minNotice: s.minNotice,
        closures: s.closures.map(c => ({ start: c.start, end: c.end, barberId: c.barberId || '' })),
        today: ymd(new Date()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    },
    getSlots(p) { const d = load(); return { slots: computeSlots(d.settings, d.bookings, p.date, p.serviceId, p.barberId || 'any') }; },
    book(p) {
      const d = load(), s = d.settings;
      const name = String(p.name || '').trim(), phone = String(p.phone || '').trim(), email = String(p.email || '').trim();
      if (!name) throw new Error('Enter your name so your barber knows who to expect.');
      if (phone.replace(/\D/g, '').length < 10) throw new Error('Enter a 10-digit phone number.');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Check your email address.');
      const wanted = p.barberId && p.barberId !== 'any' ? p.barberId : 'any';
      const slot = computeSlots(s, d.bookings, p.date, p.serviceId, wanted).find(x => x.time === Number(p.time));
      if (!slot) throw new Error('Sorry, that time was just taken. Pick another time.');
      const barber = s.barbers.find(b => b.id === (wanted === 'any' ? slot.barbers[0] : wanted));
      const svc = s.services.find(x => x.id === p.serviceId);
      const code = 'WB-' + Math.random().toString(36).slice(2, 7).toUpperCase();
      d.bookings.push({ id: 'demo-' + Math.random().toString(36).slice(2, 9), calendarId: barber.calendarId, date: p.date, time: Number(p.time), dur: svc.dur,
        service: svc.name, price: svc.price, barberId: barber.id, name, phone, email, notes: String(p.notes || '').trim(), code });
      save();
      return { ok: true, code, barberId: barber.id, barberName: barber.name, date: p.date, time: Number(p.time), service: svc.name };
    },
    adminLogin(p) {
      const d = load();
      if (p.password !== d.password) throw new Error("That password isn't right." + (d.password === 'demodemo' ? ' In demo mode it\'s "demodemo".' : ''));
      const token = 'demo-' + Math.random().toString(36).slice(2);
      d.tokens[token] = Date.now(); save();
      return { token, idleMinutes: 15 };
    },
    _auth(p) {
      const d = load(), seen = d.tokens[p.token];
      if (!seen || Date.now() - seen > 15 * 6e4) { delete d.tokens[p.token]; save(); throw new Error('SESSION_EXPIRED'); }
      d.tokens[p.token] = Date.now(); save();
    },
    adminPing(p) { this._auth(p); return { ok: true }; },
    adminGetAll(p) {
      this._auth(p);
      return { settings: JSON.parse(JSON.stringify(load().settings)), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        calendars: [{ id: 'primary', name: 'Shop calendar (main calendar)' }, { id: 'demo-dee', name: 'Dee – appointments' }, { id: 'demo-tom', name: 'Tom – appointments' }] };
    },
    adminSave(p) {
      this._auth(p);
      const s = p.settings;
      s.services.forEach(x => { if (!String(x.name).trim()) throw new Error('Every service needs a name.'); if (!(Number(x.price) >= 0)) throw new Error('Check the price for ' + x.name + '.'); });
      s.barbers.forEach(b => { if (!String(b.name).trim()) throw new Error('Every barber needs a name.'); });
      Object.values(s.hours).forEach(h => { if (h && !(h[1] > h[0])) throw new Error('Closing time must be after opening time.'); });
      load().settings = JSON.parse(JSON.stringify(s)); save();
      return { settings: load().settings };
    },
    adminBookings(p) {
      this._auth(p);
      const d = load();
      const names = Object.fromEntries(d.settings.barbers.map(b => [b.id, b.name]));
      return { bookings: d.bookings.filter(b => b.date >= p.from && b.date <= p.to)
        .map(b => Object.assign({}, b, { barberName: names[b.barberId] || 'Former barber' }))
        .sort((a, b) => (a.date + String(a.time).padStart(4, '0')).localeCompare(b.date + String(b.time).padStart(4, '0'))) };
    },
    adminCancel(p) {
      this._auth(p);
      const d = load(), k = d.bookings.find(b => b.id === p.eventId);
      if (!k) throw new Error('That booking was already cancelled or moved.');
      d.bookings = d.bookings.filter(b => b.id !== p.eventId); save();
      return { ok: true, emailed: !!(p.notify && k.email) };
    },
    adminChangePassword(p) {
      this._auth(p);
      if (p.currentPassword !== load().password) throw new Error("Your current password isn't right.");
      if (!p.newPassword || p.newPassword.length < 8) throw new Error('Use a password with at least 8 characters.');
      load().password = p.newPassword; save();
      return { ok: true };
    },
    adminLogout(p) { delete load().tokens[p.token]; save(); return { ok: true }; }
  };

  async function call(action, payload) {
    if (live) return liveCall(action, payload);
    await new Promise(r => setTimeout(r, 220)); // feel like a network call
    if (!mock[action] || action[0] === '_') throw new Error('Unknown request.');
    return mock[action](payload || {});
  }

  function resetDemo() { db = seed(); save(); }

  window.BookingAPI = { call, live, resetDemo };
})();
