# OmaPaddock

The big races in your Omarchy bar: a countdown to the next F1 session, and a
popup with every race weekend's schedule in your time zone. Switch to the
World Endurance Championship and Le Mans, MotoGP, IndyCar or NASCAR, and step
through every round with the arrows.

- **Bar pill** with the race and the next session
  (`Mexico City GP · FP1 3d`), turning to `LIVE` in the urgent colour while a
  session is on. It follows F1 unless you pick another series, or `any` for
  whichever is next. Short on bar space? Switch to the **icon** style: just
  the chequered flag, which fills with your theme's urgent colour during a
  session.
- **Race weekend popup** with the circuit, broadcaster, round number and
  every session grouped by day, in your time zone.
- **F1**: practice, sprint qualifying, sprint, qualifying and race, with
  whoever was quickest in each session and the podium of every race.
- **WEC**: every round, with each class's qualifying and Hyperpole, and the
  24 Hours of Le Mans.
- **MotoGP**: practice, qualifying, the sprint, warm up and the Grand Prix.
- **IndyCar** and **NASCAR Cup Series**: every race, with its broadcaster and
  podium, the Indianapolis 500 and Daytona 500 included.
- **The crown jewels** (Monaco, Le Mans, the Indianapolis 500 and the
  Daytona 500) are starred.

## Install

```bash
omarchy plugin add https://github.com/leewynne/omapaddock.git --enable
```

The widget lands in the right section of the bar. Move it with
`omarchy bar move leewynne.omapaddock --section center` or by dragging it.

Requires an Omarchy release with the plugin shell (`omarchy plugin`) and
`curl`, which Omarchy ships.

## Use

| Action | Does |
|---|---|
| Left click | Open the race weekend |
| Middle click | Refresh |
| Right click | Open the bar's race page |

Inside the popup: `f`, `w`, `m`, `i` and `n` switch between F1, WEC, MotoGP,
IndyCar and NASCAR, `←` `→` or `h` `l` change race, `↑` `↓` or `j` `k`
scroll, `Enter` opens the race's page, `r` refreshes, `Esc` closes, and `Tab`
moves to the neighbouring bar panel.

It can also be driven over IPC, for a keybinding for instance:

```bash
omarchy-shell shell toggle leewynne.omapaddock '{}'
omarchy-shell leewynne.omapaddock f1
omarchy-shell leewynne.omapaddock wec
omarchy-shell leewynne.omapaddock motogp
omarchy-shell leewynne.omapaddock indycar
omarchy-shell leewynne.omapaddock nascar
omarchy-shell leewynne.omapaddock next
omarchy-shell leewynne.omapaddock previous
omarchy-shell leewynne.omapaddock refresh
```

## Settings

Change these from the bar settings, or with `omarchy bar set`:

```bash
omarchy bar set leewynne.omapaddock label icon
omarchy bar set leewynne.omapaddock follow any
omarchy bar set leewynne.omapaddock nascar false --json
omarchy bar set leewynne.omapaddock clock 24h
omarchy bar set leewynne.omapaddock refreshMinutes 60 --json
```

| Key | Values | Default |
|---|---|---|
| `label` | `race` (`Mexico City GP · FP1 3d`) or `icon` (the flag alone) | `race` |
| `follow` | the series the bar counts down to: `f1`, `wec`, `motogp`, `indycar`, `nascar`, or `any` for whichever is next | `f1` |
| `f1`, `wec`, `motogp`, `indycar`, `nascar` | `true`, or `false` to hide that series' tab | `true` |
| `clock` | `locale`, `24h`, `12h` | `locale` |
| `refreshMinutes` | 5–240 | `30` |

## Data

F1, IndyCar and NASCAR schedules and results come from ESPN's public racing
scoreboards (`site.api.espn.com`). The WEC's calendar and each race's
session times come from [fiawec.com](https://www.fiawec.com/en/): its home
page lists the races, and a race's own page is fetched when that race is
shown, or is next. MotoGP's come from the API behind
[motogp.com](https://www.motogp.com/en/calendar).

ESPN's schedules refresh every `refreshMinutes`, or every two minutes while a
session is on; the WEC's and MotoGP's every six hours, since they only change
between weekends. Once a series' season is over, it looks for next season's
races instead. The plugin sends nothing else, and no account or API key is
needed.

The WEC's and MotoGP's results are on their sites but not in what this
plugin reads, so their sessions show times only. When the WEC lists several
sessions at the same time, those are placeholders it hasn't confirmed yet,
and they show as TBC.

These sources are undocumented and could change; if a tab stops loading,
please open an issue.

Formula 1, F1 and Grand Prix are trademarks of Formula One Licensing B.V.;
FIA WEC, 24 Hours of Le Mans, MotoGP, IndyCar, Indianapolis 500, NASCAR and
Daytona 500 are trademarks of their owners. This plugin is a fan project and
is not affiliated with, endorsed or sponsored by any of them, the FIA, the
ACO, Dorna, ESPN or any team.

## Remove

```bash
omarchy plugin remove leewynne.omapaddock
```

This removes the plugin folder and its bar entry. It stores nothing else.

## Develop

```bash
./tests/run
```

The model (`Model.js`) is plain JavaScript shared by the QML and the node
tests. `tests/fixtures/f1.json`, `nascar.json`, `indycar.json` and
`motogp.json` are trimmed real responses; the `wec-*.html` fixtures are made
up in the shape of fiawec.com's pages.

## License

MIT
