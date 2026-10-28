// Race calendars shaped for the bar pill and the race-weekend panel: ESPN's
// F1, IndyCar and NASCAR scoreboards, the FIA WEC's own site and MotoGP's
// own API. Pure functions only: the QML owns fetching and timers, so
// everything here runs under node for the tests.

var minuteMs = 60 * 1000
var hourMs = 60 * minuteMs
var dayMs = 24 * hourMs

// A finished round stays listed this long after its last session, so its
// results are still there the morning after.
var keepAfterMs = dayMs

var glyphs = {
  flag: String.fromCodePoint(0xF023C),     // nf-md-flag_checkered
  star: String.fromCodePoint(0xF04CE),     // nf-md-star
  previous: String.fromCodePoint(0xF0141), // nf-md-chevron_left
  next: String.fromCodePoint(0xF0142),     // nf-md-chevron_right
  refresh: String.fromCodePoint(0xF0450),  // nf-md-refresh
  open: String.fromCodePoint(0xF03CC),     // nf-md-open_in_new
  date: String.fromCodePoint(0xF00ED),     // nf-md-calendar
  venue: String.fromCodePoint(0xF034E),    // nf-md-map_marker
  broadcast: String.fromCodePoint(0xF0502) // nf-md-television
}

var series = ["f1", "wec", "motogp", "indycar", "nascar"]
var follows = series.concat(["any"])
var labelStyles = ["icon", "race"]

var seriesInfo = {
  f1: { tab: "F1", name: "Formula 1", key: "f", source: "ESPN" },
  wec: { tab: "WEC", name: "World Endurance Championship", key: "w", source: "fiawec.com" },
  motogp: { tab: "MotoGP", name: "MotoGP", key: "m", source: "motogp.com" },
  indycar: { tab: "IndyCar", name: "IndyCar Series", key: "i", source: "ESPN" },
  nascar: { tab: "NASCAR", name: "NASCAR Cup Series", key: "n", source: "ESPN" }
}

var espnLeagues = { f1: "f1", indycar: "irl", nascar: "nascar-premier" }

// ESPN links its F1 races to their own pages, and IndyCar and NASCAR races
// to a ticket seller, so those two open ESPN's schedule instead.
var espnSchedulePages = {
  f1: "https://www.espn.com/f1/schedule",
  indycar: "https://www.espn.com/racing/schedule/_/series/indycar",
  nascar: "https://www.espn.com/racing/schedule/_/series/sprint"
}

var wecUrl = "https://www.fiawec.com/en/"
var wecSite = "https://www.fiawec.com"
var motogpCalendarUrl = "https://www.motogp.com/en/calendar"

// The big ones, marked in the panel.
var crownJewels = {
  f1: /\bMonaco\b/,
  wec: /\b24 Hours of Le Mans\b/,
  indycar: /\bIndianapolis 500\b/,
  nascar: /\bDaytona 500\b/
}

function seriesId(value) {
  return series.indexOf(value) >= 0 ? value : "f1"
}

function follow(value) {
  return follows.indexOf(value) >= 0 ? value : "f1"
}

function labelStyle(value) {
  return value === "race" ? "race" : "icon"
}

// On/off settings arrive as booleans, or as "false" from `omarchy bar set`
// without --json.
function switchedOn(value) {
  return value !== false && value !== "false"
}

// ESPN and MotoGP serve a season at a time, which keeps round numbers
// right; WEC's home page lists every race.
function feedUrl(id, year) {
  if (id === "wec") return wecUrl
  if (id === "motogp") return "https://api.motogp.pulselive.com/motogp/v1/events?seasonYear=" + year
  return "https://site.api.espn.com/apis/site/v2/sports/racing/" + espnLeagues[seriesId(id)]
    + "/scoreboard?limit=100&dates=" + year + "0101-" + year + "1231"
}

function usesSeasons(id) {
  return id !== "wec"
}

