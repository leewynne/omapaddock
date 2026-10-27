const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const Model = require("../Model.js")

const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
const now = Date.UTC(2026, 9, 27, 18, 0)

function feeds() {
  return Model.series.filter(id => id !== "wec").map(id => ({
    series: id,
    events: Model.parseFeed(id, fixture(id === "indycar" ? "indycar.json" : id + ".json"))
  })).concat([{ series: "wec", events: Model.parseFeed("wec", fixture("wec-home.html")) }])
}

test("parseTime reads ESPN's, MotoGP's and WEC's timestamps", () => {
  assert.equal(Model.parseTime("2026-11-01T20:00Z"), Date.UTC(2026, 10, 1, 20))
  assert.equal(Model.parseTime("2026-10-30T10:45:00+0800"), Date.UTC(2026, 9, 30, 2, 45))
  assert.equal(Model.parseTime("2027-06-12T16:00:00+02:00"), Date.UTC(2027, 5, 12, 14))
  assert.equal(Model.parseTime("2027-06-12T16:00:00-05:30"), Date.UTC(2027, 5, 12, 21, 30))
  assert.equal(Model.parseTime("2027-06-12T16:00:00.250"), Date.UTC(2027, 5, 12, 16))
  assert.ok(isNaN(Model.parseTime("Sunday")))
  assert.ok(isNaN(Model.parseTime(undefined)))
})

test("countdowns shorten for the bar and stay two units long in the panel", () => {
  const day = 86400e3
  assert.equal(Model.countdown(now + 3 * day + 5 * 3600e3, now), "3d")
  assert.equal(Model.countdown(now + 5 * 3600e3, now), "5h")
  assert.equal(Model.countdown(now + 12 * 60e3, now), "12m")
  assert.equal(Model.countdown(now + 10e3, now), "now")
  assert.equal(Model.countdown(NaN, now), "")
  assert.equal(Model.countdownLong(now + 3 * day + 5 * 3600e3, now), "3d 5h")
  assert.equal(Model.countdownLong(now + 5 * 3600e3 + 12 * 60e3, now), "5h 12m")
  assert.equal(Model.countdownLong(now + 12 * 60e3, now), "12m")
  assert.equal(Model.countdownLong(now, now), "now")
  assert.equal(Model.countdownLong(NaN, now), "")
})

test("the bar follows F1 by default, or whichever series is next", () => {
  const all = feeds()
  const f1 = Model.barPick(all, "f1", now)
  assert.equal(f1.event.short, "Mexico City GP")
  assert.equal(f1.session.short, "FP1")
  assert.equal(Model.barLabel(f1, now, "race"), "Mexico City GP · FP1 3d")
  assert.equal(Model.barLabel(f1, now, "icon"), "")
  const any = Model.barPick(all, "any", now)
  assert.equal(Model.barLabel(any, now, "race"), "Malaysia GP · FP1 2d")
  const wec = Model.barPick(all, "wec", now)
  assert.equal(Model.barLabel(wec, now, "race"), "Monza 6h · FP1 9d")
  assert.equal(Model.barPick(all, "indycar", now), null)
  assert.equal(Model.barLabel(null, now, "race"), "")
  assert.equal(Model.barPick(null, "any", now), null)
})

test("a live session beats an earlier start, and shows LIVE", () => {
  const all = feeds()
  const sprint = all.find(f => f.series === "motogp").events[1].sessions[5]
  const during = sprint.startMs + 5 * 60e3
  const pick = Model.barPick(all, "any", during)
  assert.equal(pick.session, sprint)
  assert.equal(Model.barLabel(pick, during, "race"), "Malaysia GP · Sprint LIVE")
})

test("ESPN's series poll fast during sessions; WEC and MotoGP every six hours", () => {
  assert.equal(Model.pollMinutes("f1", false, 30), 30)
  assert.equal(Model.pollMinutes("nascar", true, 30), 2)
  assert.equal(Model.pollMinutes("wec", true, 30), 360)
  assert.equal(Model.pollMinutes("motogp", false, 30), 360)
})

