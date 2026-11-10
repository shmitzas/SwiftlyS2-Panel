# SwiftlyS2 Panel

A modular web panel for CS2 communities running [SwiftlyS2](https://swiftlys2.net). It installs on
any web host that accepts plain file uploads (SFTP only: no shell, no Composer, no Node) and works
on the same database tables the plugins use. Each module adds its own pages and menu entries when
it is enabled.

> **Status: design and proof of concept.** No PHP has been written yet. This repository holds the
> architecture document and clickable HTML mockups.

## Contents

| Path | What it is |
|---|---|
| [`docs/POC.md`](docs/POC.md) | Toolset, architecture, file and database structure, module system, each plugin's table contract, roles and permissions, theming, security, install and update, roadmap, open questions |
| [`design/mockups/`](design/mockups/index.html) | Static mockups: landing, servers, punishments, leaderboard, player profile, skin changer, shop, admin dashboard, roles, theme editor, admins and groups, shop administration, design system |

## Planned modules

| Module | Plugin tables it uses | Pages |
|---|---|---|
| Servers | Admins (`servers`, `player_sessions`), plus A2S queries | Server browser |
| Admins | Admins | Public bans and comms; staff actions, admins and groups |
| Ranks | Ranks, WeaponStats, EloPoints, Prestige, CustomCombos | Leaderboards, rank ladder, player statistics |
| WeaponSkins | WeaponSkins | Skin changer that honours the plugin's item permissions |
| VIPCore | VIPCore | VIP badges and tiers; staff grants |
| Economy | Economy | Balance leaderboards |
| Shop | ShopCore and its modules: item state in Cookies' `PlayerCookies`, credits in Economy, `shopcore_ledger` | Shop with credits, inventory and history; buying and selling while off the servers; staff ledger, credits and catalog |

## Viewing the mockups

Serve the folder and open `index.html`:

```powershell
cd design/mockups
php -S localhost:8000      # or: python -m http.server 8000
```

The bar at the bottom of each page switches the viewer (guest, a VIP player, a player without VIP,
staff) and the colour preset. The VIP player is on a server and the other player is not, so the
shop shows both its locked and its open state. As staff, the admin dashboard's module switches
show and hide each module's pages and menu entries.

The sample data follows the plugins' real table shapes, units and encodings. Names, IP addresses
(TEST-NET ranges) and figures are made up.

## Bundled assets

| Asset | Licence |
|---|---|
| Bootstrap 5.3.8, Bootstrap Icons 1.13.2 | MIT |
| Barlow Semi Condensed, Noto Sans, Noto Sans Mono | SIL Open Font License 1.1 |
| Item catalog subset in `sample-data.js` | [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), MIT; images load from Steam's CDN |

The panel itself is licensed under the [AGPL-3.0](LICENSE).