// ESPN writes 2026-11-01T20:00Z, MotoGP 2026-10-30T10:45:00+0800 and WEC
// 2027-06-12T16:00:00+02:00; not every Date parser takes all three.
function parseTime(value) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))?$/.exec(String(value || "").trim())
  if (!m) return NaN
  var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
  if (m[8]) ms -= (m[8] === "-" ? -1 : 1) * ((+m[9]) * 60 + (+m[10])) * minuteMs
  return ms
}

function lastName(athlete) {
  var a = athlete || {}
  var short = String(a.shortName || "")
  var dot = short.indexOf(". ")
  if (dot > 0) return short.slice(dot + 2)
  var parts = String(a.displayName || "").trim().split(/\s+/)
  return parts[parts.length - 1] || "TBA"
}

function newSession(name, short, kind, startMs, minutes) {
  return {
    name: name,
    short: short,
    kind: kind,
    startMs: startMs,
    endMs: startMs + minutes * minuteMs,
    tbc: false,
    state: "",
    results: []
  }
}

// ---------- ESPN: F1, IndyCar, NASCAR ----------

// name, short, kind, minutes it usually runs
var f1Sessions = {
  FP1: ["Practice 1", "FP1", "practice", 60],
  FP2: ["Practice 2", "FP2", "practice", 60],
  FP3: ["Practice 3", "FP3", "practice", 60],
  SS: ["Sprint Qualifying", "SQ", "qualifying", 45],
  SR: ["Sprint", "Sprint", "sprint", 60],
  Qual: ["Qualifying", "Quali", "qualifying", 60],
  Race: ["Race", "Race", "race", 120]
}

var multiWordPlaces = ["United States", "Mexico City", "São Paulo", "Las Vegas", "Abu Dhabi", "Saudi Arabian", "Emilia Romagna", "Great Britain"]

// "Heineken Las Vegas Grand Prix" -> "Las Vegas Grand Prix". Sponsors come
// first, so the place is the word, or known pair of words, before "Grand
// Prix".
function f1Title(name) {
  var text = String(name || "").trim()
  var at = text.indexOf("Grand Prix")
  if (at <= 0) return text
  var words = text.slice(0, at).trim().split(/\s+/)
  var place = words[words.length - 1]
  var pair = words.length > 1 ? words[words.length - 2] + " " + place : ""
  if (multiWordPlaces.indexOf(pair) >= 0) place = pair
  return place + " " + text.slice(at)
}

function espnTitle(id, name) {
  var text = String(name || "").trim()
  if (id === "f1") return f1Title(text)
  if (id === "nascar") return text.replace(/^NASCAR\s+/, "")
  return text
}

// The bar's name for a race: "Las Vegas GP", "Martinsville", "Monterey GP".
function espnShort(id, title) {
  if (id === "nascar") {
    var at = title.lastIndexOf(" at ")
    return at >= 0 ? title.slice(at + 4) : title
  }
  return title.replace(/^Grand Prix of (.+)$/, "$1 GP").replace("Grand Prix", "GP")
}

function espnResults(comp) {
  var list = (Array.isArray(comp.competitors) ? comp.competitors : []).slice()
  list.sort(function(a, b) { return (a.order || 999) - (b.order || 999) })
  return list.slice(0, 3).map(function(c, i) {
    var athlete = c.athlete || {}
    return {
      pos: i + 1,
      name: lastName(athlete),
      country: athlete.flag && athlete.flag.alt ? String(athlete.flag.alt) : ""
    }
  })
}

function espnSession(id, comp) {
  var abbr = comp.type && comp.type.abbreviation ? String(comp.type.abbreviation) : ""
  var spec = id === "f1"
    ? (f1Sessions[abbr] || [abbr || "Session", abbr || "Session", "practice", 60])
    : ["Race", "Race", "race", 210]
  var s = newSession(spec[0], spec[1], spec[2], parseTime(comp.startDate || comp.date), spec[3])
  var status = comp.status && comp.status.type ? comp.status.type : {}
  s.state = String(status.state || "")
  s.tbc = comp.timeValid === false
  if (s.state === "post") s.results = espnResults(comp)
  return s
}

