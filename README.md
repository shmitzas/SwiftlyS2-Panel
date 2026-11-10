# SwiftlyS2 Panel

Modular, feature-rich web panel for any CS2 project running the [SwiftlyS2](https://swiftlys2.net)
framework, simple to install and set up. I'm making the official SW2 panel website, which can be
hosted on regular web hosting services. It works on the same database tables the plugins use, and
each module adds its own pages and menu entries when it is enabled.

**No need to compile website files, run `nodejs`, `php artisan` or some other bs.**
Simply drop all of the files from the latest release archive onto your host and refresh the page. EZ :sunglasses:

## Live Demo Website (just design mockups): https://sw2panel.shmitz.xyz

> [!WARNING]
> It is still in its infant :baby: stage. Do not expect a fully working website until at least **January 2027** :bangbang:

> [!NOTE]
> This repo and the designs were created only a few hours ago, and I will add more details shortly.<br>
> No PHP has been written yet: for now the repository holds the architecture document and clickable HTML mockups.

> [!TIP]
> :raised_hands: Any plugin support requests or customizability requests are welcome!

## Supported plugins

Supported by this panel out of the box from day one:

- [Admins](https://github.com/SwiftlyS2-Plugins/Admins)
- [Economy](https://github.com/SwiftlyS2-Plugins/Economy) (tied to ShopCore)
- [ShopCore](https://github.com/SwiftlyS2-Plugins/ShopCore)
- [VIPCore](https://github.com/SwiftlyS2-Plugins/VIPCore)
- [Ranks](https://github.com/SwiftlyS2-Plugins/Ranks)
- [Cookies](https://github.com/SwiftlyS2-Plugins/Cookies) (for user settings)
- [WeaponSkins](https://github.com/samyycX/WeaponSkins) (WS)

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

## Contents

| Path | What it is |
|---|---|
| [`docs/POC.md`](docs/POC.md) | Toolset, architecture, file and database structure, module system, each plugin's table contract, roles and permissions, theming and layout, security, install and update, roadmap, open questions |
| [`design/mockups/`](design/mockups/index.html) | Static mockups: landing, servers, punishments, leaderboard, player profile, skin changer, shop, admin dashboard, roles, theme editor, layout editor, admins and groups, shop administration, design system |

## Viewing the mockups

Serve the folder and open `index.html`:

```powershell
cd design/mockups
php -S localhost:8000      # or: python -m http.server 8000
```

The bar at the bottom of each page switches the viewer (guest, a VIP player, a player without VIP,
staff), the colour preset, the menu (top bar, or a side bar on the left or right) and the content
width (centred or full width). The VIP player is on a server and the other player is not, so the
shop shows both its locked and its open state. As staff, the admin dashboard's module switches show
and hide each module's pages and menu entries, and **Admin → Layout** sets the menu position and
content width for everyone and reorders the menu, the landing page's panels and the player page's tabs.

The sample data follows the plugins' real table shapes, units and encodings. Names, IP addresses
(TEST-NET ranges) and figures are made up.

## Bundled assets

| Asset | Licence |
|---|---|
| Bootstrap 5.3.8, Bootstrap Icons 1.13.2 | MIT |
| Barlow Semi Condensed, Noto Sans, Noto Sans Mono | SIL Open Font License 1.1 |
| Item catalog subset in `sample-data.js` | [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), MIT; images load from Steam's CDN |

The panel itself is licensed under the [AGPL-3.0](LICENSE).
