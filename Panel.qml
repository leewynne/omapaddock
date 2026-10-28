import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Fetches the F1, IndyCar and NASCAR schedules from ESPN, the WEC's from
// fiawec.com and MotoGP's from its own API, and shows one race weekend at a
// time. The switch at the top (or f/w/m/i/n) changes series; the arrows (or
// h/l) step through the rounds; Return opens the race's page.
Panel {
  id: root
  moduleName: "leewynne.omapaddock"
  manageIpc: false

  property var anchorItem: null

  // The bar identifies an open panel by the widget in its slot, so the
  // popout coordinator and Tab switching have to see BarWidget.qml, not this.
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  property real now: Date.now()
  property string shown: "f1"

  // Each WEC race page's schedule, by URL, as it's fetched.
  property var wecDetails: ({})
  property string wecDetailUrl: ""
  property int wecDetailHours: 6

  readonly property string labelStyle: Model.labelStyle(String(setting("label", "icon")))
  readonly property string followed: Model.follow(String(setting("follow", "f1")))
  readonly property int refreshMinutes: Math.max(5, parseInt(setting("refreshMinutes", 30), 10) || 30)
  readonly property string timeFormat: Model.timeFormat(String(setting("clock", "locale")), Qt.locale().timeFormat(Locale.ShortFormat))

  readonly property var feeds: [f1Feed, wecFeed, motogpFeed, indycarFeed, nascarFeed]
  readonly property var shownFeeds: feeds.filter(function(f) { return f.active })
  readonly property var feed: {
    var f = feedFor(shown)
    return f && f.active ? f : (shownFeeds.length > 0 ? shownFeeds[0] : f1Feed)
  }
  readonly property var event: feed.event
  readonly property int eventIndex: Math.min(feed.index, feed.schedule.length - 1)
  readonly property bool eventLive: Model.eventLive(event, now)

  readonly property var seriesOptions: shownFeeds.map(function(f) {
    var info = Model.seriesInfo[f.series]
    return { value: f.series, label: info.tab, tooltip: info.name + " (" + info.key + ")" }
  })

  // The bar counts down to the followed series' next session.
  readonly property var pick: Model.barPick(shownFeeds.map(function(f) {
    return { series: f.series, events: f.schedule }
  }), followed, now)
  readonly property var barEvent: pick ? pick.event : null
  readonly property bool barLive: pick !== null && Model.sessionLive(pick.session, now)
  readonly property bool barDimmed: pick === null && shownFeeds.every(function(f) { return f.failed && !f.loaded })
  readonly property string label: Model.barLabel(pick, now, labelStyle)
  readonly property string tooltip: {
    var lines = []
    shownFeeds.forEach(function(f) {
      var p = Model.barPick([{ series: f.series, events: f.schedule }], f.series, now)
      if (!p) return
      var when = Model.sessionLive(p.session, now) ? "Live now"
        : formatDay(p.session.startMs) + (p.session.tbc ? "" : " · " + formatTime(p.session.startMs))
      lines.push(Model.seriesInfo[f.series].tab + ": " + p.event.title + "\n" + p.session.name + " · " + when)
    })
    return lines.length > 0 ? lines.join("\n\n") : "OmaPaddock"
  }

  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color dim: Qt.darker(barForeground, 1.4)
  readonly property color live: bar ? bar.urgent : Color.urgent

  function feedFor(name) {
    for (var i = 0; i < feeds.length; i++) {
      if (feeds[i].series === name) return feeds[i]
    }
    return null
  }

  // Opens on the series the bar follows, or the first one shown.
  function open() {
    feeds.forEach(function(f) { f.index = 0 })
    var home = feedFor(followed)
    shown = home && home.active ? followed : (shownFeeds.length > 0 ? shownFeeds[0].series : "f1")
    now = Date.now()
    cardScroll.contentY = 0
    root.controller.show()
    shownFeeds.forEach(function(f) {
      if (Date.now() - f.fetchedAt > f.pollMinutes * 60 * 1000 / 2) f.refresh()
    })
    ensureWecDetail()
  }

  function openSeries(name) {
    if (!root.opened) open()
    showSeries(name)
  }

  function showSeries(name) {
    var f = feedFor(name)
    if (!f || !f.active || name === shown) return
    shown = name
    cardScroll.contentY = 0
    ensureWecDetail()
  }

  function close() {
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function step(delta) {
    if (feed.schedule.length === 0) return
    feed.index = Math.max(0, Math.min(feed.schedule.length - 1, eventIndex + delta))
    cardScroll.contentY = 0
    ensureWecDetail()
  }

  function scroll(direction) {
    var max = Math.max(0, cardScroll.contentHeight - cardScroll.height)
    cardScroll.contentY = Math.max(0, Math.min(max, cardScroll.contentY + direction * Style.space(48)))
  }

  function openEvent(target) {
    var ev = target || root.event
    if (!ev) return
    Quickshell.execDetached(["omarchy-launch-browser", ev.url])
    root.close()
  }

  function refresh() {
    shownFeeds.forEach(function(f) { f.refresh() })
    if (shown === "wec" && event && event.detailUrl) fetchWecDetail(event.detailUrl, event.raceHours)
  }

  // A WEC race page is fetched for the race on show and for the next one,
  // which the bar and tooltip count down to.
  function ensureWecDetail() {
    if (!wecFeed.active) return
    var wanted = []
    if (root.opened && shown === "wec" && event) wanted.push(event)
    var ahead = Model.firstAhead(wecFeed.schedule, Date.now())
    if (ahead) wanted.push(ahead)
    for (var i = 0; i < wanted.length; i++) {
      var e = wanted[i]
      if (e.detailUrl && Model.detailStale(wecDetails[e.detailUrl], Date.now())) {
        fetchWecDetail(e.detailUrl, e.raceHours)
        return
      }
    }
  }

  function fetchWecDetail(url, hours) {
    if (wecDetailProc.running) return
    wecDetailUrl = url
    wecDetailHours = hours || 6
    wecDetailProc.command = ["curl", "-fsSL", "--compressed", "--max-time", "20", "-A", "OmaPaddock (Omarchy plugin)", url]
    wecDetailProc.running = true
  }

  function storeWecDetail(url, detail) {
    var next = {}
    for (var k in wecDetails) next[k] = wecDetails[k]
    var last = wecDetails[url]
    next[url] = {
      sessions: detail ? detail.sessions : (last ? last.sessions : null),
      place: detail ? detail.place : (last ? last.place : ""),
      cancelled: detail ? detail.cancelled : (last ? last.cancelled : false),
      failed: detail === null,
      fetchedAt: Date.now()
    }
    wecDetails = next
  }

  function formatDay(ms) {
    return isNaN(ms) ? "" : Qt.formatDate(new Date(ms), "ddd d MMM")
  }

  function formatTime(ms) {
    return isNaN(ms) ? "" : Qt.formatTime(new Date(ms), timeFormat)
  }

  // "Fri 30 Oct – Sun 1 Nov", or the day and time of a race-only weekend.
  function dateLine(e) {
    if (!e) return ""
    var first = formatDay(e.startMs)
    var last = formatDay(e.raceMs)
    if (first !== last) return first + " – " + last
    var only = e.sessions && e.sessions.length === 1 ? e.sessions[0] : null
    return only && !only.tbc ? first + " · " + formatTime(only.startMs) : first
  }

  function sessionTime(s) {
    if (Model.sessionLive(s, now)) return "LIVE"
    var quickest = Model.quickest(s)
    if (quickest) return quickest
    return s.tbc ? "TBC" : formatTime(s.startMs)
  }

  function emptyText() {
    if (shownFeeds.length === 0) return "Every series is switched off in the bar settings."
    var info = Model.seriesInfo[feed.series]
    if (!event) {
      if (feed.failed) return info.source + " didn't answer. Press r to try again."
      if (!feed.loaded) return ""
      // The feed moves on to next season once this one is over.
      if (feed.year > new Date().getFullYear()) return "The " + info.tab + " season is over, and " + info.source + " hasn't listed " + feed.year + "'s races yet."
      return "No " + info.tab + " races are scheduled right now."
    }
    if (event.cancelled) return "This race has been cancelled."
    if (event.sessions === null) {
      var entry = wecDetails[event.detailUrl]
      if (!event.detailUrl) return "fiawec.com hasn't published this race's page yet."
      return entry && entry.failed ? "The schedule didn't load. Press r to try again." : "Loading the schedule…"
    }
    return event.sessions.length === 0 ? "Session times haven't been published yet." : ""
  }

  // A series on ESPN's or MotoGP's season scoreboard, or the WEC's calendar.
  // It keeps its last good schedule, so a failed refresh never blanks the
  // tab, and rolls on to next season's once this one is over.
  component Feed: QtObject {
    id: source
    required property string series
    property bool active: true
    property var events: []
    property bool loaded: false
    property bool failed: false
    property real fetchedAt: 0
    property int index: 0
    property int retries: 0
    property int year: new Date().getFullYear()
    property var details: ({})

    readonly property var schedule: Model.upcoming(Model.withDetails(events, details), root.now)
    readonly property var event: schedule.length > 0 ? schedule[Math.max(0, Math.min(index, schedule.length - 1))] : null
    readonly property bool live: schedule.some(function(e) { return Model.eventLive(e, root.now) })
    readonly property int pollMinutes: Model.pollMinutes(series, live, root.refreshMinutes)
    readonly property bool running: proc.running

    function refresh() {
      retries = 0
      year = new Date().getFullYear()
      fetch()
    }

    function fetch() {
      if (!active || proc.running) return
      proc.command = ["curl", "-fsSL", "--compressed", "--max-time", "20", "-A", "OmaPaddock (Omarchy plugin)", Model.feedUrl(series, year)]
      proc.running = true
    }

    // The sources occasionally drop a request; a few quick retries beat
    // waiting out the refresh interval with no schedule.
    function scheduleRetry() {
      if (retries >= 3) return
      retries++
      retryTimer.restart()
    }

    property Process proc: Process {
      stdout: StdioCollector {
        waitForEnd: true
        onStreamFinished: {
          var parsed = Model.parseFeed(source.series, String(text || ""))
          if (parsed === null) {
            source.failed = true
            source.scheduleRetry()
            return
          }
          if (Model.usesSeasons(source.series) && source.year === new Date().getFullYear() && Model.seasonOver(parsed, Date.now())) {
            source.year++
            source.seasonTimer.restart()
          }
          source.events = parsed
          source.loaded = true
          source.failed = false
          source.retries = 0
          source.fetchedAt = Date.now()
          root.now = Date.now()
          if (source.series === "wec") Qt.callLater(root.ensureWecDetail)
        }
      }
    }

    property Timer retryTimer: Timer {
      interval: 5000
      onTriggered: source.fetch()
    }

    // Once this process has exited, fetch next season's.
    property Timer seasonTimer: Timer {
      interval: 1000
      onTriggered: source.fetch()
    }

    property Timer pollTimer: Timer {
      interval: source.pollMinutes * 60 * 1000
      running: source.active
      repeat: true
      triggeredOnStart: true
      onTriggered: source.refresh()
    }
  }

  Feed {
    id: f1Feed
    series: "f1"
    active: Model.switchedOn(root.setting("f1", true))
  }

  Feed {
    id: wecFeed
    series: "wec"
    active: Model.switchedOn(root.setting("wec", true))
    details: root.wecDetails
  }

  Feed {
    id: motogpFeed
    series: "motogp"
    active: Model.switchedOn(root.setting("motogp", true))
  }

  Feed {
    id: indycarFeed
    series: "indycar"
    active: Model.switchedOn(root.setting("indycar", true))
  }

  Feed {
    id: nascarFeed
    series: "nascar"
    active: Model.switchedOn(root.setting("nascar", true))
  }

  Process {
    id: wecDetailProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.storeWecDetail(root.wecDetailUrl, Model.parseWecRace(String(text || ""), root.wecDetailHours))
        // Stepping on while this one loaded may have left another to fetch.
        Qt.callLater(root.ensureWecDetail)
      }
    }
  }

  // While the WEC tab is up, keep its race page fresh.
  Timer {
    interval: 60 * 1000
    running: root.opened && root.shown === "wec"
    repeat: true
    onTriggered: root.ensureWecDetail()
  }

  Timer {
    interval: 30 * 1000
    running: true
    repeat: true
    onTriggered: root.now = Date.now()
  }

  component InfoLine: Text {
    textFormat: Text.PlainText
    width: parent ? parent.width : 0
    horizontalAlignment: Text.AlignHCenter
    elide: Text.ElideRight
    color: root.dim
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
    visible: text !== ""
  }

  // A session: its name and time, or LIVE, or whoever was quickest; races
  // add their podium underneath.
  component SessionRow: Column {
    id: row
    required property var modelData
    readonly property bool isLive: Model.sessionLive(modelData, root.now)
    readonly property bool isDone: Model.sessionDone(modelData, root.now)
    readonly property string podium: Model.podium(modelData)

    width: parent ? parent.width : 0
    topPadding: Style.space(4)
    bottomPadding: Style.space(4)
    spacing: Style.space(2)

    Item {
      width: parent.width
      height: Math.max(sessionName.implicitHeight, sessionTime.implicitHeight)

      Text {
        id: sessionName
        textFormat: Text.PlainText
        anchors.left: parent.left
        anchors.right: sessionTime.left
        anchors.rightMargin: Style.space(8)
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        text: row.modelData.name
        color: row.isLive ? root.live : root.barForeground
        opacity: row.isDone && !row.isLive ? 0.6 : 1
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.bold: row.isLive || row.modelData.kind === "race"
      }

      Text {
        id: sessionTime
        textFormat: Text.PlainText
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: root.sessionTime(row.modelData)
        color: row.isLive ? root.live : (Model.quickest(row.modelData) ? Color.accent : root.dim)
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.bold: row.isLive
      }
    }

    Text {
      textFormat: Text.PlainText
      width: parent.width
      visible: row.podium !== ""
      elide: Text.ElideRight
      text: row.podium
      color: Color.accent
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: false
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(420))
    contentHeight: panel.fittedContentHeight(header.implicitHeight + cardColumn.implicitHeight + footer.implicitHeight + Style.space(24), Style.space(680))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) {
        if (dx !== 0) root.step(dx)
        else root.scroll(dy)
      }
      onActivateRequested: root.openEvent()
      onTextKey: function(t) {
        if (t === "r") return root.refresh()
        for (var i = 0; i < Model.series.length; i++) {
          if (Model.seriesInfo[Model.series[i]].key === t) return root.showSeries(Model.series[i])
        }
      }

      Column {
        id: header
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.space(10)

        ButtonGroup {
          anchors.horizontalCenter: parent.horizontalCenter
          visible: root.seriesOptions.length > 1
          focusable: false
          options: root.seriesOptions
          value: root.feed.series
          foreground: root.barForeground
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          onChanged: function(v) { root.showSeries(v) }
        }

        Item {
          width: parent.width
          height: Math.max(previousButton.height, titleColumn.implicitHeight)

          PanelActionButton {
            id: previousButton
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            iconText: Model.glyphs.previous
            tooltipText: "Previous race (h)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            enabled: root.eventIndex > 0
            onClicked: root.step(-1)
          }

          Column {
            id: titleColumn
            anchors.left: previousButton.right
            anchors.right: nextButton.left
            anchors.leftMargin: Style.space(8)
            anchors.rightMargin: Style.space(8)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              textFormat: Text.PlainText
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              elide: Text.ElideRight
              text: (root.event ? Model.caption(root.event) : Model.seriesInfo[root.feed.series].name).toUpperCase()
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.letterSpacing: 1
              font.bold: true
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              elide: Text.ElideRight
              text: root.event
                ? (root.event.big ? Model.glyphs.star + " " : "") + root.event.title
                : (root.feed.failed ? "Couldn't reach " + Model.seriesInfo[root.feed.series].source
                  : (root.feed.loaded ? (root.feed.year > new Date().getFullYear() ? "Off season" : "No races scheduled") : "Loading schedule…"))
              color: root.event && root.event.big ? Color.accent : root.barForeground
              font.family: root.fontFamily
              font.pixelSize: Style.font.heading
              font.bold: true
            }
          }

          PanelActionButton {
            id: nextButton
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            iconText: Model.glyphs.next
            tooltipText: "Next race (l)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            enabled: root.eventIndex < root.feed.schedule.length - 1
            onClicked: root.step(1)
          }
        }

        Column {
          width: parent.width
          spacing: Style.space(3)
          visible: root.event !== null

          InfoLine {
            text: root.event ? Model.glyphs.date + "  " + root.dateLine(root.event) : ""
            color: root.barForeground
          }

          InfoLine {
            text: root.event && Model.venueLine(root.event) !== "" ? Model.glyphs.venue + "  " + Model.venueLine(root.event) : ""
          }

          InfoLine {
            text: root.event && root.event.broadcasts.length > 0 ? Model.glyphs.broadcast + "  " + root.event.broadcasts.join(", ") : ""
          }
        }

        BorderSurface {
          anchors.horizontalCenter: parent.horizontalCenter
          visible: root.event !== null
          implicitWidth: statusLabel.implicitWidth + Style.space(16)
          implicitHeight: statusLabel.implicitHeight + Style.space(6)
          radius: Style.cornerRadius
          color: root.eventLive ? Util.alpha(root.live, 0.18) : "transparent"
          borderSpec: Border.controlSpec("normal", root.eventLive ? root.live : root.barForeground, Color.accent)

          Text {
            id: statusLabel
            textFormat: Text.PlainText
            anchors.centerIn: parent
            text: Model.statusText(root.event, root.now).toUpperCase()
            color: root.eventLive ? root.live : root.barForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            font.letterSpacing: 1
            font.bold: true
          }
        }

        PanelSeparator {
          foreground: root.barForeground
        }
      }

      Flickable {
        id: cardScroll
        anchors.top: header.bottom
        anchors.bottom: footer.top
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.topMargin: Style.space(4)
        anchors.bottomMargin: Style.space(8)
        contentWidth: width
        contentHeight: cardColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: cardColumn
          width: cardScroll.width
          spacing: Style.space(6)

          Text {
            textFormat: Text.PlainText
            width: parent.width
            topPadding: Style.space(12)
            bottomPadding: Style.space(12)
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            visible: text !== ""
            text: root.emptyText()
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }

          Repeater {
            model: root.event && !root.event.cancelled ? Model.sessionDays(root.event) : []

            Column {
              id: dayColumn
              required property var modelData
              width: cardColumn.width
              spacing: 0

              PanelSectionHeader {
                width: parent.width
                text: Qt.formatDate(dayColumn.modelData.date, "dddd d MMMM").toUpperCase()
                foreground: root.barForeground
                fontFamily: root.fontFamily
                bottomPadding: Style.space(2)
              }

              Repeater {
                model: dayColumn.modelData.sessions

                SessionRow {}
              }
            }
          }
        }
      }

      Item {
        id: footer
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        implicitHeight: Math.max(footerText.implicitHeight, footerActions.implicitHeight)
        height: implicitHeight

        Text {
          id: footerText
          textFormat: Text.PlainText
          anchors.left: parent.left
          anchors.right: footerActions.left
          anchors.rightMargin: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          elide: Text.ElideRight
          text: (root.feed.failed && root.feed.fetchedAt > 0 ? "Offline · " : "")
            + Model.seriesInfo[root.feed.series].source
            + (root.feed.fetchedAt > 0 ? " · updated " + root.formatTime(root.feed.fetchedAt) : "")
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        Row {
          id: footerActions
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(4)

          PanelActionButton {
            iconText: Model.glyphs.refresh
            tooltipText: "Refresh (r)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            enabled: !root.feeds.some(function(f) { return f.running }) && !wecDetailProc.running
            onClicked: root.refresh()
          }

          PanelActionButton {
            iconText: Model.glyphs.open
            tooltipText: "Open on " + Model.seriesInfo[root.feed.series].source + " (Enter)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            enabled: root.event !== null
            onClicked: root.openEvent()
          }
        }
      }
    }
  }
}
