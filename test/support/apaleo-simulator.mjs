// Apaleo simulator for local runs and integration tests — NEVER loaded in
// production. It is activated only via
//   NODE_OPTIONS="--import ./test/support/apaleo-simulator.mjs"
// together with APALEO_SIM_STATE=<path to a JSON state file>, and replaces
// global fetch for api.apaleo.com / identity.apaleo.com only. Any other
// host (e.g. Slack) is refused with an error, so a simulated run can never
// reach a real system. Every call is appended to the state file's `calls`.
//
// Data model: the Apaleo TEST property ("Test run") as read on 2026-11-08
// (reservation JTKQSYFX-1, unit group TEST-IGL4, service offers), with a
// fictitious primary guest. Writes (book-service, amend, PATCH) change the
// simulated state the way Apaleo would for the fields the Extras code reads.

import fs from "node:fs";

const STATE = process.env.APALEO_SIM_STATE;
if (!STATE) throw new Error("apaleo-simulator: APALEO_SIM_STATE is required");

const realFetch = globalThis.fetch;
const RESERVATION_ID = process.env.APALEO_SIM_RESERVATION || "JTKQSYFX-1";

const SERVICES = {
  "TEST-ECI": { code: "ECI", name: { de: "Früher Check-in", en: "Early Check-in" }, price: 20, vat: 7, rule: "arrival" },
  "TEST-LCO": { code: "LCO", name: { de: "Später Check-out", en: "Late Check-out" }, price: 20, vat: 7, rule: "departure" },
  "TEST-HUND": { code: "HUND", name: { de: "Hund", en: "Dog fee" }, price: 15, vat: 19, rule: "night" },
  "TEST-PKW": { code: "PKW", name: { de: "Parkplatz", en: "Car park" }, price: 0, vat: 19, rule: "night" },
  "TEST-BABY": { code: "BABY", name: { de: "Babybett", en: "Baby cot" }, price: 15, vat: 7, rule: "night" },
  "TEST-EXTRPERSON": { code: "EXTRPERSON", name: { de: "Zusatzperson", en: "Extra person" }, price: 30, vat: 7, rule: "night" },
  "TEST-FINALCLEAN": { code: "FINALCLEAN", name: { de: "Endreinigung", en: "Final cleaning on departure" }, price: 139, vat: 7, rule: "none" },
};

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nights(arrival, departure) {
  const list = [];
  for (let d = arrival.slice(0, 10); d < departure.slice(0, 10); d = addDays(d, 1)) list.push(d);
  return list;
}

function seed() {
  const arrivalDate = process.env.APALEO_SIM_ARRIVAL || "2027-01-12";
  const departureDate = process.env.APALEO_SIM_DEPARTURE || "2027-01-14";
  const arrival = `${arrivalDate}T16:00:00+01:00`;
  const departure = `${departureDate}T10:00:00+01:00`;
  const ratePlan = { id: "TEST-STD_NO_BF-IGL4", code: "STD_NO_BF", name: "Direct Booking Rate - Flexible Cancellation" };
  const nightList = nights(arrival, departure);
  return {
    reservations: {
      [RESERVATION_ID]: {
        id: RESERVATION_ID,
        bookingId: RESERVATION_ID.split("-")[0],
        status: process.env.APALEO_SIM_STATUS || "Confirmed",
        property: { id: "TEST", code: "TEST", name: "Test run" },
        unit: { id: "TEST-ZHF", name: "Ap. 1", unitGroupId: "TEST-IGL4" },
        unitGroup: { id: "TEST-IGL4", code: "IGL4", name: "IGL No. 4" },
        ratePlan,
        arrival,
        departure,
        adults: 2,
        childrenAges: [9],
        channelCode: "Direct",
        primaryGuest: { firstName: "Max", lastName: "Mustermann", preferredLanguage: "de" },
        comment: "",
        hasCityTax: false,
        timeSlices: nightList.map((date) => ({
          serviceDate: date,
          ratePlan,
          totalGrossAmount: { amount: 99, currency: "EUR" },
        })),
        actions: [{ action: "AmendDeparture", isAllowed: true }],
      },
    },
    services: {
      [RESERVATION_ID]: [
        {
          service: { id: "TEST-FINALCLEAN", code: "FINALCLEAN", name: "Final cleaning on departure" },
          dates: [{ serviceDate: nightList[nightList.length - 1], count: 1, amount: { grossAmount: 139, currency: "EUR" }, isMandatory: true }],
          isMandatory: true,
        },
      ],
    },
    unitGroups: { "TEST-IGL4": { id: "TEST-IGL4", code: "IGL4", maxPersons: 6, memberCount: 2 } },
    // Nights (YYYY-MM-DD) on which TEST-IGL4 / TEST-ZHF is sold out.
    soldOut: (process.env.APALEO_SIM_SOLD_OUT || "").split(",").filter(Boolean),
    calls: [],
  };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    const state = seed();
    save(state);
    return state;
  }
}