function espnBroadcasts(comps) {
  var names = []
  comps.forEach(function(comp) {
    (Array.isArray(comp.broadcasts) ? comp.broadcasts : []).forEach(function(b) {
      (Array.isArray(b.names) ? b.names : []).forEach(function(n) {
        if (n && names.indexOf(String(n)) < 0) names.push(String(n))
      })
    })
  })
  return names
}

function espnUrl(id, ev) {
  var links = Array.isArray(ev.links) ? ev.links : []
  for (var i = 0; id === "f1" && i < links.length; i++) {
    var rel = Array.isArray(links[i].rel) ? links[i].rel : []
    if (rel.indexOf("summary") >= 0 && /^https:\/\/www\.espn\.com\//.test(String(links[i].href || ""))) return String(links[i].href)
  }
  return espnSchedulePages[id]
}

function newEvent(id, fields) {
  var e = {
    id: "",
    series: id,
    name: "",
    title: "",
    short: "",
    season: 0,
    round: 0,
    rounds: 0,
    startMs: NaN,
    endMs: NaN,
    raceMs: NaN,
    circuit: "",
    place: "",
    broadcasts: [],
    url: "",
    detailUrl: "",
    cancelled: false,
    countsAsRound: true,
    big: false,
    raceHours: 0,
    sessions: []
  }
  for (var k in fields) e[k] = fields[k]
  return e
}

// The first and last moments of a weekend, and when its main race starts.
function spanSessions(e) {
  var list = e.sessions || []
  if (list.length === 0) return e
  e.startMs = list[0].startMs
  e.endMs = Math.max.apply(null, list.map(function(s) { return s.endMs }))
  for (var i = list.length - 1; i >= 0; i--) {
    if (list[i].kind === "race") {
      e.raceMs = list[i].startMs
      break
    }
  }
  if (isNaN(e.raceMs)) e.raceMs = list[list.length - 1].startMs
  return e
}

function capitalWords(text) {
  return String(text || "").replace(/(^|\s)(\S)/g, function(all, space, c) { return space + c.toUpperCase() })
}

function parseEspnEvent(id, ev) {
  var comps = Array.isArray(ev.competitions) ? ev.competitions : []
  var sessions = comps.map(function(c) { return espnSession(id, c) })
    .filter(function(s) { return !isNaN(s.startMs) })
    .sort(function(a, b) { return a.startMs - b.startMs })
  var name = String(ev.name || "")
  var title = espnTitle(id, name)
  var status = ev.status && ev.status.type ? String(ev.status.type.name || "") : ""
  var circuit = ev.circuit || {}
  var address = circuit.address || {}
  var e = newEvent(id, {
    id: String(ev.id || ""),
    name: name,
    title: title,
    short: espnShort(id, title),
    season: ev.season && ev.season.year ? ev.season.year : 0,
    circuit: circuit.fullName ? String(circuit.fullName) : "",
    // ESPN types some cities as "Mexico city".
    place: [capitalWords(address.city), address.country].filter(function(p) { return !!p }).join(", "),
    broadcasts: espnBroadcasts(comps),
    url: espnUrl(id, ev),
    cancelled: /CANCEL|POSTPONE/.test(status),
    // NASCAR's season opens with exhibitions that aren't rounds.
    countsAsRound: !(id === "nascar" && /\b(Clash|Duel|All-Star)\b/i.test(name)),
    big: !!(crownJewels[id] && crownJewels[id].test(title)),
    sessions: sessions
  })
  if (sessions.length === 0) e.startMs = e.endMs = e.raceMs = parseTime(ev.date)
  return spanSessions(e)
}

// Rounds count every race in the list that isn't cancelled or an
// exhibition.
function numberRounds(events) {
  var bySeason = {}
  events.forEach(function(e) {
    if (e.cancelled || !e.countsAsRound) return
    var key = String(e.season)
    bySeason[key] = (bySeason[key] || 0) + 1
    e.round = bySeason[key]
  })
  events.forEach(function(e) {
    if (e.round > 0) e.rounds = bySeason[String(e.season)]
  })
  return events
}

function byStart(a, b) {
  return a.startMs - b.startMs
}

// Returns null (not []) when the response is unusable, so callers can keep
// the last good schedule instead of blanking it.
function parseEspn(id, raw) {
  var data
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw
  } catch (e) {
    return null
  }
  if (!data || !Array.isArray(data.events)) return null
  var events = data.events
    .map(function(ev) { return parseEspnEvent(id, ev) })
    .filter(function(e) { return !isNaN(e.startMs) })
    .sort(byStart)
  return numberRounds(events)
}

