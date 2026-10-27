const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const Model = require("../Model.js")

// The WEC fixtures are made up in the shape of fiawec.com's pages, since its
// terms don't allow copying them.
const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
const now = Date.UTC(2026, 9, 27, 18, 0)

const calendar = () => Model.parseFeed("wec", fixture("wec-home.html"))

test("WEC's schedule is the race cards on its home page", () => {
  assert.equal(Model.feedUrl("wec", 2026), "https://www.fiawec.com/en/")
  assert.equal(Model.usesSeasons("wec"), false)
  const events = calendar()
  assert.deepEqual(events.map(e => e.title), ["24 Hours of Le Mans", "6 Hours of Barcelona", "6 Hours of Monza", "Qatar 1812km", "24 Hours of Le Mans"])
  assert.deepEqual(events.map(e => e.short), ["Le Mans 24h", "Barcelona 6h", "Monza 6h", "Qatar 1812km", "Le Mans 24h"])
  assert.deepEqual(events.map(e => e.raceHours), [24, 6, 6, 10, 24])
  assert.deepEqual(events.map(e => e.big), [true, false, false, false, true])
  assert.deepEqual(events.map(e => [e.season, e.round, e.rounds]), [[2026, 1, 3], [2026, 2, 3], [2026, 3, 3], [2027, 1, 2], [2027, 2, 2]])
})

test("a card gives the race page, first practice and race day", () => {
  const events = calendar()
  const monza = events[2]
  assert.equal(monza.url, "https://www.fiawec.com/en/race/6-hours-of-monza-2026")
  assert.equal(monza.detailUrl, monza.url)
  assert.equal(monza.startMs, Date.UTC(2026, 10, 6, 9, 30))
  assert.equal(monza.raceMs, Date.UTC(2026, 10, 8, 12))
  assert.equal(monza.sessions, null)
  assert.equal(Model.statusText(monza, now), "Practice 1 in 9d 15h")
  const lemans27 = events[4]
  assert.equal(lemans27.url, "https://www.fiawec.com/en/")
  assert.equal(lemans27.detailUrl, "")
  assert.equal(lemans27.endMs, Date.UTC(2027, 5, 14))
  const barcelona = events[1]
  assert.equal(barcelona.startMs, Date.UTC(2026, 9, 16), "past cards have no countdown, so the first day stands in")
  assert.equal(Model.nextSession(barcelona, now), null)
})

test("date ranges read across months and years", () => {
  assert.deepEqual(Model.parseDayRange("From 6 to 8 November 2026"), { firstMs: Date.UTC(2026, 10, 6), lastMs: Date.UTC(2026, 10, 8) })
  assert.deepEqual(Model.parseDayRange("From 30 May to 1 June 2027"), { firstMs: Date.UTC(2027, 4, 30), lastMs: Date.UTC(2027, 5, 1) })
  assert.deepEqual(Model.parseDayRange("From 30 December to 2 January 2027"), { firstMs: Date.UTC(2026, 11, 30), lastMs: Date.UTC(2027, 0, 2) })
  assert.deepEqual(Model.parseDayRange("From 28 December 2026 to 3 January 2027"), { firstMs: Date.UTC(2026, 11, 28), lastMs: Date.UTC(2027, 0, 3) })
  assert.deepEqual(Model.parseDayRange("14 April 2026"), { firstMs: Date.UTC(2026, 3, 14), lastMs: Date.UTC(2026, 3, 14) })
  assert.equal(Model.parseDayRange("From 6 to 8 Brumaire 2026"), null)
  assert.equal(Model.parseDayRange("14 Brumaire 2026"), null)
  assert.equal(Model.parseDayRange("Dates to be confirmed"), null)
})

test("names keep the race and drop the sponsor", () => {
  assert.equal(Model.wecTitle("ROLEX 6 Hours of", "São Paulo"), "6 Hours of São Paulo")
  assert.equal(Model.wecTitle("", "Lone Star Le Mans"), "Lone Star Le Mans")
  assert.equal(Model.wecShort("Lone Star Le Mans"), "Lone Star Le Mans")
  assert.equal(Model.wecRaceHours("Lone Star Le Mans"), 6)
  assert.equal(Model.plainText("Somebody&#039;s &amp; &#x41; &bogus; &#0;"), "Somebody's & A &bogus; &#0;")
})