function save(state) {
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}

function json(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function money(amount, vat) {
  return { grossAmount: amount, netAmount: Math.round((amount / (1 + vat / 100)) * 100) / 100, vatType: vat === 19 ? "Normal" : "Reduced", vatPercent: vat, currency: "EUR" };
}

function serviceOffers(reservation, overrides = {}) {
  const nightList = nights(reservation.arrival, reservation.departure);
  const arrival = reservation.arrival.slice(0, 10);
  const departure = reservation.departure.slice(0, 10);
  return Object.entries(SERVICES)
    .filter(([, s]) => s.rule !== "none")
    .map(([id, def]) => {
      // `priceOverrides` in the state file lets a test change a price between page load and booking.
      const s = { ...def, price: overrides[id] ?? def.price };
      const dates = s.rule === "arrival" ? [arrival] : s.rule === "departure" ? [departure] : nightList;
      return {
        service: { id, code: s.code, name: s.name.en, description: s.name.en, pricingUnit: "Room", defaultGrossPrice: { amount: s.price, currency: "EUR" } },
        count: 1,
        totalAmount: money(s.price * dates.length, s.vat),
        dates: dates.map((serviceDate) => ({ serviceDate, amount: money(s.price, s.vat), isDefaultDate: true, isMandatory: false })),
      };
    });
}

function handle(state, method, url, body) {
  const path = url.pathname;
  let m;
  if ((m = path.match(/^\/booking\/v1\/reservations\/([^/]+)$/))) {
    const reservation = state.reservations[decodeURIComponent(m[1])];
    if (!reservation) return json({ messages: ["not found"] }, 404);
    if (method === "GET") return json(reservation);
    if (method === "PATCH") {
      for (const op of Array.isArray(body) ? body : []) {
        if (op.path === "/comment") reservation.comment = op.value;
        else if (op.path === "/primaryGuest/vehicleRegistration") reservation.primaryGuest.vehicleRegistration = op.value;
        else return json({ messages: [`simulator: unsupported patch ${op.path}`] }, 422);
      }
      return json(null, 204);
    }
  }
  if (method === "GET" && path === "/booking/v1/reservations") {
    const all = Object.values(state.reservations);
    const bookingId = url.searchParams.get("bookingId");
    const text = url.searchParams.get("textSearch");
    const list = all.filter((r) => (bookingId ? r.bookingId === bookingId : text ? r.id === text || r.bookingId === text : true));
    return json({ reservations: list, count: list.length });
  }
  if ((m = path.match(/^\/booking\/v1\/reservations\/([^/]+)\/services$/)) && method === "GET") {
    return json({ services: state.services[decodeURIComponent(m[1])] || [] });
  }
  if ((m = path.match(/^\/booking\/v1\/reservations\/([^/]+)\/service-offers$/)) && method === "GET") {
    const reservation = state.reservations[decodeURIComponent(m[1])];
    if (!reservation) return json({ messages: ["not found"] }, 404);
    return json({ services: serviceOffers(reservation, state.priceOverrides) });
  }
  if ((m = path.match(/^\/booking\/v1\/reservation-actions\/([^/]+)\/book-service$/)) && method === "PUT") {
    const id = decodeURIComponent(m[1]);
    const def = SERVICES[body?.serviceId];
    if (!state.reservations[id] || !def) return json({ messages: ["simulator: unknown reservation or service"] }, 422);
    const list = (state.services[id] ||= []);
    const entry = {
      service: { id: body.serviceId, code: def.code, name: def.name.en },
      dates: (body.dates || []).map((d) => ({
        serviceDate: d.serviceDate,
        count: d.count ?? body.count,
        amount: { grossAmount: d.amount?.amount ?? def.price, currency: d.amount?.currency || "EUR" },
        isMandatory: false,
      })),
    };
    // Apaleo replaces the whole date set of a service on every call.
    const index = list.findIndex((s) => s.service.id === body.serviceId);
    if (index >= 0) list[index] = entry;
    else list.push(entry);
    return json({ id: `${id}-${body.serviceId}` }, 201);
  }
  if ((m = path.match(/^\/booking\/v1\/reservation-actions\/([^/]+)\/amend$/)) && method === "PUT") {
    const reservation = state.reservations[decodeURIComponent(m[1])];
    if (!reservation) return json({ messages: ["not found"] }, 404);
    const oldDeparture = reservation.departure.slice(0, 10);
    reservation.arrival = body.arrival;
    reservation.departure = body.departure;
    reservation.adults = body.adults;
    const nightList = nights(body.arrival, body.departure);
    reservation.timeSlices = nightList.map((date, i) => ({
      serviceDate: date,
      ratePlan: { ...reservation.ratePlan, id: body.timeSlices?.[i]?.ratePlanId || reservation.ratePlan.id },
      totalGrossAmount: body.timeSlices?.[i]?.totalGrossAmount || { amount: 99, currency: "EUR" },
    }));
    if (body.departure.slice(0, 10) !== oldDeparture) {
      // Mandatory departure services move with the departure (as in Apaleo).
      for (const s of state.services[reservation.id] || []) {
        if (s.isMandatory) s.dates = s.dates.map((d) => ({ ...d, serviceDate: nightList[nightList.length - 1] }));
      }
    }
    return json(null, 204);
  }
  if ((m = path.match(/^\/rateplan\/v1\/services\/([^/]+)$/)) && method === "GET") {
    const id = decodeURIComponent(m[1]);
    const def = SERVICES[id];
    if (!def) return json({ messages: ["not found"] }, 404);
    const localized = url.searchParams.get("languages");
    return json({
      id,
      code: def.code,
      name: localized ? def.name : def.name.en,
      description: localized ? def.name : def.name.en,
      pricingUnit: "Room",
      postNextDay: false,
      defaultGrossPrice: { amount: def.price, currency: "EUR" },
      availability: { mode: def.rule === "night" ? "Daily" : "Arrival" },
    });
  }
  if ((m = path.match(/^\/inventory\/v1\/unit-groups\/([^/]+)$/)) && method === "GET") {
    const group = state.unitGroups[decodeURIComponent(m[1])];
    return group ? json(group) : json({ messages: ["not found"] }, 404);
  }
  if (path === "/availability/v1/unit-groups" && method === "GET") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const timeSlices = [];
    for (let d = from; d < to; d = addDays(d, 1)) {
      const free = !state.soldOut.includes(d);
      timeSlices.push({
        from: `${d}T16:00:00+01:00`,
        to: `${addDays(d, 1)}T10:00:00+01:00`,
        unitGroups: [{ unitGroup: { id: "TEST-IGL4" }, availableCount: free ? 1 : 0, physicalCount: 2 }],
      });
    }
    return json({ timeSlices });
  }
  if (path === "/availability/v1/units" && method === "GET") {
    const day = (url.searchParams.get("from") || "").slice(0, 10);
    return json({ units: state.soldOut.includes(day) ? [] : [{ id: "TEST-ZHF" }] });
  }
  if (path === "/finance/v1/folios" && method === "GET") return json({ folios: [] });
  return json({ messages: [`simulator: ${method} ${path} not simulated`] }, 501);
}

globalThis.fetch = async function simulatedFetch(input, init = {}) {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  const method = (init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.hostname === "identity.apaleo.com") {
    const state = load();
    state.calls.push({ at: new Date().toISOString(), method, path: url.pathname });
    save(state);
    return json({ access_token: "simulated", expires_in: 3600 });
  }
  if (url.hostname === "api.apaleo.com") {
    const state = load();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const response = handle(state, method, url, body);
    state.calls.push({ at: new Date().toISOString(), method, path: url.pathname + url.search, status: response.status });
    save(state);
    return response;
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return realFetch(input, init);
  // Fonts for `next dev` are allowed; everything else (Slack, …) is refused.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return realFetch(input, init);
  throw new Error(`apaleo-simulator: outbound request to ${url.hostname} blocked`);
};
console.log(`[apaleo-simulator] active, state ${STATE}`);