// ---------- MotoGP ----------

var motogpKinds = ["PRACTICE", "QUALIFYING", "RACE", "WARM_UP"]
var lowerWords = ["of", "the", "and", "de", "del", "di", "do", "da"]

function titleCase(text) {
  return String(text || "").toLowerCase().split(/\s+/).filter(function(w) { return w !== "" }).map(function(w, i) {
    if (i > 0 && lowerWords.indexOf(w) >= 0) return w
    return w.charAt(0).toUpperCase() + w.slice(1)
  }).join(" ")
}

// "PETRONAS GRAND PRIX OF MALAYSIA" -> "Grand Prix of Malaysia", short
// "Malaysia GP"; "…OF SAN MARINO AND THE RIMINI RIVIERA" -> "San Marino GP".
function motogpNames(name) {
  var m = /GRAND PRIX OF\s+(.+)$/i.exec(String(name || "").trim())
  if (!m) {
    var plain = titleCase(name)
    return { title: plain, short: plain }
  }
  var place = m[1].trim()
  var short = place.replace(/^THE\s+/i, "").split(/\s+AND\s+/i)[0]
  return { title: titleCase("Grand Prix of " + place), short: titleCase(short) + " GP" }
}

// "Free Practice Nr. 1" -> Practice 1 (FP1), "Qualifying Nr. 2" ->
// Qualifying 2 (Q2), "Tissot Sprint" -> Sprint, "Grand Prix" -> Race.
function motogpSession(b) {
  var raw = String(b.name || "").replace(/\s+/g, " ").trim()
  var kind = String(b.kind || "")
  var n = (/Nr\.\s*(\d+)/.exec(raw) || [])[1] || ""
  var spec
  if (kind === "RACE") spec = /sprint/i.test(raw) ? ["Sprint", "Sprint", "sprint", 30] : ["Race", "Race", "race", 45]
  else if (kind === "QUALIFYING") spec = ["Qualifying" + (n ? " " + n : ""), "Q" + n, "qualifying", 15]
  else if (kind === "WARM_UP") spec = ["Warm Up", "WUP", "warmup", 10]
  else if (/free practice/i.test(raw)) spec = ["Practice " + n, "FP" + n, "practice", 45]
  else spec = [raw || "Practice", "PR", "practice", 60]
  var start = parseTime(b.date_start)
  var s = newSession(spec[0], spec[1], spec[2], start, spec[3])
  var end = parseTime(b.date_end)
  if (end > start) s.endMs = end
  return s
}

// Only the MotoGP class's track sessions: Moto2, Moto3 and the press
// conferences share the same list.
function parseMotoGp(raw) {
  var data
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw
  } catch (e) {
    return null
  }
  if (!Array.isArray(data)) return null
  var events = data.filter(function(ev) { return ev && ev.kind === "GP" }).map(function(ev) {
    var sessions = (Array.isArray(ev.broadcasts) ? ev.broadcasts : []).filter(function(b) {
      return b && b.category && b.category.acronym === "MGP" && motogpKinds.indexOf(b.kind) >= 0
    }).map(motogpSession).filter(function(s) { return !isNaN(s.startMs) }).sort(byStart)
    var names = motogpNames(ev.name)
    var start = parseTime(ev.date_start)
    var e = newEvent("motogp", {
      id: String(ev.id || ""),
      name: String(ev.name || "").trim(),
      title: names.title,
      short: names.short,
      season: start ? new Date(start).getUTCFullYear() : 0,
      circuit: ev.circuit && ev.circuit.name ? String(ev.circuit.name) : "",
      url: motogpCalendarUrl,
      cancelled: /CANCEL|POSTPONE/i.test(String(ev.status || "")),
      sessions: sessions
    })
    if (sessions.length === 0) {
      e.startMs = start
      e.endMs = parseTime(ev.date_end)
      e.raceMs = e.endMs
    }
    return spanSessions(e)
  }).filter(function(e) { return !isNaN(e.startMs) }).sort(byStart)
  return numberRounds(events)
}