test("a race page gives every session in order, by class", () => {
  const detail = Model.parseWecRace(fixture("wec-race.html"), 6)
  assert.deepEqual(detail.sessions.map(s => s.name), [
    "Media day", "Practice 1", "Practice 2", "Practice 3", "Qualifying · LMGT3", "Hyperpole · LMGT3",
    "Qualifying · Hypercar", "Hyperpole · Hypercar", "Race"
  ])
  assert.deepEqual(detail.sessions.map(s => s.short), ["Media day", "FP1", "FP2", "FP3", "Quali", "HP", "Quali", "HP", "Race"])
  assert.equal(detail.sessions.every(s => !s.tbc), true)
  const race = detail.sessions[8]
  assert.equal(race.startMs, Date.UTC(2026, 10, 8, 10, 0))
  assert.equal(race.endMs - race.startMs, 6 * 3600e3)
  assert.equal(detail.place, "Monza, ITA")
  assert.equal(detail.cancelled, false)
})

test("sessions sharing a placeholder time are marked to be confirmed", () => {
  const detail = Model.parseWecRace(fixture("wec-lemans.html"))
  assert.deepEqual(detail.sessions.map(s => [s.short, s.tbc]), [["FP1", true], ["HP1", true], ["Quali", true], ["HP2", true], ["Race", false]])
  assert.equal(detail.sessions[2].name, "Qualifying · LMP2 & LMGT3")
  assert.equal(detail.sessions[4].endMs - detail.sessions[4].startMs, 24 * 3600e3)
  assert.equal(detail.place, "24 Heures du Mans")
  assert.equal(detail.cancelled, true)
  assert.equal(Model.parseWecRace("<html></html>"), null)
  assert.equal(Model.parseWecRace('<script type="application/ld+json">{"@type": "SportsEvent"}</script>').sessions.length, 0)
})

test("a loaded race page fills in the card", () => {
  const events = calendar()
  const monza = events[2]
  const detail = Model.parseWecRace(fixture("wec-race.html"), monza.raceHours)
  const full = Model.withDetail(monza, detail)
  assert.notEqual(full, monza)
  assert.equal(monza.sessions, null, "the card itself is left alone")
  assert.equal(full.startMs, Date.UTC(2026, 10, 5, 14, 0))
  assert.equal(full.raceMs, Date.UTC(2026, 10, 8, 10, 0))
  assert.equal(full.endMs, Date.UTC(2026, 10, 8, 16, 0))
  assert.equal(full.place, "Monza, ITA")
  assert.equal(Model.venueLine(full), "Monza, ITA")
  assert.equal(Model.statusText(full, now), "Media day in 8d 20h")
  assert.equal(Model.withDetail(monza, null), monza)
  assert.equal(Model.withDetail(monza, { sessions: null, failed: true }), monza)
  const merged = Model.withDetails(events, { [monza.detailUrl]: detail })
  assert.equal(merged[2].sessions.length, 9)
  assert.equal(merged[0], events[0])
  assert.deepEqual(Model.withDetails(null, {}), [])
})

test("race pages refetch hourly, and a minute after failing", () => {
  assert.equal(Model.detailStale(null, now), true)
  assert.equal(Model.detailStale({ fetchedAt: now - 30 * 60e3, failed: false }, now), false)
  assert.equal(Model.detailStale({ fetchedAt: now - 61 * 60e3, failed: false }, now), true)
  assert.equal(Model.detailStale({ fetchedAt: now - 30e3, failed: true }, now), false)
  assert.equal(Model.detailStale({ fetchedAt: now - 90e3, failed: true }, now), true)
})

test("a page without race cards is an error, not an empty calendar", () => {
  assert.equal(Model.parseFeed("wec", ""), null)
  assert.equal(Model.parseFeed("wec", "<html>Maintenance</html>"), null)
  assert.deepEqual(Model.parseFeed("wec", '<div class="calendar-item"></div>'), [])
})
