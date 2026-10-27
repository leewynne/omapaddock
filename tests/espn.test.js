const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const Model = require("../Model.js")

// Trimmed ESPN responses captured on 27 Oct 2026, cut to a few races and
// each session's top four.
const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
const now = Date.UTC(2026, 9, 27, 18, 0)

const f1 = () => Model.parseFeed("f1", fixture("f1.json"))
const find = (events, text) => events.find(e => e.name.includes(text))

test("each ESPN series reads a whole season from its own scoreboard", () => {
  assert.equal(Model.feedUrl("f1", 2026), "https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard?limit=100&dates=20260101-20261231")
  assert.match(Model.feedUrl("indycar", 2027), /\/racing\/irl\/scoreboard\?limit=100&dates=20270101-20271231$/)
  assert.match(Model.feedUrl("nascar", 2026), /\/racing\/nascar-premier\/scoreboard\?/)
  assert.match(Model.feedUrl("junk", 2026), /\/racing\/f1\/scoreboard\?/)
  assert.equal(Model.usesSeasons("f1"), true)
})

test("F1 race names lose their sponsors", () => {
  assert.equal(Model.f1Title("Heineken Las Vegas Grand Prix"), "Las Vegas Grand Prix")
  assert.equal(Model.f1Title("MSC Cruises São Paulo Grand Prix"), "São Paulo Grand Prix")
  assert.equal(Model.f1Title("Gulf Air Bahrain Grand Prix in Malaysia"), "Bahrain Grand Prix in Malaysia")
  assert.equal(Model.f1Title("Monaco Grand Prix"), "Monaco Grand Prix")
  assert.equal(Model.f1Title("Grand Prix"), "Grand Prix")
  assert.equal(Model.f1Title("Pre-season testing"), "Pre-season testing")
  assert.deepEqual(f1().map(e => e.short), [
    "Chinese GP", "Bahrain GP", "Saudi Arabian GP", "Monaco GP", "Bahrain GP in Malaysia",
    "Singapore GP", "United States GP", "Mexico City GP", "Abu Dhabi GP"
  ])
})

test("cancelled F1 races are marked and don't count as rounds", () => {
  const events = f1()
  const bahrain = find(events, "Gulf Air Bahrain Grand Prix")
  assert.equal(bahrain.cancelled, true)
  assert.equal(bahrain.round, 0)
  assert.equal(Model.statusText(bahrain, Date.UTC(2026, 3, 1)), "Cancelled")
  assert.equal(Model.nextSession(bahrain, Date.UTC(2026, 3, 1)), null)
  assert.deepEqual(events.filter(e => e.round > 0).map(e => e.round), [1, 2, 3, 4, 5, 6, 7])
  assert.equal(find(events, "Mexico").rounds, 7)
  assert.equal(Model.caption(find(events, "Mexico")), "Formula 1 · Round 6 / 7")
})

test("an F1 weekend lists every session in order, sprint weekends included", () => {
  const singapore = find(f1(), "Singapore")
  assert.deepEqual(singapore.sessions.map(s => s.name), ["Practice 1", "Sprint Qualifying", "Sprint", "Qualifying", "Race"])
  assert.deepEqual(singapore.sessions.map(s => s.short), ["FP1", "SQ", "Sprint", "Quali", "Race"])
  assert.deepEqual(singapore.sessions.map(s => s.kind), ["practice", "qualifying", "sprint", "qualifying", "race"])
  assert.equal(singapore.raceMs, Date.UTC(2026, 9, 11, 12, 0))
  assert.equal(singapore.endMs, Date.UTC(2026, 9, 11, 14, 0))
})

test("finished sessions carry results: a podium for races, the quickest otherwise", () => {
  const austin = find(f1(), "United States")
  const [fp1, , , quali, race] = austin.sessions
  assert.equal(Model.quickest(fp1), "Leclerc")
  assert.equal(Model.podium(fp1), "")
  assert.equal(Model.quickest(quali), "Antonelli")
  assert.equal(Model.podium(race), "1 Antonelli  ·  2 Leclerc  ·  3 Verstappen")
  assert.equal(Model.quickest(race), "")
  assert.equal(race.results[0].country, "Italy")
  assert.equal(Model.statusText(austin, now), "Finished")
})