// ---------- WEC ----------

var monthIndex = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

var entities = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " " }

function decodeEntities(text) {
  return String(text || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function(all, name) {
    if (name.charAt(0) === "#") {
      var hex = name.charAt(1) === "x" || name.charAt(1) === "X"
      var code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : all
    }
    var key = name.toLowerCase()
    return entities.hasOwnProperty(key) ? entities[key] : all
  })
}

function plainText(html) {
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

function month(name) {
  var m = monthIndex[String(name || "").slice(0, 3).toLowerCase()]
  return m === undefined ? -1 : m
}

// "From 6 to 8 November 2026", "From 30 May to 1 June 2027" or
// "14 April 2026" -> the first and last days, as UTC midnights.
function parseDayRange(text) {
  var t = String(text || "").trim()
  var m = /^From\s+(\d{1,2})(?:\s+([A-Za-z]+))?(?:\s+(\d{4}))?\s+to\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i.exec(t)
  if (m) {
    var endMonth = month(m[5])
    var startMonth = m[2] ? month(m[2]) : endMonth
    if (endMonth < 0 || startMonth < 0) return null
    var endYear = +m[6]
    var startYear = m[3] ? +m[3] : (startMonth > endMonth ? endYear - 1 : endYear)
    return { firstMs: Date.UTC(startYear, startMonth, +m[1]), lastMs: Date.UTC(endYear, endMonth, +m[4]) }
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(t)
  if (m && month(m[2]) >= 0) {
    var day = Date.UTC(+m[3], month(m[2]), +m[1])
    return { firstMs: day, lastMs: day }
  }
  return null
}

// "ROLEX 6 Hours of" + "São Paulo" -> "6 Hours of São Paulo"; "24 Hours of
// Le Mans", "Qatar 1812km" and "Lone Star Le Mans" stand alone.
function wecTitle(prefix, main) {
  var hours = /(\d+)\s+Hours of\s*$/i.exec(prefix)
  return hours ? hours[1] + " Hours of " + main : main
}

// The bar's name: "Monza 6h", "Le Mans 24h", "Qatar 1812km".
function wecShort(title) {
  var m = /^(\d+) Hours of (.+)$/.exec(title)
  return m ? m[2] + " " + m[1] + "h" : title
}

// How long the race runs, for its live window: the hours in its name, or
// about ten for the 1812km.
function wecRaceHours(title) {
  var h = /(\d+) Hours/.exec(title)
  if (h) return +h[1]
  return /\d+\s*km/i.test(title) ? 10 : 6
}

function divText(html, classPart) {
  var re = new RegExp('<div class="[^"]*' + classPart + '[^"]*">([\\s\\S]*?)</div>')
  var m = re.exec(html)
  return m ? plainText(m[1]) : ""
}

// The cards on fiawec.com's home page: one per race, each with its dates
// and, while it's ahead, a countdown to its first practice. Returns null
// when there are none, so a redesign shows as an error.
function parseWecCalendar(raw) {
  var html = String(raw || "")
  var chunks = html.split('<div class="calendar-item')
  if (chunks.length < 2) return null
  var events = []
  for (var i = 1; i < chunks.length; i++) {
    var card = chunks[i].split("</li>")[0]
    var full = card.indexOf('class="infos-full"') >= 0 ? card.slice(card.indexOf('class="infos-full"')) : card
    var main = divText(full, "ff-headings")
    var prefix = divText(full, "ff-normal fw-bold")
    var range = null
    var dateRe = /<div class="[^"]*text-primary[^"]*">([\s\S]*?)<\/div>/g
    var dm
    while (range === null && (dm = dateRe.exec(full)) !== null) range = parseDayRange(plainText(dm[1]))
    if (!main || !range || /prologue/i.test(prefix + " " + main)) continue
    var link = /href="(\/en\/race\/[^"]+)"/.exec(card)
    var countdown = /data-date="(\d+)"/.exec(card)
    var title = wecTitle(prefix, main)
    var e = newEvent("wec", {
      id: link ? link[1] : title,
      name: (prefix ? prefix + " " : "") + main,
      title: title,
      short: wecShort(title),
      season: new Date(range.firstMs).getUTCFullYear(),
      url: link ? wecSite + link[1] : wecUrl,
      detailUrl: link ? wecSite + link[1] : "",
      big: crownJewels.wec.test(title),
      raceHours: wecRaceHours(title),
      sessions: null
    })
    e.startMs = countdown ? parseInt(countdown[1], 10) * 1000 : range.firstMs
    // Noon UTC on the last day keeps the date right in most time zones
    // until the race page gives the real start.
    e.raceMs = range.lastMs + 12 * hourMs
    e.endMs = range.lastMs + dayMs
    events.push(e)
  }
  return numberRounds(events.sort(byStart))
}

