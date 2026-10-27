import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// The next session of the followed series in the bar (F1 unless set
// otherwise). Left click opens the race weekend, middle click refreshes,
// right click opens the race's page.
BarWidget {
  id: root
  moduleName: "leewynne.omapaddock"

  readonly property var paddock: panelLoader.item
  readonly property string label: paddock ? paddock.label : ""
  readonly property bool live: paddock ? paddock.barLive : false
  // The icon style has no label, so this also covers it.
  readonly property bool showLabel: !vertical && label !== ""

  // Shape contract for shell.summon/hide/toggle routing: Bar.findPanelWidget
  // requires open/close/opened on the bar-widget root.
  readonly property bool opened: paddock ? paddock.opened === true : false

  function open() {
    if (paddock) paddock.open()
  }

  function close() {
    if (paddock) paddock.close()
  }

  function togglePanel() {
    if (paddock) paddock.toggle()
  }

  function refresh() {
    if (paddock) paddock.refresh()
  }

  function step(delta) {
    if (!paddock) return
    if (!paddock.opened) paddock.open()
    paddock.step(delta)
  }

  function openSeries(name) {
    if (paddock) paddock.openSeries(name)
  }

  // Forwarded so this widget can stand in for the panel as the bar's popout
  // identity: Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: paddock ? paddock.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (paddock) paddock.closeForPopoutSwitch()
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  // The open-panel mark spans the label, like the clock's; the flag alone
  // leaves the bar to size it.
  readonly property real openPanelIndicatorWidth: showLabel ? pill.width : 0

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "leewynne.omapaddock"

    function refresh(): void { root.broadcast("refresh") }
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function next(): void { root.step(1) }
    function previous(): void { root.step(-1) }
    function f1(): void { root.openSeries("f1") }
    function wec(): void { root.openSeries("wec") }
    function motogp(): void { root.openSeries("motogp") }
    function indycar(): void { root.openSeries("indycar") }
    function nascar(): void { root.openSeries("nascar") }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: ""
    labelVisible: false
    hasVisualContent: true
    fixedWidth: root.vertical ? -1 : (root.showLabel ? pill.width + Style.space(7) : Math.max(Style.bar.iconSlot, pill.width))
    fixedHeight: root.vertical ? Style.bar.iconSlot : -1
    active: root.live
    dimmed: root.paddock ? root.paddock.barDimmed : false
    tooltipText: root.paddock ? root.paddock.tooltip : ""

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else if (b === Qt.RightButton) { if (root.paddock) root.paddock.openEvent(root.paddock.barEvent) }
      else root.togglePanel()
    }

    // The flag, with the race and session beside it unless the icon style is
    // set. A live session turns the label urgent, or fills behind a lone
    // flag.
    Rectangle {
      id: pill
      readonly property bool filled: root.live && !root.showLabel
      readonly property color ink: filled
        ? (root.bar ? root.bar.background : Color.background)
        : (root.live ? button.activeColor : button.foreground)

      anchors.centerIn: parent
      width: pillRow.implicitWidth + (root.vertical ? 0 : Style.space(root.showLabel ? 10 : 6))
      height: pillRow.implicitHeight + Style.space(4)
      radius: Math.min(Style.cornerRadius, height / 2)
      color: filled ? button.activeColor : "transparent"

      Row {
        id: pillRow
        anchors.centerIn: parent
        spacing: Style.space(4)

        Text {
          textFormat: Text.PlainText
          anchors.verticalCenter: parent.verticalCenter
          text: Model.glyphs.flag
          color: pill.ink
          font.family: button.fontFamily
          font.pixelSize: Style.bar.iconFont
          renderType: Text.NativeRendering
        }

        Text {
          textFormat: Text.PlainText
          anchors.verticalCenter: parent.verticalCenter
          visible: root.showLabel
          text: root.label
          color: pill.ink
          font.family: button.fontFamily
          font.pixelSize: Style.font.body
          renderType: Text.NativeRendering
        }
      }
    }
  }
}
