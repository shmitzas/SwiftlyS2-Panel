# SwiftlyS2 Panel — Proof of Concept

A modular web panel for CS2 communities running SwiftlyS2, installable on any web host that
accepts plain file uploads. This document fixes the toolset, the architecture, the file and
database structure, and the contracts with each plugin's tables. The design half lives in
[`design/mockups/`](../design/mockups/index.html).

| | |
|---|---|
| Status | Proof of concept: design and architecture. No PHP written yet. |
| Licence | AGPL-3.0 (the repository's). Bundled assets are MIT (Bootstrap, Bootstrap Icons) and OFL (fonts). |
| Plugins covered | Admins, Ranks (+ WeaponStats, EloPoints, Prestige, CustomCombos), WeaponSkins, VIPCore, Economy, ShopCore (+ Cookies and its modules) |
| Mockups | `design/mockups/` — open `index.html`, or run `php -S localhost:8000` in that folder |

## Contents

1. [Verdict](#1-verdict)
2. [Constraints](#2-constraints)
3. [Toolset](#3-toolset)
4. [Architecture](#4-architecture)
5. [File structure](#5-file-structure)
6. [Module system](#6-module-system)
7. [Database](#7-database)
8. [Plugin contracts](#8-plugin-contracts)
9. [Sign-in, roles and permissions](#9-sign-in-roles-and-permissions)
10. [Theming and layout](#10-theming-and-layout)
11. [Design language](#11-design-language)
12. [Pages](#12-pages)
13. [Server status](#13-server-status)
14. [Background work and caching](#14-background-work-and-caching)
15. [Security](#15-security)
16. [Install, update, migrate](#16-install-update-migrate)
17. [Internationalisation](#17-internationalisation)
18. [Quality](#18-quality)
19. [Risks](#19-risks)
20. [Roadmap](#20-roadmap)
21. [Open questions](#21-open-questions)

---

## 1. Verdict

**Doable.** Every plugin in scope keeps its state in ordinary SQL tables with stable, documented
shapes, and several already expect a website to share them: Admins avoids naming a table
`sessions` because "web frameworks that share the database often own a table by that name", and
parses its JSON list cells defensively because "rows edited by hand or by web panels can hold an
empty string or invalid JSON". WeaponSkins says of `SyncFromDatabaseWhenPlayerJoin`: "Turn it on
if several servers or a website use the same database." Cookies, which holds ShopCore's item
state, re-reads its rows every five seconds so that "changes made by other servers, a website or by
hand show up within 5 seconds". The panel is a PHP application that talks to those tables over PDO.

Three facts shape everything else:

| Fact | Consequence |
|------|-------------|
| The panel and the game servers meet **only in the database** | The database must be reachable from the web host (§19). SQLite plugin databases live on the game server's disk and cannot be used. |
| Plugins pick up web changes on their own schedule | Writes are eventually consistent: Admins re-reads every 30–60 s, WeaponSkins on join or `!wp`, VIPCore on reconnect (§8). The UI says so wherever it writes. |
| Some plugins keep an online player's state in memory | Ranks saves absolute values and would overwrite web edits. Economy saves only what changed in game, so web credits survive, but an online player keeps spending the balance they had. ShopCore caches item state until the player leaves. Their modules write only while the player is offline, except adding credits (§8.2, §8.5, §8.6). |

---

## 2. Constraints

What "any web hosting that accepts SFTP uploads" means in practice, and what each implies.

| Typical shared host | Requirement for the panel |
|---|---|
| PHP 8.2–8.5 selectable, Apache/LiteSpeed with `.htaccess`, sometimes nginx | Plain PHP. Works with and without URL rewriting. Ships `.htaccess` and an nginx snippet. |
| No SSH, no Composer, no Node, no Artisan | Nothing runs on the server except PHP serving requests. No build step, no CLI step. Dependencies are committed to the release ZIP. |
| Document root fixed to `public_html/` | The whole panel can live inside the document root; private folders deny direct access themselves. |
| MySQL/MariaDB available, PostgreSQL rare | MySQL/MariaDB first-class. PostgreSQL through a dialect layer, second. SQLite only for the panel's own tables on tiny installs. |
| Cron sometimes available, often not | Background work runs on page requests (pseudo-cron), with an optional cron URL. |
| `max_execution_time` 30 s, 128 MB memory | Every request is short. Long work (item catalog refresh) is chunked across requests. |
| Outbound ports may be filtered; UDP sometimes blocked | Server status degrades from A2S queries to session data (§13). Database reachability is tested by the installer. |
| `allow_url_fopen` may be off | All HTTP goes through cURL, with a stream fallback. |
| Files owned by the hosting user, 644/755 | Only `storage/` and `uploads/` need to be writable. |

---

## 3. Toolset

### 3.1 Options considered

| Option | No-CLI install | Weight | Shared-host fit | Verdict |
|---|---|---|---|---|
| Laravel | Poor: Artisan for migrations, caches, keys; `public/` docroot | ~30 MB vendor | Works only with tricks | No |
| Symfony | Poor: console for cache and migrations | Large | Same | No |
| CodeIgniter 4 / Slim 4 + vendored `vendor/` | Fine if the ZIP ships `vendor/` | 2–8 MB | Good | Possible |
| Flight PHP (vendored) | Fine | Small | Good | Possible |
| Node (Next.js, Nuxt), Python, .NET | Need a long-running process | — | Not available on shared hosting | No |
| Static site + JS calling an API | Still needs a server-side API for the database | — | — | No |
| **Plain PHP with an in-repo micro-core** | Native | ~300 KB of our code | Best | **Chosen** |

### 3.2 Decision

| Layer | Choice | Why |
|---|---|---|
| Language | **PHP 8.3+** (8.4 or 8.5 recommended) | Universally available. 8.1 is end-of-life and 8.2's security support ends 31 Dec 2026, so a project starting now targets 8.3 (supported to Dec 2027). Brings enums, readonly classes, typed class constants, `json_validate()`. |
| Framework | **In-repo micro-core**, no runtime Composer | Router, PDO wrapper with dialects, templates, sessions, CSRF, cache, module loader, migrator, i18n, HTTP client. A few thousand lines we own, with no Artisan-style step and no third-party upgrade treadmill. |
| Database | **PDO** (`pdo_mysql`, optional `pdo_pgsql`, `pdo_sqlite`) | Prepared statements only; a dialect object for quoting and upserts. No ORM: the plugins' tables are not ours to model. |
| Templates | Native PHP templates with layouts, sections and escape-by-default helpers | No compile step and no writable cache required. (League Plates is the same idea and an acceptable vendored alternative.) |
| CSS | **Bootstrap 5.3** (vendored `bootstrap.min.css`) + the panel's design system (`panel.css`) | Bootstrap 5.3 runs on CSS custom properties, so the theme is set at runtime with no Sass. |
| Icons | Bootstrap Icons (vendored font) | Same project, MIT, ~2 000 icons. |
| JS | Vanilla ES2020 + **htmx 2** (vendored, 14 KB gz) | Server-rendered pages; htmx swaps fragments for filters, paging, search-as-you-type and status polling. Rich widgets (skin changer, theme editor) are small vanilla modules. No bundler. |
| Fonts | Barlow Semi Condensed (display), Noto Sans and Noto Sans Mono (body, numbers), self-hosted woff2 with latin-ext | Noto Sans is the text face CS2's menus use (the game ships it in `csgo/panorama/fonts`). Stratum2, its display face, is not redistributable; Barlow Semi Condensed has the same squared, DIN-like character at a similar width. latin-ext covers names like *Šarūnas*. |
| Dev-only | Composer (PHPUnit, PHPStan, PHP-CS-Fixer), Node + Sass (optional slim Bootstrap build), Playwright | Run by maintainers and CI. Their output is committed; the server never needs them. |

> Bootstrap stays stock. A maintainer *may* compile a slimmer Bootstrap from Sass (only the
> components used) and commit the CSS; theming never depends on it, because every colour reaches
> Bootstrap through `--bs-*` variables at runtime (§10.1).

---

## 4. Architecture

```text
Browser ──HTTPS──► Web host (PHP 8.3+)                              Game servers (SwiftlyS2)
                    index.php ─ front controller                      Admins · Ranks · WeaponSkins
                    ├─ Core    router · auth · roles · theme · i18n     VIPCore · Economy · ShopCore …
                    ├─ Modules servers · admins · ranks · weaponskins …     │ named connections
                    └─ storage/  cache · sessions · logs · locks             │ (configs/database.jsonc)
                         │ PDO, TCP 3306                 │ UDP A2S          │
                         ▼                               ▼                  ▼
                    MySQL / MariaDB  ◄───────────────────────────────── same tables
                    ├─ sp_*            the panel's own tables
                    └─ plugin tables   admins, bans, ranks_players, wp_player_skins, vip_users, PlayerCookies …
```

### Request lifecycle

1. `index.php` loads `app/bootstrap.php`: autoloader, error handler, `config/config.php`.
2. **Not installed** → redirect to `install/`. **Pending migrations** → run them under a lock, once.
3. The module manager reads `storage/cache/modules.php` (manifest cache) and registers enabled modules.
4. The router matches the path (`/servers`) — or `index.php?r=/servers` where rewriting is off.
5. Middleware: session → current user → roles (cached per session) → CSRF on unsafe methods → route permission.
6. The controller calls repositories (one per plugin table group) on the module's named connection.
7. The view renders a layout (`public`, `admin`, `bare`) with sections; htmx requests get the fragment only.
8. After the response is flushed, pseudo-cron runs due tasks (§14).

### Core services

| Service | Responsibility |
|---|---|
| `Config` | `config/config.php` plus `sp_settings`; per-module settings with defaults from the manifest |
| `Db\ConnectionManager` | Named PDO connections mirroring SwiftlyS2's `database.jsonc` (URI or object form) |
| `Db\Dialect` | MySQL, MariaDB, PostgreSQL, SQLite: identifier quoting, `LIMIT`, upsert, current time |
| `Db\Migrator` | The panel's own migrations, per module, ledger `sp_migrations` |
| `Db\SchemaProbe` | `SELECT <columns> FROM t WHERE 1 = 0` and ledger checks: is a plugin's table there, with the columns we use, at which version |
| `Http\Router`, `Request`, `Response` | Named routes, parameters, permissions; JSON and fragment responses |
| `Auth\SteamOpenId` | Steam OpenID 2.0 sign-in (§9.1) |
| `Access\Permissions` | Wildcard matching identical to SwiftlyS2's |
| `Access\Roles` | Roles, role links (auto-assignment), panel and game permission resolution |
| `View\Engine` | Layouts, sections, partials, `e()` escaping, `Html` and `Form` helpers |
| `View\Layout` | The saved menu position and content width, and the order of menu entries and arrangeable panels (§10.2) |
| `Theme\Compiler` | Tokens → `theme-<hash>.css` (§10.1) |
| `Support\Cache` | File cache (atomic rename), APCu when present |
| `Support\Http` | cURL client with timeouts; used for Steam and the item catalog |
| `Support\Time`, `Duration` | Unit-explicit conversions and the plugins' own formatters (§8) |
| `Support\SteamId` | SteamID64 ⇄ `STEAM_0:X:Y` ⇄ `[U:1:Z]`, 64-bit safe |
| `Query\A2S` | A2S_INFO / A2S_PLAYER over UDP with the challenge handshake |
| `I18n\Translator` | JSON catalogues per module, fallback chain |
| `Cron\Scheduler` | Pseudo-cron and the cron URL |
| `Audit` | Writes `sp_audit_log` for every write the panel makes anywhere |

---

## 5. File structure

```text
swiftlys2-panel/                      ← upload the contents into public_html/ (or a sub-folder)
├── index.php                         front controller; every route
├── cron.php                          optional, for hosts with real cron
├── .htaccess                         rewrite to index.php, deny private folders, security and cache headers
├── web.config                        IIS equivalent
├── nginx.conf.example                for hosts without .htaccess
├── robots.txt
├── install/                          web installer; locks itself, asks to be deleted
│   └── index.php
├── app/                              core (denied over HTTP)
│   ├── .htaccess                     Require all denied
│   ├── bootstrap.php                 autoloader, error handling, environment checks
│   ├── version.php                   panel version and schema version
│   ├── Core/
│   │   ├── App.php  Container.php  Config.php
│   │   ├── Http/        Request.php Response.php Router.php Middleware/
│   │   ├── Db/          ConnectionManager.php Connection.php Dialect/ Migrator.php SchemaProbe.php
│   │   ├── Auth/        SteamOpenId.php Session.php CurrentUser.php
│   │   ├── Access/      Permissions.php Roles.php RoleLinks.php GamePermissions.php
│   │   ├── Module/      ModuleInterface.php ModuleManager.php Manifest.php Hooks.php Nav.php
│   │   ├── View/        Engine.php Html.php Form.php Pager.php Layout.php
│   │   ├── Theme/       Tokens.php Compiler.php Presets.php
│   │   ├── Support/     Cache.php Http.php Time.php Duration.php SteamId.php Csrf.php RateLimit.php Jsonc.php Ip.php
│   │   ├── Query/       A2S.php
│   │   ├── I18n/        Translator.php
│   │   └── Cron/        Scheduler.php
│   ├── Controllers/     Home Auth Search Profile Account Admin/{Dashboard,Modules,Roles,Users,Theme,Layout,Settings,Audit}
│   ├── views/           layouts/ partials/ pages/ admin/
│   ├── migrations/      0001_core.php 0002_…
│   └── lang/            en.json lt.json …
├── modules/                          one folder per module; third-party modules go here too
│   ├── servers/   admins/   ranks/   weaponskins/   vipcore/   economy/   shop/
│   └── <id>/
│       ├── module.json               manifest (§6.1)
│       ├── Module.php                entry class
│       ├── src/                      Controllers/ Repositories/ Services/
│       ├── views/
│       ├── lang/
│       ├── migrations/               panel-owned sp_* tables only, never the plugin's
│       └── public/                   the only module folder served over HTTP (css, js, img)
├── assets/                           public static files
│   ├── vendor/      bootstrap/ bootstrap-icons/ htmx/
│   ├── fonts/       barlow-semi-condensed/ noto-sans/ noto-sans-mono/ (+ OFL.txt)
│   ├── css/         fonts.css panel.css admin.css
│   ├── js/          panel.js skins.js theme-editor.js
│   └── img/         logo.svg favicon.svg map placeholders
├── config/                           written by the installer (denied)
│   ├── .htaccess
│   └── config.php
├── storage/                          writable (denied)
│   ├── .htaccess
│   ├── cache/       modules.php theme/ a2s/ steam/ catalog/ fragments/
│   ├── logs/        panel-YYYY-MM-DD.log
│   ├── sessions/
│   └── locks/
└── uploads/                          writable, public; PHP execution disabled
    ├── logo/  backgrounds/  maps/
    └── .htaccess                     php_flag engine off · RemoveHandler .php
```

Every PHP file outside `index.php`, `install/` and `cron.php` starts with
`defined('SP_ROOT') || exit;`, so a host that ignores `.htaccess` still serves nothing from them.
When the host allows it, the installer offers to put `config.php` one level above the document root.

---

## 6. Module system

A module adds pages, nav entries, profile sections, admin pages, permissions and settings. Core
works with zero modules; the ones in scope ship in the release, others are uploaded by SFTP into
`modules/` and enabled from **Admin → Modules**. Disabling a module removes its routes and nav
entries but never touches data.

### 6.1 Manifest — `module.json`

Readable without executing PHP, so the module manager can list a module before it is trusted.

```json
{
  "id": "ranks",
  "name": "Ranks",
  "version": "0.1.0",
  "description": "Leaderboards, player statistics and rank ladders from the Ranks plugin.",
  "requires": { "panel": ">=0.1", "php": ">=8.3", "modules": [] },
  "plugin": {
    "name": "Ranks",
    "ledger": "{affix:ranks_migrations}",
    "minVersion": 202611072300,
    "tables": ["{affix:ranks_players}", "{affix:ranks_players_history}"]
  },
  "connections": { "ranks": { "default": "default", "label": "Ranks database" } },
  "permissions": {
    "ranks.settings": "Ladder, seasons and table affixes",
    "ranks.reset": "Reset a player's figures (offline only)"
  },
  "settings": {
    "tablePrefix": { "type": "string", "default": "", "pattern": "^[A-Za-z0-9_]*$" },
    "tableSuffix": { "type": "string", "default": "", "pattern": "^[A-Za-z0-9_]*$" },
    "ladder":      { "type": "json",   "default": "premier" },
    "startPoints": { "type": "int",    "default": 0 }
  },
  "nav": [
    { "area": "public", "label": "nav.leaderboard", "route": "ranks.leaderboard", "icon": "trophy-fill", "weight": 30 }
  ],
  "entry": "Modules\\Ranks\\Module"
}
```

### 6.2 Entry class

```php
interface ModuleInterface
{
    public function register(Container $c): void;   // repositories and services
    public function routes(Router $r): void;        // pages, fragments, JSON endpoints
    public function hooks(Hooks $h): void;          // see 6.3
    public function health(Health $h): void;        // connection, tables, ledger version
}
```

### 6.3 Hooks

| Hook | Called for | Example |
|---|---|---|
| `nav.public`, `nav.admin` | Building menus, after permission filtering | Leaderboard, Admins & groups |
| `landing.widgets` | Landing page panels, each with an id, a default position and a width | Live servers, season podium, recent punishments |
| `profile.header` | Badges on a player's header | VIP GOLD · 23d left, Staff, Banned |
| `profile.tabs` | Tabs on a player's page, each with its own permission | Overview, Weapons, Loadout, Inventory, Punishments, Sessions |
| `profile.overview` | Panels on a player's Overview tab, like `landing.widgets` | Rank summary, statistics, seasons, combos |
| `player.search` | The search box; each module returns matches | Names from `ranks_players`, `player_sessions` |
| `player.name` | Resolving a SteamID to a display name, by priority | Steam cache → latest session → Ranks name |
| `player.online` | Whether a SteamID is on a server now | Admins' open `player_sessions` (§8.1); Ranks, Economy and Shop ask it before every write |
| `role.sources` | Auto-assignment sources for role links | `admins.group`, `vipcore.group` |
| `game.permissions` | In-game permission strings held by a SteamID | Admins rows and groups |
| `admin.dashboard` | Dashboard widgets | Active bans, VIP expiring this week |
| `cron` | Scheduled tasks with an interval | Refresh A2S, refresh Steam names, catalog |

`nav.public`, `landing.widgets`, `profile.tabs` and `profile.overview` are arrangeable: the saved
layout (§10.2) orders their contributions by id, and any it does not name yet (a module enabled
later) follow, in their default order.

### 6.4 Health

Shown on the dashboard and before a module can be enabled:

1. The named connection opens.
2. Each required table answers `SELECT <columns> FROM t WHERE 1 = 0` — the probe Ranks itself uses.
   It names the columns, so a column a DML-only host never got is caught too, and it needs no DDL
   rights, which shared hosting often withholds.
3. The plugin's migration ledger holds at least `minVersion`: `VersionInfo` (Admins, Economy and
   Cookies share FluentMigrator's default), `ranks_migrations` with its affixes,
   `__weaponskins_version_info`, `__vipcore_version_info`. ShopCore has no migrations: its
   `shopcore_ledger` is created by FreeSql, so the probe alone checks it.
4. Optional columns are detected rather than assumed (for example Ranks' `playtime`).

### 6.5 Modules in scope

| Module | Pages it adds | Reads | Writes |
|---|---|---|---|
| `servers` | Server browser, server detail | `servers`, `player_sessions` (Admins), A2S | `sp_server_meta` only |
| `admins` | Bans, comms, record view; staff: give / lift / change length, admins & groups, IP-ban exclusions, sessions | `bans`, `sanctions`, `admins`, `groups`, `servers`, `player_sessions`, `ip_ban_exclusions` | `bans`, `sanctions`, `admins`, `groups`, `ip_ban_exclusions` |
| `ranks` | Leaderboard (season, all time, past seasons), rank ladder, profile stats, weapons, Elo, prestige, combos | `ranks_*` with affixes | none (offline reset optional) |
| `weaponskins` | Skin changer, profile loadout, item permissions, catalog | `wp_player_*` | `wp_player_*` |
| `vipcore` | Profile badge, VIP tiers, staff: grant / extend / remove | `vip_users`, `vip_servers` | `vip_users` |
| `economy` | Balances leaderboard per wallet | `balance` | adjustments: additions any time, removals offline only |
| `shop` | Shop (buy, inventory, history, gifts), profile inventory, landing showcase; staff: ledger, credits, item grants, catalog import | `PlayerCookies` (`shopcore:item:*`), `balance` (ShopCore's wallet), `shopcore_ledger`, imported module configs | `PlayerCookies` keys, `balance`, `shopcore_ledger` — offline only, except credits added (§8.6); `sp_shop_items` |

Later candidates: **maps** (MapChooser pool — config, not database), **pages** (rules, FAQ),
**discord** (webhooks for bans and VIP).

---

## 7. Database

### 7.1 Connections

`config/config.php` mirrors SwiftlyS2's `configs/database.jsonc`, so a module setting names the
same connection the plugin uses. Both the URI and the object form are accepted, and the
installer can import a pasted `database.jsonc` (comments stripped).

```php
return [
    'app' => ['url' => 'https://panel.example.com', 'key' => '…random 32 bytes…', 'debug' => false],
    'table_prefix' => 'sp_',
    'default_connection' => 'default',
    'connections' => [
        'panel'       => 'mysql://panel:secret@127.0.0.1:3306/swiftly_panel',
        'default'     => 'mysql://ranks_ro:secret@10.0.0.5:3306/swiftlys2',
        'admins'      => ['driver' => 'mysql', 'host' => '10.0.0.5', 'database' => 'admins', 'user' => 'panel_admins', 'pass' => '…'],
        'weaponskins' => 'mysql://panel_ws:secret@10.0.0.5:3306/weaponskins',
        'cookies'     => 'mysql://panel_cookies:secret@10.0.0.5:3306/cookies',
    ],
];
```

Recommended: one database user per connection, with the least privilege its module needs
(`SELECT` only for Ranks; `SELECT, INSERT, UPDATE` on named tables for Admins, WeaponSkins and the
shop's `PlayerCookies`, `balance` and `shopcore_ledger`).
All connections use `utf8mb4` — player names carry emoji and "fancy font" letters, and Ranks had to
migrate its name columns to `utf8mb4` for exactly that reason.

### 7.2 Panel tables

Prefix `sp_` (configurable). DDL shown for MySQL/MariaDB; the migrator emits the equivalent for
PostgreSQL and SQLite. JSON is stored in `MEDIUMTEXT`, not `JSON`, for MariaDB and MySQL parity.

```sql
CREATE TABLE sp_users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  steam_id        BIGINT NOT NULL,                 -- SteamID64; signed like the plugins' columns
  persona_name    VARCHAR(128) NOT NULL DEFAULT '',
  avatar_hash     VARCHAR(64) NULL,
  locale          VARCHAR(10) NULL,
  time_zone       VARCHAR(64) NULL,
  profile_private TINYINT(1) NOT NULL DEFAULT 0,
  disabled        TINYINT(1) NOT NULL DEFAULT 0,   -- panel lockout, independent of game bans
  created_at      DATETIME NOT NULL,
  last_login_at   DATETIME NULL,
  last_login_ip   VARCHAR(45) NULL,
  UNIQUE KEY ux_sp_users_steam (steam_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sp_roles (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug        VARCHAR(48) NOT NULL,
  name        VARCHAR(64) NOT NULL,
  color       CHAR(7) NOT NULL DEFAULT '#a5afbd',
  weight      INT NOT NULL DEFAULT 0,              -- the highest names the user
  is_system   TINYINT(1) NOT NULL DEFAULT 0,       -- owner, player, guest: editable, not deletable
  description VARCHAR(255) NULL,
  UNIQUE KEY ux_sp_roles_slug (slug)
);

CREATE TABLE sp_role_permissions (
  role_id    INT UNSIGNED NOT NULL,
  kind       VARCHAR(8) NOT NULL DEFAULT 'panel',  -- 'panel' or 'game' (see 9.3)
  permission VARCHAR(128) NOT NULL,                -- exact key, prefix.*, or *
  PRIMARY KEY (role_id, kind, permission)
);

CREATE TABLE sp_role_links (                       -- automatic membership
  id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id INT UNSIGNED NOT NULL,
  source  VARCHAR(48) NOT NULL,                    -- steamid · admins.group · admins.permission · vipcore.group · authenticated · anonymous
  value   VARCHAR(128) NOT NULL DEFAULT '',
  KEY ix_sp_role_links_role (role_id)
);

CREATE TABLE sp_user_roles (                       -- manual membership
  user_id    INT UNSIGNED NOT NULL,
  role_id    INT UNSIGNED NOT NULL,
  granted_by INT UNSIGNED NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sp_settings (
  scope       VARCHAR(48) NOT NULL,                -- 'core' or a module id
  setting_key VARCHAR(96) NOT NULL,
  value       MEDIUMTEXT NOT NULL,                 -- JSON
  updated_at  DATETIME NOT NULL,
  PRIMARY KEY (scope, setting_key)
);

CREATE TABLE sp_modules (
  id           VARCHAR(48) PRIMARY KEY,
  enabled      TINYINT(1) NOT NULL DEFAULT 0,
  version      VARCHAR(16) NOT NULL,
  installed_at DATETIME NOT NULL,
  updated_at   DATETIME NOT NULL
);

CREATE TABLE sp_migrations (
  module     VARCHAR(48) NOT NULL,
  version    VARCHAR(32) NOT NULL,
  applied_at DATETIME NOT NULL,
  PRIMARY KEY (module, version)
);

CREATE TABLE sp_audit_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NULL,
  steam_id    BIGINT NULL,
  action      VARCHAR(64) NOT NULL,                -- admins.ban.create, vipcore.grant, panel.theme.update …
  target_type VARCHAR(32) NULL,
  target_id   VARCHAR(64) NULL,
  details     MEDIUMTEXT NULL,                     -- JSON: before/after, connection, row ids
  ip          VARCHAR(45) NULL,
  created_at  DATETIME NOT NULL,
  KEY ix_sp_audit_created (created_at),
  KEY ix_sp_audit_target (target_type, target_id)
);

CREATE TABLE sp_sessions (                         -- remember-me tokens; PHP sessions stay in files
  id           CHAR(64) PRIMARY KEY,               -- SHA-256 of the token; the token itself is never stored
  user_id      INT UNSIGNED NOT NULL,
  ip           VARCHAR(45) NULL,
  user_agent   VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  expires_at   DATETIME NOT NULL,
  KEY ix_sp_sessions_user (user_id)
);

CREATE TABLE sp_steam_profiles (                   -- names and avatars, refreshed daily
  steam_id     BIGINT PRIMARY KEY,
  persona_name VARCHAR(128) NOT NULL,
  avatar_hash  VARCHAR(64) NULL,
  fetched_at   DATETIME NOT NULL
);

CREATE TABLE sp_theme_presets (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(64) NOT NULL,
  tokens     MEDIUMTEXT NOT NULL,                  -- JSON { "--sp-accent": "#f0953a", … }
  is_builtin TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL
);

CREATE TABLE sp_nav_links (                        -- operator links: Discord, rules, store
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  area       VARCHAR(16) NOT NULL,                 -- 'public' or 'footer'
  label      VARCHAR(64) NOT NULL,
  url        VARCHAR(255) NOT NULL,
  icon       VARCHAR(48) NULL,
  weight     INT NOT NULL DEFAULT 0,
  new_tab    TINYINT(1) NOT NULL DEFAULT 0,
  permission VARCHAR(128) NULL
);

CREATE TABLE sp_cron_runs (
  task        VARCHAR(64) PRIMARY KEY,
  last_run_at DATETIME NULL,
  last_status VARCHAR(16) NULL,
  last_error  TEXT NULL
);

-- owned by the servers module
CREATE TABLE sp_server_meta (
  server_guid  VARCHAR(36) PRIMARY KEY,            -- Admins' servers.GUID
  display_name VARCHAR(96) NULL,
  mode         VARCHAR(32) NULL,                   -- 5v5, AWP, Retakes … for filter chips
  sort_order   INT NOT NULL DEFAULT 0,
  map_image    VARCHAR(255) NULL,
  hidden       TINYINT(1) NOT NULL DEFAULT 0,
  query_host   VARCHAR(255) NULL                   -- when the public address differs from servers.IP
);

-- owned by the shop module: ShopCore's catalog, imported from the modules' item configs (§8.6)
CREATE TABLE sp_shop_items (
  item_id             VARCHAR(128) PRIMARY KEY,    -- ShopItemDefinition.Id, lowercased like ShopCore's cookie keys
  module              VARCHAR(64) NOT NULL,        -- Shop_Tracers …
  source_file         VARCHAR(128) NOT NULL,       -- tracers_config.jsonc …
  display_name        VARCHAR(128) NOT NULL,       -- as the module builds it in the server's language
  category            VARCHAR(128) NOT NULL,       -- full path, "Visuals/Tracers"
  price               INT NOT NULL,                -- whole credits, as ShopCore requires
  sell_price          INT NULL,                    -- NULL: DefaultSellRefundRatio × price
  duration_seconds    INT NOT NULL DEFAULT 0,      -- 0: no expiry
  type                VARCHAR(16) NOT NULL,        -- Passive, Consumable, Temporary, Permanent
  team                VARCHAR(8) NOT NULL DEFAULT 'Any',
  enabled             TINYINT(1) NOT NULL DEFAULT 1,
  can_be_sold         TINYINT(1) NOT NULL DEFAULT 1,
  is_equipable        TINYINT(1) NOT NULL DEFAULT 1,
  image_key           VARCHAR(160) NULL,           -- panorama/images/econ path, as the module would set ImageKey
  required_permission VARCHAR(128) NULL,           -- checked in game by the module's purchase hook
  extra               MEDIUMTEXT NULL,             -- JSON: Color, ModelPath, BaseWeapon, GrantedPermission …
  imported_at         DATETIME NOT NULL
);
```

Rate limits, A2S results, the module manifest cache and the item catalog live in `storage/cache`,
not in tables: they are disposable and hot.

### 7.3 Cross-database identity

| Thing | Rule |
|---|---|
| SteamID64 | The key every module joins on, **application-side** (modules may sit on different connections, so no SQL joins across them). Stored as signed `BIGINT` by Admins, Ranks and Economy; as `VARCHAR(18)`/`VARCHAR(64)` by WeaponSkins. **VIPCore's `account_id` is different**: the 32-bit AccountID (SteamID64 − 76561197960265728) on grants VIPCore made, the SteamID64 on older rows (§8.4). PHP keeps a SteamID64 a **string** end to end; JSON sends it as a string (it exceeds JavaScript's 2^53). |
| Times | Explicit per source: Admins **Unix milliseconds** (`0` = permanent, or still open); VIPCore **Unix seconds** (`expires 0` = permanent); Ranks **UTC `DATETIME`** plus `period` = Unix seconds of a season's start; Economy UTC `DATETIME`; ShopCore **Unix seconds** (`shopcore:item:expireat:*` cookies, `shopcore_ledger.TimestampUnixSeconds`). `Support\Time` never guesses a unit. |
| Display | Converted once, in the view, to the panel's time zone (a setting, like Admins' `TimeZone`). |

---

## 8. Plugin contracts

What each module reads and writes, in the plugins' own encodings, and when the game sees it.
The formatters reproduce the plugins' output so web and game read the same: Admins' compact
lengths (`14d`, `1d 6h`, `1h 30m`, `45s` — the two largest units), Ranks' playtime (`4d 5h 30m`,
`5h 30m`, `30m`), K/D to 2 decimals, HS % and accuracy to 1 decimal.

### 8.1 Admins

Connection: the plugin's `admins` connection. Tables: `servers`, `groups`, `admins`, `bans`,
`sanctions`, `player_sessions`, `ip_ban_exclusions`, ledger `VersionInfo`. The plugin's README has a
*Web Panels* section that defines this contract; the module follows it to the letter.

| Table | Key columns and meaning |
|---|---|
| `servers` | `Id`, `IP`, `Port`, `Hostname`, `GUID`, `LastSeenAt` (ms). Each server keeps its own row up to date, with the GUID from `data/Admins/server_id.txt`. `IP` is empty until Steam has given the server its address; `LastSeenAt` is refreshed every minute while it runs (`0` = not since the column was added). |
| `groups` | `Name` (matched case-insensitively), `Permissions` and `Servers` as **JSON string lists**, `Immunity`. |
| `admins` | `SteamId64` (unique), `Username` (unique), `Permissions`, `Groups`, `Servers` (JSON lists), `Immunity`. An admin applies on a server only if that server's **GUID is in `Servers` — there is no wildcard**. Effective immunity = max(own, groups' that apply). |
| `bans` | `SteamId64`, `PlayerName`, `PlayerIp` (no port), `BanType` (1 SteamID, 2 IP), `ExpiresAt` and `Length` in **ms** (`0` = permanent), `Reason`, `AdminSteamId64` (`0` = Console), `AdminName`, `Server` (issuing GUID), `GlobalBan`, `CreatedAt`, `UpdatedAt` (ms), `Status` (0 Active, 1 Lifted, 2 Expired). |
| `sanctions` | As `bans`, with `SanctionType` (1 SteamID, 2 IP), `SanctionKind` (1 Gag, 2 Mute), `GlobalSanction`. **A silence is two rows** — a gag and a mute written together. |
| `player_sessions` | `SteamId64`, `PlayerName`, `PlayerIp`, `Server` (GUID), `ConnectedAt`, `LastSeenAt` (heartbeat every 60 s), `DisconnectedAt` (`0` while open). Finished rows kept `Sessions.RetentionDays` (90). |
| `ip_ban_exclusions` | `SteamId64` (unique), `PlayerName`, `AdminSteamId64`, `AdminName`, `CreatedAt`. |

**Reading**

- Status is decided **the plugin's way**: active when `ExpiresAt = 0 OR ExpiresAt > now`;
  otherwise Lifted if `Status = 1`, else Expired. The stored `Status` lags until a server's next
  sync, so it is never trusted alone. Labels: *Active / Expired / Unbanned* for bans,
  *Active / Expired / Lifted* for comms; timelines *"4d 3h left"*, *"ended 2d ago"*, *"unbanned 1d ago"*.
- Silences are regrouped for display by `(SteamId64, PlayerIp, AdminSteamId64, CreatedAt, Length,
  Reason, Server, GlobalSanction)` and shown as one record with both ids (`#823+824`).
- "Online now" = `DisconnectedAt = 0 AND LastSeenAt > now − 150 s` — the plugin's own 2.5 × heartbeat
  test. The `player.online` hook exposes it to other modules, which is how Ranks, Economy and Shop
  know a player is offline before allowing an edit.
- IP addresses appear only with `admins.ip.view`; the plugin's README asks the same of `!sessions`
  and `!who`, whose permissions should go "only to staff who may see them".

**Writing** (each is one transaction, audited)

| Action | Row written |
|---|---|
| Ban | `INSERT bans` with `CreatedAt = UpdatedAt = now` (ms), `ExpiresAt = 0` or `now + Length`, `Status 0`, `Server` = the chosen server's GUID (global bans: the panel's "home" server, configurable), `AdminSteamId64`/`AdminName` = the web user (their admin `Username` when they have one), `PlayerName` = the known name or `Unknown`, `PlayerIp` normalised without port, or `''`. `SteamId64 = 0` for an address nobody is known by. |
| Gag / mute / silence | Same in `sanctions`; a silence inserts the gag row and the mute row with identical fields. |
| Lift | `ExpiresAt = now`, `UpdatedAt = now`, `Status = 1` — exactly the plugin's lift. Nothing is deleted. |
| Change length | `Length = new`, `ExpiresAt = now + new` ("the new length counts from now"), `UpdatedAt = now`. |
| Admin / group | `Permissions`, `Groups`, `Servers` as JSON arrays of trimmed strings; "all servers" writes every GUID. |
| IP-ban exclusion | `INSERT ip_ban_exclusions`. |

Immunity is enforced before a web action on an admin, with `ImmunityMode` mirrored in the module
settings (the plugin's config file is not readable from the web): 0 ignore, 1 higher-or-equal,
2 strictly higher, 3 like 2 but two zero-immunity admins may target each other.

**In game**: bans and comms reach online players within `Bans/Comms.DatabaseSyncIntervalSeconds`
(30 s) and new connections at once; admins and groups within `Admins.DatabaseSyncIntervalSeconds`
(60 s) or `!reloadadmins`.

### 8.2 Ranks and its modules

Connection: `Database.Connection` (default `default`). **Every table name carries the operator's
prefix and suffix** (`TablePrefix`, `TableSuffix`, normalised to `awp_` / `_awp`), so one database
can hold several independent ladders. The module therefore supports a list of *ladders*, each with
a display name, connection, prefix and suffix — one leaderboard per server family.

A ladder may run **EloPoints**, which is an *absolute* module: on its servers core stops scoring,
and the module writes the rounded rating into `points` while `ranks_elopoints.rating` stays the
exact value. XP and Elo therefore never share a ladder; an Elo ladder's leaderboard *is* its rating
table. The mockups show this as a second ladder — the 5v5 servers, under the prefix `comp_`.

| Table | Owner | Meaning |
|---|---|---|
| `ranks_players` | core | `steam_id` PK, `name`, `points`, `kills`, `deaths`, `assists`, `round_wins`/`round_losses`, `match_wins`/`match_losses`, `bombs_planted`/`bombs_defused`, `headshots`, `hits`, `misses`, `playtime` (seconds), `first_seen`, `last_seen`, `period` |
| `ranks_players_history` | core | Closed seasons, PK `(steam_id, period)` |
| `ranks_settings` | core | Per-player preferences (`show_point_messages`) |
| `ranks_weapon_stats` (+`_period`) | WeaponStats | `(steam_id, weapon)`: `shots`, `hits`, `misses`, `damage`, `kills`, `deaths`, `headshots`. `weapon` is always `weapon_<name>`, or `world`, `planted_c4`, `inferno`, `trigger_hurt`, `unknown` |
| `ranks_hit_stats`, `ranks_weapon_hit_stats` (+`_period`) | WeaponStats | Landed hits and damage per raw `HitGroup_t`: 0 generic, 1 head, 2 chest, 3 stomach, 4/5 left/right arm, 6/7 left/right leg, 8 neck, 10 gear, 11 special (9 is unused). Misses have no hit group. |
| `ranks_elopoints` (+`_history`) | EloPoints | `rating DECIMAL(10,4)`, `matches`, `abandons`, `updated_at`, `period` |
| `ranks_combos` (+`_period`) | CustomCombos | `(steam_id, combo_key)`: `count`, `last_at` |
| — | Prestige | No tables: the level is derived from stored points and the module's `Levels[].MinimumPoints` |

**Seasons.** `period` is the Unix time (seconds) of a season's start, `0` = before seasons. The
current season is `ranks_players.period`; a closed season's rows move to history at the boundary
for players who are online, otherwise the next time they join, so a past season reads history
**plus** player rows still tagged with it. All time
sums both tables and adds `StartPoints` back once — the panel uses the same SQL as
`PlayerStore.Ranking()`. Labels follow the plugin: a calendar month by name (*November 2026*),
otherwise *Season from 2026-09-07*, and *Before seasons*.

**Configuration the database does not hold** — the rank ladder (`ranks.jsonc`), `StartPoints`,
the season schedule, prestige levels and combo names — is mirrored in the module settings. The
ladder defaults to the plugin's shipped Premier bands (Grey 0, Light Blue 5 000, Blue 10 000,
Purple 15 000, Pink 20 000, Red 25 000, Gold 30 000); an operator pastes their `ranks.jsonc` to
replace it. The plugin's own alternatives parse the same way: `ranks-competitive.jsonc` (18 tiers,
one per CS2 skill group) and EloPoints' `ranks-elo.jsonc` (10 bands centred on `StartPoints = 1000`,
"where an unrated player enters").

**Writes: none by default.** Ranks keeps online players in memory and saves absolute values every
`SaveIntervalSeconds` (300), so an edit to an online player is overwritten. "Reset player" is
offered only while `player.online` says they are offline, and removes the player's rows the way
`!resetrank` does.

### 8.3 WeaponSkins

Connection: with `StorageBackend = "inherit"` (the default) WeaponSkins opens SwiftlyS2's
`weaponskins` connection, which is `default` unless `database.jsonc` defines one by that name — the
documented setup for sharing skins between servers. `StorageBackend = "sqlite"` keeps skins on the
game server, out of the panel's reach. Tables are WeaponPaints-compatible; ledger
`__weaponskins_version_info`.

| Table | Key | Columns |
|---|---|---|
| `wp_player_skins` | `(steamid, weapon_team, weapon_defindex)` | `weapon_paint_id`, `weapon_wear` (float), `weapon_seed`, `weapon_nametag`, `weapon_stattrak`, `weapon_stattrak_count`, `weapon_sticker_0..5` = `"id;schema;x;y;wear;scale;rotation"`, `weapon_keychain` = `"id;x;y;z;seed"` |
| `wp_player_knife` | `(steamid, weapon_team)` | `knife` = classname, e.g. `weapon_knife_karambit`; its finish is a `wp_player_skins` row with the knife's defindex |
| `wp_player_gloves` | `(steamid, weapon_team)` | `weapon_defindex` of the glove; its finish is a `wp_player_skins` row |
| `wp_player_agents` | `(steamid, weapon_team)` | `agent_index` |
| `wp_player_music` | `(steamid, weapon_team)` | `music_id`, written for **teams 0 and 1** |
| `wp_player_pins` | `(steamid, weapon_team)` | `id`, written for **teams 2 and 3** |
| `wp_player_graffiti` | `steamid` | `graffiti_id`, `tint_id` |
| `wp_player_agent_patches` | `(steamid, weapon_team, slot)` | `patch_id` |

`weapon_team` is 2 for T and 3 for CT; "both" writes both rows. Writes are single-statement upserts
on those unique keys (`ON DUPLICATE KEY UPDATE` / `ON CONFLICT`). Numbers are written with the
invariant culture (`0.1342`, never `0,1342`): the plugin tolerates legacy commas but should not have to.

**Item permissions.** The plugin's `[Main.ItemPermissions]` — `WeaponSkins`, `KnifeSkins`,
`GloveSkins`, `Stickers`, `Keychains`, `Agents`, `MusicKits`, `Graffiti`, `Patches`, `Pins`,
`Nametag`, `Wear`, `Seed` — are mirrored in the module settings with the same names and the same
rule: empty = everyone, otherwise an in-game permission checked with SwiftlyS2's wildcard matching.
The panel resolves the signed-in player's in-game permissions (§9.3), greys out what they lack and
refuses to write it. The game re-applies its own rules when it loads the row, so the web can never
grant more than the plugin allows — a mismatch only shows options that do nothing.

**Item catalog.** The game files are not available to a website, so the catalog (weapons, finishes
with rarity and float range, knives, gloves, agents, stickers, charms, music kits, pins, graffiti,
patches) comes from [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) (MIT), currently served
from `raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/{lang}/`. A staff action downloads
it in chunks into `storage/cache/catalog/`; images are Steam CDN URLs (optionally mirrored locally).
Weapons are grouped exactly as WeaponSkins' menu groups them: Rifles, Pistols, SMGs, Shotguns,
Snipers, Heavy, Other.

**In game**: with `SyncFromDatabaseWhenPlayerJoin = true` a change applies on the next join;
otherwise the player types `!wp`. The page says so after every save.

### 8.4 VIPCore

Connection: `DatabaseConnection` (default `default`). Ledger `__vipcore_version_info`.

| Table | Meaning |
|---|---|
| `vip_users` | PK `(account_id, sid, group)`; `account_id`, `name`, `lastvisit`, `sid` (0 = all servers, else `vip_servers.serverId`), `group`, `expires` (**Unix seconds**, 0 = permanent), `granted` (seconds; 0 before VIPCore 1.2.0) |
| `vip_servers` | `serverId`, `serverIp`, `port`, `GUID` — maps the scope picker to real servers |

**`account_id` has two forms.** VIPCore writes the 32-bit AccountID (SteamID64 − 76561197960265728)
for every grant it makes, while older rows hold the SteamID64; it reads a player's grants under both.
The panel does the same: it reads `account_id IN (steamid64, accountid)` and, when it writes, keeps
the form of a row that already exists and uses the AccountID for a new one.

Grants follow `VipService`: granting a group the player already holds **adds** the time still left;
extending counts from the current expiry, or from now when it has passed; `granted` keeps the date
of a grant that is still running and is `now` otherwise; `lastvisit = now`; remove deletes the row.
VIPCore deletes a player's expired rows when they next join, so "expired" is a short-lived state.
Groups and their perks live in `vip_groups.jsonc`; the module settings mirror names, weights and
an operator-written perk description. With several groups, the highest `Weight` wins, and a local
grant beats a global one of equal weight. **In game**: players already online may need to reconnect.

### 8.5 Economy

Table `balance`: unique `(steam_id, wallet_kind)`, `balance DECIMAL(18,2)`; wallets are the
`WalletKinds` setting (default `credits`). How Economy (2.0.3) saves decides what the web may do:

| Economy | Consequence for the web |
|---|---|
| Loads a player's balances when Steam authorises them and keeps them in memory while they play | The in-game balance does not see a web change until the player rejoins |
| Saves on disconnect, at round end with `SaveOnRoundEnd`, or from its queue every `SaveQueueIntervalSeconds` (default `0`: off). A save adds the session's **change** to the value now in the database, which its code notes "may have been modified externally" | A web change is never overwritten |
| Clamps at `0` unless `AllowNegativeBalance` | Credits taken on the web while the player is online can be spent again in game; the clamp then hides the shortfall |

So credits may be **added at any time**, as an upsert on the unique key (a player who never joined
has no row), and **removed only while the player is offline**, as one conditional statement:
`UPDATE balance SET balance = balance − :n … WHERE steam_id = :sid AND wallet_kind = :w AND balance >= :n`,
where 0 affected rows means "not enough". (A staff removal that may clamp to the balance reads it
under a row lock instead, §8.6.) Offline means no open Admins session and none closed in
the last 30 seconds, so Economy's save on the way out lands first. The module also shows each
wallet as a leaderboard.

### 8.6 ShopCore

ShopCore (v1.1.9) is a core with modules (`Shop_Tracers`, `Shop_PlayerModels` …): the modules
register items, ShopCore sells them, keeps who owns what in Cookies and the credits in Economy.

| What | Where | Panel |
|---|---|---|
| Catalog | Nowhere persistent: each module registers `ShopItemDefinition`s at load, from its config file | Imported into `sp_shop_items` |
| Who owns what | The player's `PlayerCookies` row, Cookies' connection `cookies` | Read; written while offline |
| Credits | Economy's `balance`, wallet `Main.Credits.WalletName` (`credits`) | As §8.5 |
| History | `shopcore_ledger`, only with `Main.Ledger.Persistence` on MySQL or PostgreSQL (by default the ledger is in memory; with persistence on and the default provider, an SQLite file in the plugin's folder) | Read; web rows added |

**Catalog import.** Most modules keep their items in `configs/plugins/ShopCore/modules/*.jsonc`,
loaded through ShopCore's `LoadModuleConfig`, in one shared shape: `Main.Settings.Category` and
`Main.Items[]` of `Id`, `DisplayName` or `DisplayNameKey`, `Price`, `SellPrice`,
`DurationSeconds`, `Type`, `Team`, `Enabled`, `CanBeSold`, and often `RequiredPermission`. The
import reads that shape, with a small adapter per bundled module for the rest:

| Module | Differs by |
|---|---|
| Shop_PlayerModels | Its own plugin config, `configs/plugins/Shop_PlayerModels/config.jsonc`; art from `ModelPath` |
| Shop_VIP | `ShopDurationHours` and a VIPCore `Group`; not equipable |
| Shop_CustomWeapon | A per-item `Category` under `Weapons/Custom`; art from `BaseWeapon` |
| Shop_SmokeColor, Shop_Tracers, Shop_PlayerColor and most others | Names come from the module's translation template with the colour and the duration: `{0} Tracer ({1})` → *Red Tracer (1 Hour)* |
| Shop_Rewards, Shop_Coinflip | No items. Shop_Rewards' amounts (+2 a kill, +5 a headshot, +15 MVP …) are shown as how credits are earned |

Names are built as the module builds them, category paths are split like ShopCore's
`ParseCategoryPath` (first segment the category, the rest the subcategory, empty → `Misc`), and
items sort as the in-game menus do: categories A–Z, then price, then name. The import shows what
changed before saving; re-import after editing the files on the server. A module the panel does
not know is read by the shared shape and is not sold on the web until the operator turns it on.
**A small ShopCore change would do better**: mirror every registered item into a table, which
would also cover items modules register at runtime.

**Item art.** An `ImageKey` (set by Shop_PlayerModels, Shop_CustomWeapon, Shop_Healthshot and
Shop_DecoyTeleport) is matched to the cached item catalog's image. Colour items draw their colour:
`Color` as RGB, or a .NET named colour, which CSS shares; `Rainbow`, `Team` and `Random` have their
own looks. Everything else shows its module's icon.

**Item state.** Three keys per item in the player's `Data` JSON, the item id lowercased:

| Key | Value |
|---|---|
| `shopcore:item:owned:<id>` | `true` while owned. `false` is common and means nothing: Cookies' `GetOrDefault` stores the default it returns |
| `shopcore:item:enabled:<id>` | `true` while equipped |
| `shopcore:item:expireat:<id>` | Unix seconds; absent for items without a duration |

Read with ShopCore's `GetItemState` rule: owned while `expireat` is absent or in the future (expired
keys stay until ShopCore next checks the item), equipped only while owned, and a row holding only
`enabled` is legacy data that counts as owned. Consumables and items with `IsEquipable = false`
have no state. Other plugins share the row (VIPCore keeps its feature switches there, `vip.health`),
so the panel changes only its own keys.

**Writing `PlayerCookies`** the way the Cookies README asks of a website: "lock the row
(`SELECT ... FOR UPDATE`), merge, update", never writing back a whole `Data` read earlier.
`SteamId64` is unique from Cookies 1.0.15; before that the lowest `Id` wins, as Cookies reads it. A
player without a row gets an `INSERT`, retried as an update if one appears meanwhile. On PostgreSQL
`Data` is `character(16384)` and arrives space-padded; on MySQL it is `TEXT` (65,535 bytes).

**Why buying and selling wait until the player leaves.** Cookies sees a web change within five
seconds, but ShopCore caches each player's item state until they disconnect, and Economy holds
the balance:

| Done on the web while the player is online | What could happen |
|---|---|
| Buy | ShopCore still thinks the item is not owned, and buying it in game charges twice |
| Sell | The item stays owned in game and can be sold again: a second refund |
| Any debit | The in-game balance still has the credits |

**Web actions**

| Action | Allowed when | Writes, in this order |
|---|---|---|
| Buy | `shop.use`; the player is offline; the item is enabled, equipable, not consumable and for both teams; its module is sold on the web; its `RequiredPermission` is held (resolved like WeaponSkins' item permissions, §9.3); not owned; enough credits | 1. debit, conditional; 2. `owned = true` merged under the row lock; 3. ledger `purchase`. If 2 fails, the debit is refunded |
| Sell | `shop.use`; offline; owned; `Behavior.AllowSelling`; `CanBeSold` | 1. under the row lock, check ownership and remove the three keys; 2. credit `SellPrice`, else `Price × DefaultSellRefundRatio` rounded away from zero (`ResolveSellPrice`); 3. ledger `sell`. If 2 fails, the keys go back |
| Gift credits | `shop.use`; `Credits.Transfer.Enabled`; the sender is offline; at least `MinimumAmount`; to oneself only with `AllowSelfTransfer` | Debit, credit; ledger `credits_subtract` and `credits_add`, as `!gift` writes them |
| Give or remove credits | `shop.credits.manage`; removals offline only and, as `!removecredits`, refused at a zero balance; more than the balance takes all of it with `ClampRemovalToAvailableBalance` (ShopCore's default), otherwise it is refused | `balance` (a removal reads it under a row lock); ledger `credits_add` or `credits_subtract` with the amount actually moved |
| Grant or revoke an item | `shop.items.manage`; offline | The keys only: no charge, no ledger row (ShopCore has no action for it), the audit log |

Items **bought or granted on the web arrive unequipped and without `expireat`**. The player equips
them in game with `!inventory`: ShopCore's `SetItemEnabled` gives a timed item that has no expiry
its full duration from then, and the module's own rules run, most of which allow one of their items
at a time and switch the others off. The web never equips anything.

**Left to the game**, and shown as such: consumables (Healthshot, Decoy Teleport) and Shop_VIP's
memberships, which take effect at the moment of purchase; items limited to one team, since ShopCore
checks the buyer's team; equipping, previews and coinflip. Purchase hooks the web cannot run
(`OnBeforeItemPurchase`) are why web sale is a switch per module: on for the bundled modules, whose
only hook is `RequiredPermission`, and off for any other until the operator has checked it.

**Ledger rows the panel writes** use ShopCore's actions, a positive `Amount`, the `BalanceAfter`
read back after the change, and `PlayerId = -1`, which no game slot uses. The table has no index
beyond its key, and the panel reads it per `SteamId` with a limit, ordered as ShopCore orders it
(`TimestampUnixSeconds`, then `Id`, newest first). ShopCore's own per-player query has the same cost,
so the `(SteamId, TimestampUnixSeconds)` index both need belongs in ShopCore's entity; until then the
dashboard's system checks warn once the table grows large. Shop_Rewards writes a `credits_add`
row per reward, so the history folds a player's consecutive ones within 15 minutes into one line.
The starting balance and timed income bypass the ledger.

### 8.7 Sync summary

| Change made on the web | Reaches the game |
|---|---|
| Ban, gag, mute, silence, lift, change length | Online players within 30 s; new connections at once |
| Admin or group edited | Within 60 s, or `!reloadadmins` |
| Skin, knife, gloves, agent, music kit, pin, graffiti | Next join with `SyncFromDatabaseWhenPlayerJoin`, otherwise `!wp` |
| VIP granted, extended, removed | Next connect |
| Shop item bought, sold, granted or revoked (offline only) | Next join; equip with `!inventory` |
| Credits added | Kept at once; a player who is online sees them after rejoining |
| Credits removed, gifts sent (offline only) | Next join |
| Ranks | Read-only (offline-only reset) |

---

## 9. Sign-in, roles and permissions

### 9.1 Steam OpenID

1. `/auth/steam` redirects to `https://steamcommunity.com/openid/login` (`checkid_setup`,
   identifier_select, `realm` = the panel's origin, `return_to` = `/auth/steam/callback` with a nonce).
2. The callback **verifies the assertion server-side**: re-POST the signed fields with
   `openid.mode=check_authentication` and require `is_valid:true`; require `claimed_id` to match
   `^https://steamcommunity.com/openid/id/(\d{17})$` and `return_to` to be ours; reject a reused nonce.
3. Upsert `sp_users`, regenerate the session id, resolve roles, redirect to a **same-origin** return URL.

No Steam Web API key is needed to sign in. With one, names and avatars refresh daily
(`GetPlayerSummaries`, 100 SteamIDs per call) into `sp_steam_profiles`; without, names come from
the plugins' tables and avatars are initials on a rarity tint (as in the mockups).

The first owner is set in the installer by SteamID64; nobody becomes owner by being first to sign in.

### 9.2 Roles

| Role (seeded) | Weight | Typical permissions | Typical auto-assignment |
|---|---|---|---|
| Owner | 100 | `*` | the installer's SteamID64 |
| Web admin | 80 | `panel.*`, `shop.*` | — |
| Server admin | 60 | `admins.bans.*`, `admins.comms.*`, `admins.ip.view`, `admins.sessions.view`, `vipcore.manage`, `shop.ledger.view`, `shop.credits.manage` | Admins group `admin` |
| Moderator | 40 | `admins.bans.create`, `admins.bans.lift`, `admins.comms.create`, `admins.comms.lift` | Admins group `moderator` |
| VIP | 20 | `weaponskins.use` + game permission `vip` | VIPCore groups `GOLD`, `LEGEND` |
| Player | 1 | `weaponskins.use`, `shop.use`, `profile.edit` | everyone signed in |
| Guest | 0 | `public.view` | not signed in |

Membership is manual (`sp_user_roles`, optionally expiring) or automatic (`sp_role_links`), so
server staff manage the web through the tables they already maintain: put someone in the Admins
group `moderator` and they are a web moderator within ten minutes. Sources come from modules
(`role.sources`): `steamid`, `admins.group`, `admins.permission`, `vipcore.group`,
`authenticated`, `anonymous`. Roles are resolved at sign-in and cached in the session for ten minutes.

### 9.3 Permissions

**Panel permissions** gate pages and actions. Keys follow SwiftlyS2's own rule, so operators learn
one syntax: an exact key, a key ending in `.*` granting everything below that prefix, or `*`.

| Prefix | Keys |
|---|---|
| `panel.*` | `settings`, `theme`, `layout`, `modules`, `roles`, `users`, `audit` |
| `admins.*` | `bans.create`, `bans.create.global`, `bans.lift`, `comms.create`, `comms.create.global`, `comms.lift`, `ip.view`, `sessions.view`, `admins.manage`, `exclusions.manage` |
| `ranks.*` | `settings`, `reset` |
| `weaponskins.*` | `use`, `manage`, `catalog` |
| `vipcore.*` | `manage` |
| `economy.*` | `manage` |
| `shop.*` | `use`, `ledger.view`, `credits.manage`, `items.manage`, `catalog` |

**Game permissions** are the in-game strings that WeaponSkins' item permissions and ShopCore
modules' `RequiredPermission` check (`vip`, …). The panel cannot ask a running server, so
`Access\GamePermissions` collects them from providers:

1. **Admins** — the admin's own `Permissions` plus their groups' (only for servers in scope; the
   module setting chooses "any server" or one GUID).
2. **Roles** — `kind = 'game'` rows, which stand in for SwiftlyS2's `permissions.jsonc` entries
   the web cannot read (typically the VIP role → `vip`).

The roles page includes a tester: pick a player, see their roles, panel permissions, game
permissions and which WeaponSkins features they unlock.

---

## 10. Theming and layout

### 10.1 Theme

Web admins edit colours on **Admin → Theme**; the rest of the panel is derived. No Sass, no build.

| Step | How |
|---|---|
| Tokens | Hues (`--sp-accent`, `--sp-gold`, `--sp-info`, `--sp-success`, `--sp-caution`, `--sp-danger`, `--sp-ct`, `--sp-t`, `--sp-legend`), surfaces (`--sp-bg`, `--sp-surface`, `--sp-surface-raised`, `--sp-surface-row`, `--sp-surface-hover`, `--sp-edge`, `--sp-tile`, `--sp-tile-deep`), text (`--sp-text`, `--sp-text-muted`, `--sp-text-faint`), shape (`--sp-radius` and `--sp-radius-lg`, from which the small and pill radii follow; `--sp-shell-opacity`), fonts, background image. Game colours (rarity 1–10, wear bands, CS Rating bands, level colours) are editable under *Advanced*, but no preset touches them. |
| Ladder | Components derive CustomHUD's steps from one hue with `color-mix()`: Half 50 %, Dim 35 %, Soft ~18 %, Wash 8 %, Fade 0 %. A component reads a local `--hue`; tone classes (`.tone-gold`, `.r-6`) set it. |
| Bootstrap | `panel.css` routes Bootstrap's variables, and the components that ship literal colours (buttons, form focus, checks, switches, pagination, dropdowns, progress, list groups, tabs), to the tokens. |
| Compile | Saving writes the tokens to `sp_settings`, computes what CSS cannot — the ink colour on the accent by WCAG contrast, `--bs-*-rgb` triplets, SVG check marks in that ink — and writes `storage/cache/theme/theme-<sha1>.css`. `/theme.css?v=<sha1>` serves it with a one-year immutable cache. No inline styles, so the CSP stays strict. |
| Presets | Each sets the accent and a whole surface family. **CS2** (default: `#f0953a` Counter-Strike orange on CS2's slate blue), **CS2 Blue** (`#82d8ff`, the colour CS2 itself marks the selected tab with), **CS2 Locker** (`#ff8a1f` on near-black, CustomHUD's default), **SwiftlyS2** (`#00feed` on `#08090a`, from the SwiftlyS2 site), **Pink** (`#f8a8d8`, CustomHUD's documented alternative), Emerald, Crimson; operators save their own (`sp_theme_presets`) and import or export JSON. |
| Guard rails | Live contrast report (text on page, muted on row, ink on accent, gold on surface) with AA/AAA grades; reset to a preset. |

Requirement: browsers with `color-mix()` (Chrome/Edge 111, Firefox 113, Safari 16.2 — all from 2023).

### 10.2 Layout

Web admins with `panel.layout` arrange the site on **Admin → Layout**. There is one layout for
every visitor, stored in `sp_settings` (`core` / `layout`); visitors cannot change it.

| Setting | Options |
|---|---|
| Menu | A top bar, or a side bar on the left or the right. Below 992 px a side bar folds into the top bar. |
| Content width | Centred, at most 1,360 px wide (like Bootstrap's `container-xxl`), or full width (`container-fluid`). The two differ only where the window is wider than that column. |
| Menu order | Every public entry in any order. Admin stays last and only staff see it. |
| Page panels | The landing page's panels, the player page's tabs (the first opens by default) and its Overview panels. |

The server writes the menu position and width as classes on `<html>` (`sp-nav-left`, `sp-nav-right`,
`sp-fluid`), so the first paint is already in the right frame and module CSS can follow them.

Each panel declares a width: wide, narrow or full. A wide and a narrow panel next to each other
share a row (7 + 5 of 12 columns), in either order; anything else takes the whole row. Any order
therefore leaves no gaps, and nobody sets widths by hand.

Only pages built from independent panels are arrangeable. Servers, leaderboard, punishments, skins
and shop are each one component, and admin pages stay fixed so every staff member finds the same
controls in the same place.

---

## 11. Design language

CS2's own menus, softened for reading on the web, with CustomHUD's rules for colour
(`CustomHUD/docs/DesignLanguage.md`). The mockups' `design-system.html` shows every part.

**Taken from CS2** (its Panorama stylesheets, `csgostyles` above all): the slate-blue page and
surfaces (the menu gradient `#14202b` → `#1e2d3d`, item tiles `#1e2a38` → `#19232f`), white and
light-grey text, hairlines as faint white, the team colours (`t-color` `#eabe54`, `ct-color`
`rgb(150, 200, 250)`), the rarity and CS Rating tier colours, tabs and buttons in uppercase with
almost no letter-spacing, the open tab as a tint of the accent, the faint menu dots, circular
avatars, and Noto Sans, the text face the game ships.

| Principle (CustomHUD) | On the web |
|---|---|
| One accent, a few signal hues with one job each | Accent = interaction only. Gold = values, prices, the leader. Info = counters and meters. Green and red = state. Legend = a tier above gold. CT blue and T gold, as in CS2. |
| Fills stay dim | Anything with a label is filled Soft at rest and Dim when active; the bright hue goes into outlines, bars and text. The single exception is the page's one "solid" action, with ink on the hue. |
| The layout is a dumb surface | No element without data behind it. Map art is the map's picture or, without one, its prefix's ground (awp, aim/am, surf, other) under CS2's menu dots. |
| Keyboard gets a list, mouse gets a grid | Lists for records (bans, leaderboards), tile grids for items and servers. |
| Motion is short | Transitions ≤ 0.2 s; `prefers-reduced-motion` honoured. |
| Every sidebar entry has an icon | Bootstrap Icons, muted at rest, white on hover, accent when active. |

**Recurring looks**: the *shell* (a dark glass panel over the slate page, like CS2's menu content
area), the *eyebrow* (a small accent caption over an uppercase title), the *rule* (a hairline
fading out), the *sidebar* (plain labels until hovered; the chosen one on an accent tint), *tiles*
whose rarity glow rises from the foot over a 2 px rarity line, the *chosen* look (accent outline
on a tile, accent tint on a row), *pills* in sentence case, boxed uppercase *badges*, the *footer
bar* with a back button and a red close.

**Tables** name the columns they can do without, in up to three tiers. When a table would not fit
its card (beside a side bar, on a phone), `panel.js` hides one tier at a time until it does, so a
narrow layout loses secondary columns instead of scrolling the status and actions out of view.

**Game parts**: the **CS Rating badge** (a slanted plate with a double stripe in the Premier band's
colour, thousands larger than the rest: **12**,310 — the one slanted shape, because it is CS2's),
Elo **level rings** (1–10), the **rank road**
(every tier, yours highlighted, the rest locked), the **wear track** (FN/MW/FT/WW/BS at
0.07/0.15/0.38/0.45, hatched outside the finish's float range), sticker slots, a hit-group figure,
**shop item art** (the game's image where the item has one, otherwise its colour glowing under its
module's icon).

**Type**: Barlow Semi Condensed for headings, labels and numbers (tabular figures), standing in for
CS2's Stratum2; Noto Sans for body text, as in CS2's menus; Noto Sans Mono for IDs, IPs and
commands. **Shape**: 6 px corners on controls, 10 px on panels, round pills and avatars. **Dark
only** in v1.

---

## 12. Pages

### 12.1 Routes

| Route | Module | Who | Mockup |
|---|---|---|---|
| `/` | core | everyone | `landing.html` |
| `/servers`, `/servers/{guid}` | servers | everyone | `servers.html` |
| `/bans`, `/comms`, `/bans/{id}` | admins | everyone (setting) | `punishments.html` |
| `/leaderboard`, `/leaderboard/{ladder}` | ranks | everyone | `leaderboard.html` |
| `/player/{steamid}`, `/players?q=` | core + all | everyone (private profiles: owner and staff) | `profile.html` |
| `/skins` | weaponskins | signed in, `weaponskins.use` | `skins.html` |
| `/shop`, `/shop/inventory`, `/shop/history` | shop | everyone browses; signed in with `shop.use` to buy, sell and gift | `shop.html` |
| `/vip` | vipcore | everyone | landing section |
| `/auth/steam`, `/auth/steam/callback`, `/logout` | core | — | — |
| `/admin` | core | staff | `admin.html` |
| `/admin/roles`, `/admin/theme`, `/admin/layout`, `/admin/settings`, `/admin/audit`, `/admin/modules` | core | `panel.*` | `admin-roles.html`, `admin-theme.html`, `admin-layout.html`, `admin.html` |
| `/admin/admins`, `/admin/groups`, `/admin/exclusions` | admins | `admins.admins.manage` | `admin-admins.html` |
| `/admin/shop` | shop | `shop.ledger.view`, `shop.credits.manage`, `shop.items.manage`, `shop.catalog` | `admin-shop.html` |
| `/api/…` | modules | as the page | JSON for the skin changer and htmx fragments |
| `/theme.css`, `/cron.php` | core | — | — |

`{steamid}` accepts SteamID64, `STEAM_0:X:Y`, `[U:1:Z]` or a vanity URL (resolved when a Steam API key is set).

### 12.2 Page notes

| Page | Highlights |
|---|---|
| Landing | Hero with community name and calls to action; live server list; season podium; recent punishments; WeaponSkins showcase; shop items with how credits are earned; VIP tiers. Each block is a `landing.widgets` contribution, absent when its module is off, in the layout's order (§10.2). |
| Servers | Cards with map art, status pill (Online / Full / Offline — up or down from the Admins heartbeat), address with copy, players meter with bots, a status-source indicator (A2S or sessions), Connect (`steam://connect/ip:port`); a drawer with the last report and the players from open sessions; staff see masked IPs and the GUID. |
| Punishments | Sidebar Bans / Comms; filters Active / Expired / Unbanned (Lifted) / All, Gags / Mutes / Silences, scope; columns ID, player, reason, length, issued, ends (with a served meter), admin, scope, status. A record view with SteamID formats, timeline and, for staff, the kick message the player sees. Staff: give (the in-game flow's steps on one form: player → type → reason → length → scope → match by), lift, change length. |
| Leaderboard | This season / All time / Previous seasons; XP, kills, playtime; each further ladder (the mockups' 5v5 Elo ladder) with its levels; rank road with distribution; the viewer's own position. |
| Player | Header (online state, VIP, staff, ban state, credits for the player and staff, SteamID formats, CS Rating); tabs Overview (rank, the player's rating on an Elo ladder, prestige, all-time statistics, seasons, combos), Weapons (per weapon, hit groups), Loadout (T/CT), Inventory (shop items, equipped and time left), Punishments, Sessions (staff). Tabs and Overview panels follow the layout (§10.2). |
| Skin changer | The WeaponSkins locker: sidebar by item type, T / CT / Both, weapon categories, finish grid with rarity glow and the equipped finish outlined, inspect card (wear track, seed, StatTrak™ and count, name tag, six sticker slots, charm, apply to), locks from item permissions, the row about to be written. |
| Shop | The ShopCore locker: credits and a gift button; Buy, Inventory and History tabs; categories in the sidebar with subcategory tabs, as the in-game menus nest them; item tiles with price, duration, owned or equipped, team and in-game-only marks, locks from `RequiredPermission`; an item card with sell value, duration, team and the buy or sell button, or the reason there is none; whether the player is on a server, and what they earn per kill; the rows a purchase writes. |
| Admin | Dashboard (KPIs, modules with health, system checks, connections, settings, audit log), roles, theme editor, layout editor (menu position, content width, menu and panel order, with a live preview), Admins & groups (admins, groups, servers, IP-ban exclusions), Shop (ledger with filters, credits and item grants, catalog import with web sale per module, ShopCore settings). |

---

## 13. Server status

| Source | Gives | Used when |
|---|---|---|
| **Admins heartbeat** — `servers.LastSeenAt` | Whether the server is running: each one reports every minute, so that "panels see which servers are up" (the plugin's own migration note) | Always, and it needs no UDP. Up = reported within 150 s, the 2.5 × heartbeat rule Admins applies to sessions; `0` = never reported since the column was added. |
| **A2S** over UDP to `servers.IP:Port` (or `sp_server_meta.query_host`) | Hostname, map, players, max players, bots; A2S_PLAYER names and durations | Default for live details. The request (`\xFF\xFF\xFF\xFFTSource Engine Query\0`) may be answered with an `S2C_CHALLENGE`; it is then resent with the challenge appended. 1 s timeout, all servers in parallel via `stream_select`, cached 30 s. Skipped while `servers.IP` is still empty. |
| **Admins sessions** | Players with SteamIDs and connect times | Always for the player list (it links to profiles); for counts when UDP is blocked. Hidden admins still appear — as the Admins README warns for websites — so a setting can hide staff from public lists. |
| Last known | Map and counts, "as of" | When A2S fails for a server the heartbeat says is up |

---

## 14. Background work and caching

| Task | Interval | Notes |
|---|---|---|
| A2S refresh | 30 s | Only while someone views a page that shows servers |
| Steam names and avatars | daily | Batches of 100 |
| Item catalog | manual, or weekly | Chunked so each request stays under `max_execution_time` |
| Panel log rotation, expired `sp_sessions` | daily | |
| Leaderboard fragments | 60–300 s cache | All-time ranking is the most expensive query |

**Pseudo-cron**: after the response is flushed (`fastcgi_finish_request()` where available), the
scheduler takes `storage/locks/cron.lock` without blocking and runs whatever is due. Hosts with
cron call `cron.php?key=<secret>` instead and pseudo-cron switches off.

**Cache**: file cache with atomic writes (temp file + `rename`), APCu when loaded; keys namespaced
by module. Plugin data read to make a write decision is always read fresh.

---

## 15. Security

| Threat | Measure |
|---|---|
| SQL injection | Prepared statements only. Identifiers that cannot be parameters (Ranks affixes, sort columns) are whitelisted or validated against `^[A-Za-z0-9_]*$`. |
| XSS | Player names, reasons and name tags are attacker-controlled — escape by default in templates and in JS (the mockups render a player called `<script>alert(1)</script>` as text). Strict CSP: `default-src 'self'`, images also from Steam's CDN, no inline script or style. |
| CSRF | Synchronizer token on every unsafe request; htmx sends it as a header. `SameSite=Lax` cookies. |
| Sign-in forgery | Server-side `check_authentication`, strict `claimed_id` pattern, nonce, same-origin return URLs. |
| Session theft | `HttpOnly`, `Secure` on HTTPS, regenerate on sign-in, idle and absolute timeouts, remember-me tokens stored hashed. |
| Privilege escalation | Permission checked in the route **and** in the action; Admins immunity enforced; WeaponSkins item permissions and shop items' `RequiredPermission` enforced before writing. |
| Double spending | Purchases and gifts take credits in one conditional `UPDATE … AND balance >= :n`; shop item keys change under a row lock that re-checks ownership, so two tabs cannot buy or sell the same item twice; every write is offline-only where a plugin holds the player's state in memory (§8.5, §8.6). |
| Personal data | IP addresses only with `admins.ip.view`, masked otherwise (`88.106.x.x`); sessions only with `admins.sessions.view`; retention follows the plugin's. |
| Secrets | `config.php` outside the document root when possible, otherwise denied and PHP-guarded; one least-privilege database user per connection. |
| Uploads | Images only, MIME sniffed with `finfo`, re-encoded with GD when available, random names, PHP execution disabled in `uploads/`. |
| Brute force and scraping | Rate limits on sign-in, search and A2S-triggering pages. |
| Accountability | Every write — in plugin tables or the panel's — goes to `sp_audit_log` with the before and after. |
| Installer left behind | It locks itself after install; the dashboard warns until `install/` is deleted. |

---

## 16. Install, update, migrate

**Install** — upload, open the site:

1. Requirements: PHP version, extensions (`pdo_mysql`, `mbstring`, `json`, `openssl`, `curl`; optional
   `intl`, `gd`, `apcu`, `pdo_pgsql`, `pdo_sqlite`, `zip`), writable `storage/` and `uploads/`, outbound UDP.
2. Panel database: host, name, user — or SQLite for very small installs.
3. Plugin connections: add them by hand or **paste `database.jsonc`**; each is tested and its plugin tables probed.
4. Community name, owner SteamID64, optional Steam Web API key.
5. Create the panel tables, seed roles and presets, write `config/config.php`, lock the installer.

**Update** — upload the new release over the old one (it never contains `config/`, `storage/` or
`uploads/`). On the next request the panel sees a newer schema version and runs pending
migrations once, under a lock, showing a maintenance page meanwhile. An optional one-click updater
(cURL download, SHA-256 check, `ZipArchive`) can come later; SFTP stays the supported path.

**Module migrations** create `sp_*` tables only. **The panel never runs DDL on a plugin's tables**:
the plugins own their schemas, migrate them themselves, and the panel adapts by probing.

---

## 17. Internationalisation

JSON catalogues per module (`lang/en.json`, `lt.json`, …) with a fallback to English; a missing key
logs once and shows the English string. The default language is a setting; signed-in users pick
their own. Wording follows the plugins' translations (*Unbanned*, *Lifted*, *Before seasons*,
*Highest rank reached*; ShopCore's *Buy*, *Inventory*, *Equipped*, *Unequipped*, *Expired*,
*This item cannot be sold*) so web and game agree. Dates use the panel's time zone with `intl` when
present and a built-in formatter otherwise. Starting set: English and Lithuanian; Portuguese
(Brazil) and Ukrainian follow, as the plugins already ship them.

---

## 18. Quality

| Check | Tooling |
|---|---|
| Parity with the plugins | PHPUnit cases for `Duration` (`Durations.Format`), playtime, K/D, percentages, punishment status, silence grouping, season labels, all-time sums, SteamID conversion, ShopCore's item state (`GetItemState`), sell price (`ResolveSellPrice`) and category paths (`ParseCategoryPath`) |
| Permission rules | PHPUnit: wildcards exactly as SwiftlyS2's, role links, game permission providers |
| Database dialects | Integration tests against MySQL 8, MariaDB 10.6/11, PostgreSQL 16 and SQLite in CI containers, using the plugins' real table shapes |
| Static analysis | PHPStan (level 8), PHP-CS-Fixer |
| Front end | Playwright smoke tests per page and role; the mockups double as visual references |
| Release | GitHub Actions builds the upload-ready ZIP (no dev dependencies) with a SHA-256 |

---

## 19. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **The web host cannot reach the database** (outbound 3306 filtered, or the database only listens locally) | Panel unusable | The installer tests each connection and explains the three working topologies: the database on the game/VPS host allowing the web host's IP; the database on the web host with "Remote MySQL" allowing the game servers; or the panel on the same VPS. |
| SQLite plugin databases | Not reachable remotely | Documented requirement: MySQL/MariaDB (or PostgreSQL) for every module the panel uses. |
| Plugin schema changes | Broken queries | Ledger checks per module, probing optional columns, per-module minimum versions, CI against the plugins' migrations. |
| Writes lost or doubled by in-memory plugin state | Lost edits, double charges or refunds | Read-only Ranks; Economy removals and every ShopCore write only while `player.online` says the player is offline, with 30 s of grace after a disconnect. |
| A server without Admins sessions | The panel thinks a player on it is offline | Documented: every server that shares the Economy and Cookies databases must run Admins with `Sessions.Enabled`; without the Admins module, shop writes are off. |
| ShopCore's catalog lives in memory | The web shows a stale catalog | Imported from the module configs, with a diff; a catalog table written by ShopCore itself is the proper fix (§21). |
| Module purchase hooks the web cannot run | A rule enforced in game is skipped on the web | Web sale per module, off for unknown modules; consumables, Shop_VIP and team-limited items stay in game. |
| Eventual consistency confuses users | Support load | "Applies in game within …" messages after every write. |
| UDP blocked | No live details | Up/down from the Admins heartbeat, players from sessions (§13). |
| The item catalog source changes or disappears | Skin changer degrades | The cached copy keeps working; the source URL is a setting; the format is documented. |
| Performance on small hosts | Slow leaderboards | The indexes the plugins already create (`ix_ranks_players_period_points`, `IX_bans_SteamId64`, `IX_bans_Status_ExpiresAt`, …), paging, fragment caching. |
| Fonts | — | Stratum2 is Valve's; the panel ships OFL fonts only. |
| Trademarks and imagery | — | Item images are hotlinked from Steam's CDN, as community sites do; no Valve assets are redistributed. |

---

## 20. Roadmap

| Phase | Scope | Exit criterion |
|---|---|---|
| 0 · Foundation | Micro-core, installer, Steam sign-in, roles and role links, theme compiler and editor, layout editor, module manager, audit log, design system | Install from a ZIP on a shared host; sign in; edit the theme |
| 1 · Read | Servers, Admins (public bans and comms), Ranks (leaderboards, profile), player profile, search, shop catalog, inventory and history | Public pages live against real plugin data |
| 2 · Write | Admins staff actions and admins/groups editor, WeaponSkins changer and catalog, VIPCore grants, shop purchases, sales and gifts, credit and item adjustments | Staff and players work from the web; changes reach the game |
| 3 · Polish | i18n (lt, pt-BR, uk), Economy leaderboards, accessibility pass, one-click updater, operator wiki | 1.0 release |
| Later | MapChooser map pool, Discord webhooks, optional RCON bridge for instant kicks; on the plugin side, a ShopCore catalog table and an in-game queue for web orders | — |

---

## 21. Open questions

1. **Default accent** — CS2 orange (the mockups' default) or CS2 Blue, the colour CS2 itself uses for the selected tab? Both sit on CS2's slate blue and are presets.
2. **Public visibility** — show admin names on public punishments? Profiles public by default?
3. **Languages for 1.0** — English and Lithuanian only, or also those the plugins ship (pt-BR, uk, fi, zh-CN)?
4. **PostgreSQL** — needed in 1.0, or later?
5. **Staff mapping** — should in-game Admins groups map to web roles by default (as seeded above)?
6. **Ranks ladders** — one leaderboard per table prefix (per server family), or a single combined one?
7. **RCON** — wanted later for instant kicks, given it needs outbound TCP to every game server?
8. **ShopCore catalog** — add a catalog table to ShopCore (every registered item, written on load),
   or keep importing the module configs? The table is more accurate and covers modules the panel
   does not know. The same upstream change could add the ledger index (§8.6).
9. **Buying while playing** — worth an in-game queue for web orders? ShopCore would apply them through
   its own `PurchaseItem`, running every module hook and team check, so players could buy from the
   web while online and consumables could be sold there too.
10. **Credits on profiles** — private to the player and staff (as in the mockups), or public, with a
    "richest players" board?