function wecClass(part) {
  return /\d/.test(part) || /&/.test(part) ? part : titleCase(part)
}

// "Free Practice 1 - 6 Hours of Monza" -> Practice 1 (FP1); "Hyperpole 2 -
// HYPERCAR - 24 Hours of Le Mans" -> Hyperpole 2 · Hypercar (HP2).
function wecSession(sub, raceHours) {
  var parts = String(sub.name || "").split(" - ").map(function(p) { return p.trim() })
  if (parts.length > 1) parts.pop()
  var head = parts[0] || "Session"
  var classes = parts.slice(1).map(wecClass)
  var n = (/(\d+)\s*$/.exec(head) || [])[1] || ""
  var spec
  if (/^free practice/i.test(head)) spec = ["Practice " + n, "FP" + n, "practice", 90]
  else if (/^hyperpole/i.test(head)) spec = [head, "HP" + n, "qualifying", 15]
  else if (/^qualifying/i.test(head)) spec = [head, "Quali", "qualifying", 15]
  else if (/^warm/i.test(head)) spec = ["Warm-up", "WUP", "warmup", 15]
  else if (/^race/i.test(head)) spec = ["Race", "Race", "race", raceHours * 60]
  else spec = [head, head, "practice", 60]
  var name = spec[0] + (classes.length ? " · " + classes.join(" · ") : "")
  return newSession(name, spec[1], spec[2], parseTime(sub.startDate), spec[3])
}

// A race page's schedule, from its schema.org data. Sessions that share a
// start time are placeholders WEC hasn't timed yet. Returns null when the
// page has no event data.
function parseWecRace(raw, raceHours) {
  var html = String(raw || "")
  var re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  var m
  while ((m = re.exec(html)) !== null) {
    var data
    try {
      data = JSON.parse(m[1])
    } catch (e) {
      continue
    }
    if (!data || data["@type"] !== "SportsEvent") continue
    var hours = raceHours || wecRaceHours(String(data.name || ""))
    var sessions = (Array.isArray(data.subEvent) ? data.subEvent : []).map(function(s) { return wecSession(s, hours) })
      .filter(function(s) { return !isNaN(s.startMs) }).sort(byStart)
    sessions.forEach(function(s) {
      s.tbc = sessions.some(function(o) { return o !== s && o.startMs === s.startMs })
    })
    var location = data.location || {}
    return {
      sessions: sessions,
      place: String(location.address || location.name || ""),
      cancelled: /Cancelled|Postponed/.test(String(data.eventStatus || ""))
    }
  }
  return null
}

// A WEC event with its race page's schedule folded in, once it's loaded.
function withDetail(event, detail) {
  if (!detail || !detail.sessions) return event
  var e = {}
  for (var k in event) e[k] = event[k]
  e.sessions = detail.sessions
  e.place = detail.place || e.place
  e.cancelled = e.cancelled || detail.cancelled
  return spanSessions(e)
}

