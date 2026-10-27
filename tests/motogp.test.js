const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const Model = require("../Model.js")

// A trimmed copy of MotoGP's 2026 events feed from 27 Oct 2026: Australia
// (run), Malaysia (ahead) and a test, cut to the MotoGP class's sessions
// and one Moto2 race.
const raw = fs.readFileSync(path.join(__dirname, "fixtures", "motogp.json"), "utf8")
const now = Date.UTC(2026, 9, 27, 18, 0)

test("MotoGP's feed is a season of events from its own API", () => {
  assert.equal(Model.feedUrl("motogp", 2027), "https://api.motogp.pulselive.com/motogp/v1/events?seasonYear=2027")
  assert.equal(Model.usesSeasons("motogp"), true)
})

test("only Grands Prix are listed, tests aren't", () => {
  const events = Model.parseFeed("motogp", raw)
  assert.deepEqual(events.map(e => e.title), ["Grand Prix of Australia", "Grand Prix of Malaysia"])
  assert.deepEqual(events.map(e => e.short), ["Australia GP", "Malaysia GP"])
  assert.deepEqual(events.map(e => e.round), [1, 2])
  assert.equal(events[1].circuit, "Petronas Sepang International Circuit")
  assert.equal(events[1].url, "https://www.motogp.com/en/calendar")
  assert.equal(events[1].season, 2026)
})

test("names drop the sponsor and the long tails", () => {
  assert.deepEqual(Model.motogpNames("RED BULL GRAND PRIX OF THE UNITED STATES"), { title: "Grand Prix of the United States", short: "United States GP" })
  assert.deepEqual(Model.motogpNames("GRAND PRIX OF SAN MARINO AND THE RIMINI RIVIERA"), { title: "Grand Prix of San Marino and the Rimini Riviera", short: "San Marino GP" })
  assert.deepEqual(Model.motogpNames("VALENCIA TEST"), { title: "Valencia Test", short: "Valencia Test" })
})

test("a weekend lists the MotoGP class's track sessions, with their real end times", () => {
  const malaysia = Model.parseFeed("motogp", raw)[1]
  assert.deepEqual(malaysia.sessions.map(s => s.short), ["FP1", "PR", "FP2", "Q1", "Q2", "Sprint", "WUP", "Race"])
  assert.deepEqual(malaysia.sessions.map(s => s.name), ["Practice 1", "Practice", "Practice 2", "Qualifying 1", "Qualifying 2", "Sprint", "Warm Up", "Race"])
  const [fp1] = malaysia.sessions
  assert.equal(fp1.startMs, Date.UTC(2026, 9, 30, 2, 45))
  assert.equal(fp1.endMs, Date.UTC(2026, 9, 30, 3, 30))
  const sprint = malaysia.sessions[5]
  assert.equal(sprint.endMs - sprint.startMs, 30 * 60e3, "a race's end is its start, so it gets a usual length")
  assert.equal(malaysia.raceMs, Date.UTC(2026, 10, 1, 7, 0))
  assert.equal(Model.statusText(malaysia, now), "Practice 1 in 2d 8h")
})

test("sessions go live on the clock, since the feed has no live state", () => {
  const malaysia = Model.parseFeed("motogp", raw)[1]
  const sprint = malaysia.sessions[5]
  const during = sprint.startMs + 10 * 60e3
  assert.equal(Model.sessionLive(sprint, during), true)
  assert.equal(Model.eventLive(malaysia, during), true)
  assert.equal(Model.statusText(malaysia, during), "Live · Sprint")
  assert.equal(Model.sessionLive(sprint, sprint.endMs), false)
  assert.equal(Model.statusText(malaysia, sprint.endMs), "Warm Up in 19h 10m")
})

test("parseMotoGp copes with unusable responses and bare events", () => {
  assert.equal(Model.parseFeed("motogp", ""), null)
  assert.equal(Model.parseFeed("motogp", "{}"), null)
  const [bare] = Model.parseFeed("motogp", JSON.stringify([
    { kind: "GP", name: "GRAND PRIX OF NOWHERE", status: "CANCELLED", date_start: "2027-03-01T00:00:00+0000", date_end: "2027-03-03T23:59:00+0000",
      broadcasts: [{ kind: "PRACTICE", name: "Shakedown", date_start: "2027-03-01T09:00:00+0000", category: { acronym: "MGP" } }] },
    { kind: "GP", name: "GRAND PRIX OF SOMEWHERE", date_start: "2027-03-08T00:00:00+0000", date_end: "2027-03-10T23:59:00+0000" },
    { kind: "GP", name: "GRAND PRIX OF NO DATE" },
    null
  ]))
  assert.equal(bare.cancelled, true)
  assert.equal(bare.round, 0)
  assert.deepEqual(bare.sessions.map(s => [s.name, s.short]), [["Shakedown", "PR"]])
  const somewhere = Model.parseFeed("motogp", JSON.stringify([{ kind: "GP", name: "GRAND PRIX OF SOMEWHERE", date_start: "2027-03-08T00:00:00+0000", date_end: "2027-03-10T23:59:00+0000" }]))[0]
  assert.equal(somewhere.sessions.length, 0)
  assert.equal(somewhere.endMs, Date.UTC(2027, 2, 10, 23, 59))
})