test("firstAhead skips finished and cancelled races", () => {
  const events = Model.parseFeed("f1", fixture("f1.json"))
  assert.equal(Model.firstAhead(events, now).short, "Mexico City GP")
  assert.equal(Model.firstAhead(events, Date.UTC(2026, 3, 1)).short, "Monaco GP")
  assert.equal(Model.firstAhead(events, Date.UTC(2027, 0, 1)), null)
  assert.equal(Model.firstAhead(null, now), null)
})

test("ESPN's own live state wins over the clock", () => {
  const s = { state: "in", startMs: now + 3600e3, endMs: now + 7200e3 }
  assert.equal(Model.sessionLive(s, now), true)
  assert.equal(Model.sessionDone(s, now + 9000e3), false)
  const done = { state: "post", startMs: now - 60e3, endMs: now + 3600e3 }
  assert.equal(Model.sessionLive(done, now), false)
  assert.equal(Model.sessionDone(done, now), true)
})

test("an unconfirmed session counts down in whole units", () => {
  const event = { sessions: [{ name: "Race", short: "Race", kind: "race", startMs: now + 3 * 86400e3 + 3600e3, endMs: now + 4 * 86400e3, tbc: true, state: "", results: [] }] }
  assert.equal(Model.statusText(event, now), "Race in 3d")
  assert.equal(Model.statusText(null, now), "")
})

test("sessions group by the viewer's local day", () => {
  const mexico = Model.parseFeed("f1", fixture("f1.json")).find(e => e.name.includes("Mexico"))
  const days = Model.sessionDays(mexico)
  const local = ms => new Date(ms).toDateString()
  assert.equal(days.reduce((n, d) => n + d.sessions.length, 0), 5)
  days.forEach(d => {
    d.sessions.forEach(s => assert.equal(local(s.startMs), d.date.toDateString()))
    assert.equal(d.date.getHours(), 0)
  })
  for (let i = 1; i < days.length; i++) assert.ok(days[i - 1].date < days[i].date)
  assert.deepEqual(Model.sessionDays(null), [])
  assert.deepEqual(Model.sessionDays({ sessions: null }), [])
})

test("settings fall back to their defaults", () => {
  assert.equal(Model.seriesId("wec"), "wec")
  assert.equal(Model.seriesId("dtm"), "f1")
  assert.equal(Model.follow("any"), "any")
  assert.equal(Model.follow(undefined), "f1")
  assert.equal(Model.labelStyle("icon"), "icon")
  assert.equal(Model.labelStyle("badge"), "race")
  assert.equal(Model.switchedOn(true), true)
  assert.equal(Model.switchedOn(undefined), true)
  assert.equal(Model.switchedOn(false), false)
  assert.equal(Model.switchedOn("false"), false)
  assert.equal(Model.timeFormat("24h", "h:mm AP"), "HH:mm")
  assert.equal(Model.timeFormat("12h", "HH:mm"), "h:mm AP")
  assert.equal(Model.timeFormat("locale", "h:mm AP"), "h:mm AP")
  assert.equal(Model.timeFormat("locale", ""), "HH:mm")
  assert.equal(Model.caption(null), "")
  assert.equal(Model.venueLine(null), "")
  assert.equal(Model.caption({ series: "wec", round: 0 }), "World Endurance Championship")
})

test("the manifest's settings stay in step with the model", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"))
  const schema = Object.fromEntries(manifest.barWidget.schema.map(s => [s.key, s]))
  const defaults = manifest.barWidget.defaults
  assert.deepEqual(schema.label.options, Model.labelStyles)
  assert.deepEqual(schema.follow.options, Model.follows)
  assert.equal(defaults.follow, "f1")
  Model.series.forEach(id => {
    assert.equal(schema[id].type, "boolean", id)
    assert.equal(schema[id].defaultValue, true, id)
    assert.equal(defaults[id], true, id)
  })
  Object.keys(defaults).forEach(key => assert.equal(schema[key].defaultValue, defaults[key], key))
})