function withDetails(events, details) {
  return (events || []).map(function(e) { return withDetail(e, details ? details[e.detailUrl] : null) })
}

// A page is fetched when its race is shown, then again hourly; a minute
// after a failure.
function detailStale(entry, nowMs) {
  if (!entry) return true
  return nowMs - entry.fetchedAt > (entry.failed ? minuteMs : hourMs)
}

function parseFeed(id, raw) {
  if (id === "wec") return parseWecCalendar(raw)
  if (id === "motogp") return parseMotoGp(raw)
  return parseEspn(seriesId(id), raw)
}

// ---------- the schedule ----------

function sessionLive(s, nowMs) {
  if (s.state === "in") return true
  return s.state !== "post" && nowMs >= s.startMs && nowMs < s.endMs
}

function sessionDone(s, nowMs) {
  return s.state === "post" || (s.state !== "in" && nowMs >= s.endMs)
}

function upcoming(events, nowMs) {
  return (events || []).filter(function(e) { return nowMs < e.endMs + keepAfterMs })
}

// Once a season's last race is a day gone, it's time to load the next.
function seasonOver(events, nowMs) {
  return upcoming(events, nowMs).length === 0
}

// ESPN's results come in during a session, so its series poll every two
// minutes while one is on; the WEC's and MotoGP's calendars only change
// between weekends.
function pollMinutes(id, live, refreshMinutes) {
  if (!usesSeasons(id) || id === "motogp") return 360
  return live ? 2 : refreshMinutes
}

// The first race that isn't over or called off: the one whose WEC page is
// worth fetching ahead of being shown.
function firstAhead(events, nowMs) {
  var list = events || []
  for (var i = 0; i < list.length; i++) {
    if (!list[i].cancelled && nowMs < list[i].endMs) return list[i]
  }
  return null
}

// The session to count down to: the one on now, or the next. A WEC race
// whose page hasn't loaded counts down to its first practice.
function nextSession(event, nowMs) {
  if (!event || event.cancelled) return null
  if (event.sessions === null) {
    return nowMs < event.startMs ? newSession("Practice 1", "FP1", "practice", event.startMs, 90) : null
  }
  for (var i = 0; i < event.sessions.length; i++) {
    if (!sessionDone(event.sessions[i], nowMs)) return event.sessions[i]
  }
  return null
}

function eventLive(event, nowMs) {
  var s = nextSession(event, nowMs)
  return !!s && sessionLive(s, nowMs)
}

function parts(diffMs) {
  var minutes = Math.max(0, Math.floor(diffMs / minuteMs))
  return { days: Math.floor(minutes / 1440), hours: Math.floor(minutes % 1440 / 60), minutes: minutes % 60 }
}

// Compact countdown for the bar: "6d", "5h", "12m".
function countdown(targetMs, nowMs) {
  var diff = targetMs - nowMs
  if (isNaN(diff)) return ""
  if (diff < minuteMs) return "now"
  var p = parts(diff)
  if (p.days > 0) return p.days + "d"
  if (p.hours > 0) return p.hours + "h"
  return p.minutes + "m"
}

// Two-unit countdown for the panel: "6d 8h", "5h 12m", "12m".
function countdownLong(targetMs, nowMs) {
  var diff = targetMs - nowMs
  if (isNaN(diff)) return ""
  if (diff < minuteMs) return "now"
  var p = parts(diff)
  if (p.days > 0) return p.days + "d " + p.hours + "h"
  if (p.hours > 0) return p.hours + "h " + p.minutes + "m"
  return p.minutes + "m"
}

// The status pill: what's on, what's next, or that it's over.
function statusText(event, nowMs) {
  if (!event) return ""
  if (event.cancelled) return "Cancelled"
  var s = nextSession(event, nowMs)
  if (!s) return "Finished"
  if (sessionLive(s, nowMs)) return "Live · " + s.name
  if (s.tbc) return s.name + " in " + countdown(s.startMs, nowMs)
  return s.name + " in " + countdownLong(s.startMs, nowMs)
}