test("the next F1 race: where, on what, and how long until it starts", () => {
  const mexico = find(f1(), "Mexico")
  assert.equal(mexico.title, "Mexico City Grand Prix")
  assert.equal(Model.venueLine(mexico), "Autodromo Hermanos Rodriguez · Mexico City, Mexico")
  assert.deepEqual(mexico.broadcasts, ["Apple TV"])
  assert.equal(mexico.url, "https://www.espn.com/f1/race/_/id/600057447")
  assert.equal(mexico.big, false)
  assert.equal(find(f1(), "Monaco").big, true)
  assert.equal(Model.statusText(mexico, now), "Practice 1 in 3d 0h")
  assert.equal(mexico.sessions[0].results.length, 0)
})

test("a finished round stays listed for a day after its last session", () => {
  const events = f1()
  const austin = find(events, "United States")
  assert.ok(Model.upcoming(events, austin.endMs + 23 * 3600e3).includes(austin))
  assert.ok(!Model.upcoming(events, austin.endMs + 25 * 3600e3).includes(austin))
  assert.equal(Model.seasonOver(events, now), false)
})

test("NASCAR names its races by track and skips its exhibitions when counting", () => {
  const events = Model.parseFeed("nascar", fixture("nascar.json"))
  const clash = find(events, "Clash")
  const daytona = find(events, "Daytona 500")
  assert.equal(clash.round, 0)
  assert.equal(find(events, "Duel").round, 0)
  assert.equal(daytona.round, 1)
  assert.equal(daytona.big, true)
  assert.equal(daytona.short, "Daytona 500")
  const next = Model.upcoming(events, now).find(e => !Model.sessionDone(e.sessions[0], now))
  assert.equal(next.title, "Cup Series at Martinsville")
  assert.equal(next.short, "Martinsville")
  assert.deepEqual(next.sessions.map(s => s.name), ["Race"])
  assert.deepEqual(next.broadcasts, ["NBC", "HBO Max"])
  assert.equal(next.url, "https://www.espn.com/racing/schedule/_/series/sprint")
  assert.equal(Model.venueLine(next), "")
  assert.equal(Model.statusText(next, now), "Race in 5d 1h")
  const talladega = events.filter(e => e.name.includes("Talladega")).pop()
  assert.equal(Model.podium(talladega.sessions[0]), "1 Larson  ·  2 Byron  ·  3 Stenhouse Jr.")
})

test("IndyCar's season is over, so the next one is due", () => {
  const events = Model.parseFeed("indycar", fixture("indycar.json"))
  assert.equal(Model.seasonOver(events, now), true)
  assert.equal(find(events, "Indianapolis 500").big, true)
  assert.equal(find(events, "Monterey").short, "Monterey GP")
  assert.equal(find(events, "Monterey").url, "https://www.espn.com/racing/schedule/_/series/indycar")
})

test("parseEspn copes with unusable responses and sparse events", () => {
  assert.equal(Model.parseFeed("f1", ""), null)
  assert.equal(Model.parseFeed("f1", "<html>"), null)
  assert.equal(Model.parseFeed("f1", "{}"), null)
  const [bare, odd] = Model.parseFeed("f1", JSON.stringify({ events: [
    { id: "1", name: "Pre-season testing", date: "2027-02-25T08:00Z" },
    { id: "2", name: "Test", date: "2027-03-01T08:00Z", competitions: [
      { date: "2027-03-01T08:00Z", type: { abbreviation: "FP4" } },
      { date: "2027-03-01T09:00Z" },
      { date: "soon" }
    ] },
    { id: "3", name: "Nothing" }
  ] }))
  assert.equal(bare.sessions.length, 0)
  assert.equal(bare.startMs, Date.UTC(2027, 1, 25, 8))
  assert.equal(bare.url, "https://www.espn.com/f1/schedule")
  assert.equal(Model.nextSession(bare, now), null)
  assert.deepEqual(odd.sessions.map(s => s.name), ["FP4", "Session"])
  assert.equal(odd.raceMs, Date.UTC(2027, 2, 1, 9))
  assert.equal(odd.season, 0)
})