// The bar's pick: the next session of the followed series, or of whichever
// shown series is soonest. Live sessions win.
function barPick(feeds, followed, nowMs) {
  var best = null
  var list = feeds || []
  list.forEach(function(f) {
    if (followed !== "any" && f.series !== followed) return
    var events = upcoming(f.events, nowMs)
    for (var i = 0; i < events.length; i++) {
      var s = nextSession(events[i], nowMs)
      if (!s) continue
      var rank = sessionLive(s, nowMs) ? -Infinity : s.startMs
      if (!best || rank < best.rank) best = { event: events[i], session: s, rank: rank }
      break
    }
  })
  return best
}

// The icon style is the flag alone, so only the race style has text.
function barLabel(pick, nowMs, style) {
  if (!pick || labelStyle(style) === "icon") return ""
  var when = sessionLive(pick.session, nowMs) ? "LIVE" : countdown(pick.session.startMs, nowMs)
  return pick.event.short + " · " + pick.session.short + " " + when
}

// "locale" defers to the system's short time format, which may be 12-hour
// even when the bar clock is set to 24-hour.
function timeFormat(clock, localeFormat) {
  if (clock === "24h") return "HH:mm"
  if (clock === "12h") return "h:mm AP"
  return localeFormat || "HH:mm"
}

// Sessions grouped by the viewer's local day, for the panel's headings.
function sessionDays(event) {
  var days = []
  var sessions = (event && event.sessions) || []
  sessions.forEach(function(s) {
    var d = new Date(s.startMs)
    var key = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate()
    var last = days[days.length - 1]
    if (!last || last.key !== key) {
      last = { key: key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), sessions: [] }
      days.push(last)
    }
    last.sessions.push(s)
  })
  return days
}

function isRace(s) {
  return s.kind === "race" || s.kind === "sprint"
}

// Races show their podium on a line of their own; other sessions name
// whoever was quickest.
function podium(s) {
  if (!isRace(s)) return ""
  return s.results.map(function(r) { return r.pos + " " + r.name }).join("  ·  ")
}

function quickest(s) {
  return !isRace(s) && s.results.length > 0 ? s.results[0].name : ""
}

function caption(event) {
  if (!event) return ""
  var name = seriesInfo[event.series].name
  return event.round > 0 ? name + " · Round " + event.round + " / " + event.rounds : name
}

function venueLine(event) {
  if (!event) return ""
  return [event.circuit, event.place].filter(function(p) { return p !== "" }).join(" · ")
}

if (typeof module !== "undefined") {
  module.exports = {
    glyphs: glyphs,
    series: series,
    follows: follows,
    labelStyles: labelStyles,
    seriesInfo: seriesInfo,
    keepAfterMs: keepAfterMs,
    seriesId: seriesId,
    follow: follow,
    labelStyle: labelStyle,
    switchedOn: switchedOn,
    feedUrl: feedUrl,
    usesSeasons: usesSeasons,
    parseTime: parseTime,
    f1Title: f1Title,
    parseEspn: parseEspn,
    motogpNames: motogpNames,
    parseMotoGp: parseMotoGp,
    plainText: plainText,
    parseDayRange: parseDayRange,
    wecTitle: wecTitle,
    wecShort: wecShort,
    wecRaceHours: wecRaceHours,
    parseWecCalendar: parseWecCalendar,
    parseWecRace: parseWecRace,
    withDetail: withDetail,
    withDetails: withDetails,
    detailStale: detailStale,
    parseFeed: parseFeed,
    sessionLive: sessionLive,
    sessionDone: sessionDone,
    upcoming: upcoming,
    seasonOver: seasonOver,
    pollMinutes: pollMinutes,
    firstAhead: firstAhead,
    nextSession: nextSession,
    eventLive: eventLive,
    countdown: countdown,
    countdownLong: countdownLong,
    statusText: statusText,
    barPick: barPick,
    barLabel: barLabel,
    timeFormat: timeFormat,
    sessionDays: sessionDays,
    podium: podium,
    quickest: quickest,
    caption: caption,
    venueLine: venueLine
  }
}
