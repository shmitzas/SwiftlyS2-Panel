/*
 * SwiftlyS2 Panel mockups - shared helpers and layout.
 * Each helper stands in for a server-side one the real panel needs (see docs/POC.md); formatters
 * deliberately reproduce the plugins' own output so web and in-game read the same.
 */
(function () {
  'use strict';

  const D = window.SP_DATA;
  const SP = (window.SP = {});
  SP.data = D;
  SP.now = D.meta.now;

  /* ---------------------------------------------------------------- escaping-by-default templating */
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  SP.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  SP.raw = (s) => new Raw(String(s));
  const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : SP.esc(v));
  /** Interpolations are escaped unless they are themselves html`` / SP.raw(): player names are attacker-controlled. */
  SP.html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));
  SP.mount = (el, content) => { const node = typeof el === 'string' ? document.querySelector(el) : el; if (node) node.innerHTML = part(content); return node; };
  SP.ready = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  SP.param = (name) => new URLSearchParams(location.search).get(name);
  SP.store = {
    get: (k, fallback) => { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  /* ---------------------------------------------------------------- formatters (plugin parity) */
  const nf = {};
  SP.fmt = {
    /** Admins' Durations.Format: the two largest non-zero units - 14d, 1d 6h, 1h 30m, 45s. */
    span(ms) {
      let s = Math.max(0, Math.floor(ms / 1000));
      const d = Math.floor(s / 86400); s -= d * 86400;
      const h = Math.floor(s / 3600); s -= h * 3600;
      const m = Math.floor(s / 60); s -= m * 60;
      const parts = [];
      if (d) parts.push(d + 'd');
      if (h) parts.push(h + 'h');
      if (m) parts.push(m + 'm');
      if (s) parts.push(s + 's');
      return parts.length ? parts.slice(0, 2).join(' ') : '0s';
    },
    /** Ranks' PlaytimeFormatter: 4d 5h 30m, 5h 30m or 30m. */
    playtime(seconds) {
      const t = Math.max(0, Math.floor(seconds));
      const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60);
      return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    },
    num(n, digits = 0) {
      const key = digits;
      nf[key] = nf[key] || new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
      return nf[key].format(n);
    },
    /** Ranks' Percent(): one decimal, 0 on an empty whole. */
    pct(part, whole) { return whole ? Math.round((part * 1000) / whole) / 10 : 0; },
    kd(k, d) { return d === 0 ? k : Math.round((k / d) * 100) / 100; },
    date(ms) {
      return new Intl.DateTimeFormat('sv-SE', { timeZone: D.meta.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms);
    },
    day(ms) { return new Intl.DateTimeFormat('sv-SE', { timeZone: D.meta.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms); },
    ago(ms) { return SP.fmt.span(SP.now - ms) + ' ago'; },
    sqlDate(s) { return Date.parse(s.replace(' ', 'T') + 'Z'); },
  };

  /* ---------------------------------------------------------------- Steam IDs (64-bit: BigInt, never Number) */
  const BASE = 76561197960265728n;
  SP.steam = {
    id2: (sid) => { const a = BigInt(sid) - BASE; return `STEAM_0:${a % 2n}:${a / 2n}`; },
    id3: (sid) => `[U:1:${BigInt(sid) - BASE}]`,
    url: (sid) => `https://steamcommunity.com/profiles/${sid}`,
    /** VIPCore's ToSteamId64: vip_users.account_id holds the 32-bit AccountID for grants VIPCore made, a SteamID64 for older rows. */
    from: (id) => { const n = BigInt(id); return String(n < BASE ? n + BASE : n); },
  };
  SP.vipsOf = (sid) => D.vipcore.vip_users.filter((v) => SP.steam.from(v.account_id) === sid && (v.expires === 0 || v.expires * 1000 > SP.now));

  /* ---------------------------------------------------------------- players, avatars */
  const playersById = new Map(D.players.map((p) => [p.steamId, p]));
  SP.playerName = (sid) => playersById.get(String(sid))?.name ?? 'Unknown';
  SP.hueFor = (sid) => { let h = 7; for (const c of String(sid)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 1 + (h % 9); };
  const initials = (name) => { const m = String(name).match(/[\p{L}\p{N}]/u); return m ? m[0] : '?'; };
  SP.avatar = (name, sid, size = '') => SP.html`<span class="sp-avatar ${size} r-${SP.hueFor(sid)}" aria-hidden="true">${initials(name)}</span>`;
  SP.playerLink = (sid, name, sub = '') =>
    SP.html`<a class="sp-player" href="profile.html?id=${sid}">${SP.avatar(name, sid)}<span class="min-w-0 d-block text-start"><span class="sp-player-name d-block">${name}</span>${sub ? SP.html`<span class="sp-player-sub">${sub}</span>` : ''}</span></a>`;

  /* ---------------------------------------------------------------- servers */
  SP.servers = D.admins.servers;
  const serverByGuid = new Map(SP.servers.map((s) => [s.GUID, s]));
  SP.server = (guid) => serverByGuid.get(guid);
  SP.serverShort = (guid) => (SP.server(guid)?.Hostname ?? 'Unknown server').replace(/^[^|]+\|\s*/, '').replace(/\s*\|.*$/, '');
  SP.mapClass = (map) => (/^awp_/.test(map) ? 'awp' : /^(aim|am)_/.test(map) ? 'aim' : /^surf_/.test(map) ? 'surf' : '');
  SP.mapTitle = (map) => map.replace(/^[a-z]+_/, '').replace(/_/g, ' ');

  /* ---------------------------------------------------------------- Admins plugin rules */
  SP.admins = {
    /** The plugin decides by ExpiresAt; the stored Status only says Lifted vs Expired once it has ended. */
    status(row, now = SP.now) { return row.ExpiresAt === 0 || row.ExpiresAt > now ? 'active' : row.Status === 1 ? 'lifted' : 'expired'; },
    statusPill(row, kind = 'ban') {
      const st = SP.admins.status(row);
      const label = st === 'active' ? 'Active' : st === 'expired' ? 'Expired' : kind === 'ban' ? 'Unbanned' : 'Lifted';
      const tone = st === 'active' ? 'tone-danger' : st === 'lifted' ? 'tone-success' : 'tone-faint';
      return SP.html`<span class="sp-pill ${tone}">${st === 'active' ? SP.raw('<span class="sp-dot"></span>') : ''}${label}</span>`;
    },
    length(row) { return row.Length === 0 ? 'Permanent' : SP.fmt.span(row.Length); },
    /** menu.time.left / ended / lifted_* wording from Admins' translations. */
    timeline(row, kind = 'ban') {
      const st = SP.admins.status(row);
      if (st === 'active') return row.ExpiresAt === 0 ? 'permanent' : `${SP.fmt.span(row.ExpiresAt - SP.now)} left`;
      if (st === 'expired') return `ended ${SP.fmt.span(SP.now - row.ExpiresAt)} ago`;
      const verb = kind === 'ban' ? 'unbanned' : kind === 'mute' ? 'unmuted' : 'ungagged';
      return `${verb} ${SP.fmt.span(SP.now - row.ExpiresAt)} ago`;
    },
    progress(row) {
      if (SP.admins.status(row) !== 'active' || row.ExpiresAt === 0) return null;
      return Math.min(100, Math.max(0, ((SP.now - row.CreatedAt) / (row.ExpiresAt - row.CreatedAt)) * 100));
    },
    scope(row) {
      const global = row.GlobalBan ?? row.GlobalSanction;
      return global
        ? SP.html`<span class="sp-badge tone-gold"><i class="bi bi-globe2"></i>All servers</span>`
        : SP.html`<span class="sp-badge tone-info" title="${SP.server(row.Server)?.Hostname ?? row.Server}"><i class="bi bi-hdd-network"></i>${SP.serverShort(row.Server)}</span>`;
    },
    /** A silence is stored as a gag row and a mute row written together; show them as one. */
    groupComms(rows) {
      const groups = new Map();
      for (const r of rows) {
        const key = [r.SteamId64, r.PlayerIp, r.AdminSteamId64, r.CreatedAt, r.Length, r.Reason, r.Server, r.GlobalSanction, r.SanctionType].join('|');
        if (!groups.has(key)) groups.set(key, { ...r, ids: [], kinds: [] });
        const g = groups.get(key);
        g.ids.push(r.Id);
        g.kinds.push(r.SanctionKind);
        if (r.ExpiresAt > g.ExpiresAt && g.ExpiresAt !== 0) g.ExpiresAt = r.ExpiresAt;
      }
      return [...groups.values()].map((g) => ({ ...g, kind: g.kinds.length > 1 ? 'silence' : g.kinds[0] === 1 ? 'gag' : 'mute' }));
    },
    kindPill(kind) {
      const k = { gag: ['tone-info', 'chat-left-text-fill', 'Gag'], mute: ['tone-t', 'mic-mute-fill', 'Mute'], silence: ['tone-legend', 'volume-mute-fill', 'Silence'] }[kind];
      return SP.html`<span class="sp-pill ${k[0]}"><i class="bi bi-${k[1]}"></i>${k[2]}</span>`;
    },
    typeBadge(row) {
      return (row.BanType ?? row.SanctionType) === 2 ? SP.html`<span class="sp-badge tone-caution">IP</span>` : '';
    },
    maskIp: (ip) => (ip ? ip.replace(/\.\d+\.\d+$/, '.x.x') : '-'),
  };

  /* ---------------------------------------------------------------- Ranks plugin rules */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  SP.ranks = {
    current: D.meta.currentPeriod,
    tier(points, ladder = D.ranks.ladder) { let t = ladder[0]; for (const tier of ladder) if (points >= tier.Points) t = tier; return t; },
    next(points, ladder = D.ranks.ladder) { return ladder.find((t) => t.Points > points) ?? null; },
    /** CS2's Premier bands; the default ladder is those bands verbatim. */
    band: (points) => Math.max(0, Math.min(6, Math.floor(points / 5000))),
    rating(points, size = '') {
      const p = Math.max(0, Math.floor(points));
      const body = p >= 1000 ? SP.html`<b>${Math.floor(p / 1000)}</b><small>,${String(p % 1000).padStart(3, '0')}</small>` : SP.html`<b>${p}</b>`;
      return SP.html`<span class="sp-rating rb-${SP.ranks.band(p)} ${size}" title="${SP.fmt.num(p)} XP">${body}</span>`;
    },
    eloLevel(rating) { let lv = 1; D.ranks.eloLadder.forEach((t, i) => { if (rating >= t.Points) lv = i + 1; }); return lv; },
    levelClass: (lv) => (lv >= 10 ? 'lv-10' : lv >= 8 ? 'lv-8' : lv >= 4 ? 'lv-4' : lv >= 2 ? 'lv-2' : 'lv-1'),
    level(rating, size = '') { const lv = SP.ranks.eloLevel(rating); return SP.html`<span class="sp-level ${SP.ranks.levelClass(lv)} ${size}" style="--lvl:${lv}" title="Level ${lv} · ${SP.fmt.num(rating, 1)}"><span>${lv}</span></span>`; },
    /** menu.period.* wording: a calendar month by name, otherwise its first day. */
    periodLabel(period) {
      if (period === 'all') return 'All time';
      if (period === 0) return 'Before seasons';
      const d = new Date(period * 1000);
      return d.getUTCDate() === 1 && d.getUTCHours() === 0 ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `Season from ${d.toISOString().slice(0, 10)}`;
    },
    /** One row per player for a season, or all time summed the way PlayerStore.Ranking() sums it. */
    rows(period) {
      const cols = ['points', 'kills', 'deaths', 'assists', 'round_wins', 'round_losses', 'match_wins', 'match_losses', 'bombs_planted', 'bombs_defused', 'headshots', 'hits', 'misses', 'playtime'];
      if (period === SP.ranks.current) return D.ranks.ranks_players.filter((r) => r.period === period);
      if (period !== 'all') return [...D.ranks.ranks_players_history, ...D.ranks.ranks_players].filter((r) => r.period === period);
      const start = D.meta.startPoints;
      const sums = new Map();
      for (const r of [...D.ranks.ranks_players_history, ...D.ranks.ranks_players]) {
        const acc = sums.get(r.steam_id) ?? { steam_id: r.steam_id, name: r.name, ...Object.fromEntries(cols.map((c) => [c, 0])) };
        for (const c of cols) acc[c] += c === 'points' ? r.points - start : r[c];
        sums.set(r.steam_id, acc);
      }
      return [...sums.values()].map((r) => ({ ...r, points: r.points + start }));
    },
    sorted(period, col = 'points') { return SP.ranks.rows(period).slice().sort((a, b) => b[col] - a[col] || (a.steam_id < b.steam_id ? -1 : 1)); },
    position(sid, period, col = 'points') {
      const rows = SP.ranks.rows(period);
      const own = rows.find((r) => r.steam_id === sid);
      return own ? 1 + rows.filter((r) => r[col] > own[col]).length : 0;
    },
    prestige(points) { let lvl = null; for (const l of D.ranks.prestige) if (points >= l.MinimumPoints) lvl = l; return lvl; },
  };

  /* ---------------------------------------------------------------- catalog (WeaponSkins) */
  const RARITY_BY_COLOR = { '#b0c3d9': 1, '#5e98d9': 2, '#4b69ff': 3, '#8847ff': 4, '#d32ce6': 5, '#eb4b4b': 6, '#e4ae39': 7, '#cf6a32': 8, '#ffd700': 9, '#4c9952': 10 };
  const allItems = [...D.catalog.weapons, ...D.catalog.knives, ...D.catalog.gloves];
  SP.cat = {
    item: (defindex) => allItems.find((w) => w.defindex === Number(defindex)),
    paint: (classname, paint) => (D.catalog.paintkits[classname] ?? []).find((p) => p.paint === Number(paint)),
    rarity: (color) => RARITY_BY_COLOR[String(color).toLowerCase()] ?? 1,
    /** The five exteriors at 0.07 / 0.15 / 0.38 / 0.45. */
    exterior(f) { return f < 0.07 ? ['FN', 'Factory New'] : f < 0.15 ? ['MW', 'Minimal Wear'] : f < 0.38 ? ['FT', 'Field-Tested'] : f < 0.45 ? ['WW', 'Well-Worn'] : ['BS', 'Battle-Scarred']; },
    categories: [['rifles', 'Rifles'], ['pistols', 'Pistols'], ['smgs', 'SMGs'], ['shotguns', 'Shotguns'], ['snipers', 'Snipers'], ['heavy', 'Heavy'], ['other', 'Other']],
  };
  SP.ws = {
    /** wp_player_* rows for one team, resolved against the catalog. */
    loadout(team, sid = D.meta.featured) {
      const W = D.weaponskins;
      const skins = W.wp_player_skins.filter((r) => r.steamid === sid && r.weapon_team === team);
      const knife = W.wp_player_knife.find((r) => r.steamid === sid && r.weapon_team === team);
      const glove = W.wp_player_gloves.find((r) => r.steamid === sid && r.weapon_team === team);
      const out = [];
      for (const row of skins) {
        const item = SP.cat.item(row.weapon_defindex);
        if (!item) continue;
        const isKnife = knife && item.classname === knife.knife;
        const isGlove = glove && item.defindex === glove.weapon_defindex;
        if (D.catalog.knives.includes(item) && !isKnife) continue;
        if (D.catalog.gloves.includes(item) && !isGlove) continue;
        out.push({ row, item, paint: SP.cat.paint(item.classname, row.weapon_paint_id), slot: isKnife ? 'knife' : isGlove ? 'gloves' : item.category });
      }
      const order = { knife: 0, gloves: 1, rifles: 2, snipers: 3, pistols: 4, smgs: 5, shotguns: 6, heavy: 7, other: 8 };
      return out.sort((a, b) => order[a.slot] - order[b.slot]);
    },
    sticker(code) { const [id] = String(code).split(';'); return Number(id) ? D.catalog.stickers.find((s) => s.defindex === Number(id)) ?? { name: `Sticker #${id}`, defindex: Number(id) } : null; },
  };

  /* ---------------------------------------------------------------- viewers, roles, permissions */
  SP.viewers = {
    guest: { label: 'Guest (signed out)', steamId: null },
    player: { label: 'Player · ŽaibasLT (VIP GOLD)', steamId: D.meta.featured },
    novip: { label: 'Player · kebab_enjoyer (no VIP)', steamId: D.players.find((p) => p.name === 'kebab_enjoyer').steamId },
    staff: { label: 'Staff · Kpt. Vėjas (Owner)', steamId: D.meta.viewer },
  };
  SP.viewerId = SP.store.get('sp-viewer', 'player');
  if (!SP.viewers[SP.viewerId]) SP.viewerId = 'player';
  SP.viewer = SP.viewers[SP.viewerId];

  /** SwiftlyS2's rule: an exact key, or a key ending in .* granting everything under that prefix; * grants all. */
  SP.permMatch = (granted, wanted) =>
    granted === '*' || granted === wanted || (granted.endsWith('.*') && wanted.startsWith(granted.slice(0, -1)));
  SP.hasAny = (list, wanted) => list.some((g) => SP.permMatch(g, wanted));

  /** Role links resolved the way the panel will: Admins groups, VIPCore groups, explicit SteamIDs, signed-in. */
  SP.rolesFor = (sid) => {
    const roles = D.panel.roles;
    if (!sid) return roles.filter((r) => r.links.some((l) => l.source === 'anonymous'));
    const admin = D.admins.admins.find((a) => a.SteamId64 === sid);
    const vips = SP.vipsOf(sid);
    return roles.filter((r) => r.links.some((l) =>
      (l.source === 'authenticated') ||
      (l.source === 'steamid' && l.value === sid) ||
      (l.source === 'admins.group' && admin && admin.Groups.includes(l.value)) ||
      (l.source === 'vipcore.group' && vips.some((v) => v.group === l.value))));
  };
  SP.permissionsFor = (sid) => [...new Set(SP.rolesFor(sid).flatMap((r) => r.permissions))];
  /** In-game permission strings for WeaponSkins' ItemPermissions: Admins rows + groups, plus roles' game permissions. */
  SP.gamePermissionsFor = (sid) => {
    if (!sid) return [];
    const admin = D.admins.admins.find((a) => a.SteamId64 === sid);
    const fromAdmins = admin ? [...admin.Permissions, ...D.admins.groups.filter((g) => admin.Groups.includes(g.Name)).flatMap((g) => g.Permissions)] : [];
    const fromRoles = SP.rolesFor(sid).flatMap((r) => r.gamePermissions ?? []);
    return [...new Set([...fromAdmins, ...fromRoles])];
  };
  SP.can = (perm) => SP.hasAny(SP.permissionsFor(SP.viewer.steamId), perm);
  SP.canGame = (perm) => !perm || SP.hasAny(SP.gamePermissionsFor(SP.viewer.steamId), perm);
  SP.isStaff = () => SP.can('panel.settings') || SP.can('admins.bans.create');

  /* ---------------------------------------------------------------- modules (enable/disable drives nav and sections) */
  SP.modules = {
    enabled(id) { const o = SP.store.get('sp-modules', {}); return id in o ? o[id] : D.panel.modules.find((m) => m.id === id)?.enabled ?? true; },
    set(id, on) { const o = SP.store.get('sp-modules', {}); o[id] = on; SP.store.set('sp-modules', o); },
  };

  /* ---------------------------------------------------------------- ShopCore (shop module) */
  const S = D.shop;
  const shopItems = new Map(S.sp_shop_items.map((i) => [i.item_id.toLowerCase(), i]));
  const MODULE_ICON = { Shop_Healthshot: 'heart-pulse-fill', Shop_DecoyTeleport: 'geo-alt-fill', Shop_SmokeColor: 'cloud-fog2-fill',
    Shop_Tracers: 'lightning-charge-fill', Shop_PlayerColor: 'person-fill', Shop_PlayerModels: 'person-bounding-box', Shop_Killscreen: 'bullseye',
    Shop_HitSounds: 'volume-up-fill', Shop_Bhop: 'rocket-takeoff-fill', Shop_Parachute: 'umbrella-fill', Shop_Flags: 'flag-fill', Shop_VIP: 'gem',
    Shop_CustomWeapon: 'crosshair' };
  SP.shop = {
    config: S.config,
    items: S.sp_shop_items,
    item: (id) => shopItems.get(String(id).toLowerCase()),
    icon: (item) => MODULE_ICON[item.module] ?? 'box-seam-fill',
    /** ShopCore's ParseCategoryPath: the first segment is the category, the rest joined is the subcategory. */
    path(item) {
      const seg = String(item.category).split(/[/>]/).map((s) => s.trim()).filter(Boolean);
      return seg.length ? [seg[0], seg.length > 1 ? seg.slice(1).join(' / ') : null] : ['Misc', null];
    },
    cookieRow(sid) { return S.PlayerCookies.filter((r) => r.SteamId64 === sid).sort((a, b) => a.Id - b.Id)[0]; },
    cookies(sid) { const row = SP.shop.cookieRow(sid); try { return row ? JSON.parse(row.Data) : {}; } catch { return {}; } },
    /** GetItemState's rule: owned until its stored expiry passes, equipped only while owned. "owned": false keys mean nothing. */
    state(sid, item) {
      if (!sid || !item.is_equipable || item.type === 'Consumable') return { tracked: false, owned: false, enabled: false, expireAt: null };
      const c = SP.shop.cookies(sid);
      const id = item.item_id.toLowerCase();
      const ownedKey = c[`shopcore:item:owned:${id}`] === true;
      const enabledKey = c[`shopcore:item:enabled:${id}`] === true;
      const expireAt = Number(c[`shopcore:item:expireat:${id}`] ?? 0) || null;
      const stored = ownedKey || enabledKey; // legacy data stored only "enabled"
      const expired = stored && expireAt !== null && expireAt * 1000 <= SP.now;
      const owned = stored && !expired;
      return { tracked: true, owned, enabled: owned && enabledKey, expireAt, expired, unstarted: owned && item.duration_seconds > 0 && !expireAt };
    },
    owned(sid) { return S.sp_shop_items.map((item) => ({ item, st: SP.shop.state(sid, item) })).filter((x) => x.st.owned || x.st.expired); },
    credits(sid) { return D.economy.balance.find((b) => b.steam_id === sid && b.wallet_kind === S.config.WalletName)?.balance ?? 0; },
    /** ResolveSellPrice: the item's SellPrice, else Price × DefaultSellRefundRatio rounded away from zero. */
    sellPrice(item) { return item.sell_price ?? Math.round(item.price * S.config.Behavior.DefaultSellRefundRatio); },
    /** From Admins' sessions. A disconnect in the last 30 s still counts, so the plugins' saves on the way out land first. */
    presence(sid) {
      const rows = D.admins.player_sessions.filter((x) => x.SteamId64 === sid).sort((a, b) => b.LastSeenAt - a.LastSeenAt);
      const live = rows.find((x) => x.DisconnectedAt === 0 && SP.now - x.LastSeenAt <= 150_000);
      if (live) return { online: true, server: live.Server };
      const leaving = rows.find((x) => x.DisconnectedAt && SP.now - x.DisconnectedAt < 30_000);
      return leaving ? { online: true, server: leaving.Server } : { online: false, lastSeen: rows[0]?.DisconnectedAt || null };
    },
    /** [allowed, reason] for a web purchase; the first failing rule is the reason shown. */
    canBuy(sid, item) {
      if (!item.enabled) return [false, 'Disabled on the server'];
      if (item.module === 'Shop_VIP') return [false, 'In game only: VIPCore grants it there'];
      if (!item.is_equipable || item.type === 'Consumable') return [false, 'In game only: it takes effect when bought'];
      if (item.team !== 'Any') return [false, `${item.team} only: bought in game, where ShopCore checks your team`];
      if (!S.webSale[item.module]) return [false, 'Sold in game only'];
      if (!sid) return [false, 'Sign in to buy'];
      if (item.required_permission && !SP.hasAny(SP.gamePermissionsFor(sid), item.required_permission)) return [false, `Needs ${item.required_permission}`];
      if (SP.shop.state(sid, item).owned) return [false, 'Owned'];
      if (SP.shop.presence(sid).online) return [false, 'Leave the server to buy here'];
      const short = item.price - SP.shop.credits(sid);
      if (short > 0) return [false, `${SP.fmt.num(short)} credits short`];
      return [true, ''];
    },
    canSell(sid, item) {
      if (!SP.shop.state(sid, item).owned) return [false, 'Not owned'];
      if (!S.config.Behavior.AllowSelling) return [false, 'Selling is disabled'];
      if (!item.can_be_sold) return [false, 'This item cannot be sold'];
      if (SP.shop.presence(sid).online) return [false, 'Leave the server to sell here'];
      return [true, ''];
    },
    /** The game's image when the item has one; otherwise its colour, if it is a colour item, under the module's icon. */
    art(item, size = '') {
      if (item.image) return SP.html`<img src="${item.image}" alt="" loading="lazy">`;
      const c = item.extra.Color;
      const mod = c === 'Rainbow' || c === 'Random' ? 'multi' : c === 'Team' ? 'team' : '';
      // Named colours are .NET's (System.Drawing.Color.FromName), which CSS shares.
      const hue = Array.isArray(c) ? `rgb(${c.join(',')})` : c && !mod ? c.toLowerCase() : null;
      return SP.html`<span class="sp-art ${mod} ${size}" ${hue ? SP.raw(`style="--c:${SP.esc(hue)}"`) : ''}><i class="bi bi-${SP.shop.icon(item)}"></i></span>`;
    },
    duration(seconds) { return seconds ? SP.fmt.span(seconds * 1000) : 'Permanent'; },
    ledger(sid) { return S.shopcore_ledger.filter((r) => !sid || r.SteamId === sid).sort((a, b) => b.TimestampUnixSeconds - a.TimestampUnixSeconds || b.Id - a.Id); },
    actionLabel: { purchase: 'Purchase', sell: 'Sale', credits_add: 'Credits added', credits_subtract: 'Credits removed' },
    /** Credits a row moved, signed from the player's side. */
    delta(row) { return ['credits_add', 'sell'].includes(row.Action) ? row.Amount : -row.Amount; },
  };

  /* ---------------------------------------------------------------- theme */
  // Each preset carries a whole surface family, so switching presets never leaves the previous one's surfaces behind.
  const SLATE = { '--sp-bg': '#131d27', '--sp-surface': '#0f1720', '--sp-surface-raised': '#172230', '--sp-surface-row': '#1d2936', '--sp-surface-hover': '#263649',
    '--sp-edge': '#2e3d4e', '--sp-tile': '#1e2a38', '--sp-tile-deep': '#19232f', '--sp-tile-hover': '#27364a' };
  const INK = { '--sp-bg': '#08090a', '--sp-surface': '#0b0e13', '--sp-surface-raised': '#141a24', '--sp-surface-row': '#161d27', '--sp-surface-hover': '#222c3a',
    '--sp-edge': '#2a3443', '--sp-tile': '#1c2431', '--sp-tile-deep': '#0f141b', '--sp-tile-hover': '#283346' };
  SP.theme = {
    presets: {
      cs2: { label: 'CS2', note: 'CS2 menu slate, Counter-Strike orange', tokens: { ...SLATE, '--sp-accent': '#f0953a', '--sp-accent-strong': '#ffbd7a' } },
      cs2blue: { label: 'CS2 Blue', note: "CS2's own selected-tab blue", tokens: { ...SLATE, '--sp-accent': '#82d8ff', '--sp-accent-strong': '#bde9ff' } },
      locker: { label: 'CS2 Locker', note: 'CustomHUD default orange', tokens: { ...INK, '--sp-bg': '#090b0f', '--sp-accent': '#ff8a1f', '--sp-accent-strong': '#ffb066' } },
      swiftly: { label: 'SwiftlyS2', note: 'SwiftlyS2 site cyan', tokens: { ...INK, '--sp-accent': '#00feed', '--sp-accent-strong': '#8ffff6' } },
      pink: { label: 'Pink', note: "CustomHUD's documented alternative", tokens: { ...SLATE, '--sp-accent': '#f8a8d8', '--sp-accent-strong': '#ffc4e6' } },
      emerald: { label: 'Emerald', note: '', tokens: { ...SLATE, '--sp-accent': '#3fdc8a', '--sp-accent-strong': '#8af0bd' } },
      crimson: { label: 'Crimson', note: '', tokens: { ...SLATE, '--sp-accent': '#ff4655', '--sp-accent-strong': '#ff8a94' } },
    },
    hexToRgb(hex) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; },
    luminance(hex) { return SP.theme.hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); },
    contrast(a, b) { const [x, y] = [SP.theme.luminance(a), SP.theme.luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); },
    /** What the server-side compiler does: write the tokens, then derive ink-on-accent by contrast. */
    apply(tokens) {
      const root = document.documentElement;
      for (const [k, v] of Object.entries(tokens)) if (k.startsWith('--')) root.style.setProperty(k, v);
      const accent = tokens['--sp-accent'] ?? getComputedStyle(root).getPropertyValue('--sp-accent').trim();
      if (/^#[0-9a-f]{3,8}$/i.test(accent)) {
        root.style.setProperty('--sp-on-accent', SP.theme.contrast(accent, '#10171f') >= SP.theme.contrast(accent, '#ffffff') ? '#10171f' : '#ffffff');
        root.style.setProperty('--bs-primary', accent);
        root.style.setProperty('--bs-primary-rgb', SP.theme.hexToRgb(accent).join(','));
      }
    },
    /** A named preset is re-read from its definition, so a stored choice picks up later changes to it; only 'custom' keeps its own tokens. */
    current() {
      const s = SP.store.get('sp-theme', null);
      if (s?.preset === 'custom') return s;
      const id = SP.theme.presets[s?.preset] ? s.preset : 'cs2';
      return { preset: id, tokens: SP.theme.presets[id].tokens };
    },
    save(state) { SP.store.set('sp-theme', state); SP.theme.apply(state.tokens); },
  };
  SP.theme.apply(SP.theme.current().tokens);

  /* ---------------------------------------------------------------- layout */
  SP.logo = SP.raw(`<svg class="sp-brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--sp-accent)" opacity=".16"/>
      <circle cx="16" cy="16" r="7" fill="none" stroke="var(--sp-accent)" stroke-width="2.4"/>
      <path d="M16 4.5v5M16 22.5v5M4.5 16h5M22.5 16h5" stroke="var(--sp-accent)" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="16" cy="16" r="1.7" fill="var(--sp-accent)"/></svg>`);

  SP.nav = [
    { id: 'home', href: 'landing.html', icon: 'house-door-fill', label: 'Home' },
    { id: 'servers', module: 'servers', href: 'servers.html', icon: 'hdd-stack-fill', label: 'Servers' },
    { id: 'ranks', module: 'ranks', href: 'leaderboard.html', icon: 'trophy-fill', label: 'Leaderboard' },
    { id: 'punishments', module: 'admins', href: 'punishments.html', icon: 'hammer', label: 'Punishments' },
    { id: 'shop', module: 'shop', href: 'shop.html', icon: 'bag-fill', label: 'Shop' },
    { id: 'skins', module: 'weaponskins', href: 'skins.html', icon: 'crosshair', label: 'Skins', auth: true },
  ];

  function topbar(active) {
    const items = SP.nav.filter((n) => !n.module || SP.modules.enabled(n.module)).filter((n) => !n.auth || SP.viewer.steamId);
    const v = SP.viewer;
    const roles = SP.rolesFor(v.steamId).sort((a, b) => b.weight - a.weight);
    const top = roles[0];
    const user = v.steamId
      ? SP.html`<div class="dropdown">
          <a class="sp-user" href="#" data-bs-toggle="dropdown" aria-expanded="false">
            ${SP.avatar(SP.playerName(v.steamId), v.steamId)}
            <span class="d-none d-md-block text-start"><span class="sp-user-name d-block">${SP.playerName(v.steamId)}</span>
              <span class="sp-user-role" style="color:${top?.color ?? 'inherit'}">${top?.name ?? ''}</span></span>
            <i class="bi bi-chevron-down text-faint small"></i></a>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><h6 class="dropdown-header">Signed in through Steam</h6></li>
            <li><a class="dropdown-item" href="profile.html?id=${v.steamId}"><i class="bi bi-person-vcard me-2"></i>My profile</a></li>
            ${SP.modules.enabled('weaponskins') ? SP.html`<li><a class="dropdown-item" href="skins.html"><i class="bi bi-crosshair me-2"></i>My skins</a></li>` : ''}
            ${SP.modules.enabled('shop') ? SP.html`<li><a class="dropdown-item d-flex align-items-center" href="shop.html#inventory"><i class="bi bi-bag-fill me-2"></i>My inventory
              <span class="ms-auto ps-3 text-gold sp-display"><i class="bi bi-coin me-1"></i>${SP.fmt.num(SP.shop.credits(v.steamId))}</span></a></li>` : ''}
            ${SP.isStaff() ? SP.html`<li><a class="dropdown-item" href="admin.html"><i class="bi bi-shield-lock-fill me-2"></i>Admin area</a></li>` : ''}
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="#" data-viewer="guest"><i class="bi bi-box-arrow-right me-2"></i>Sign out</a></li>
          </ul></div>`
      : SP.html`<a class="btn btn-steam btn-sm" href="#" data-viewer="player"><i class="bi bi-steam me-1"></i> Sign in through Steam</a>`;
    return SP.html`<header class="sp-topbar"><div class="sp-container sp-topbar-inner">
      <a class="sp-brand" href="landing.html">${SP.logo}<span class="lh-1"><span class="sp-brand-name d-block">${D.meta.community}</span><span class="sp-brand-sub">CS2 community</span></span></a>
      <nav aria-label="Main"><ul class="sp-nav">
        ${items.map((n) => SP.html`<li><a class="sp-navlink ${n.id === active ? 'active' : ''}" href="${n.href}"><i class="bi bi-${n.icon}"></i><span class="label">${n.label}</span></a></li>`)}
        ${SP.isStaff() ? SP.html`<li><a class="sp-navlink ${active === 'admin' ? 'active' : ''}" href="admin.html"><i class="bi bi-shield-lock-fill"></i><span class="label">Admin</span></a></li>` : ''}
      </ul></nav>
      <div class="ms-auto d-flex align-items-center gap-2">
        <form class="sp-search" role="search" action="profile.html"><i class="bi bi-search"></i><input class="form-control" name="q" placeholder="Player name or SteamID" aria-label="Search players"></form>
        ${user}
      </div></div></header>`;
  }

  function footer() {
    const mods = D.panel.modules.filter((m) => SP.modules.enabled(m.id)).map((m) => m.name).join(' · ');
    return SP.html`<footer class="sp-footer"><div class="sp-container py-4 d-flex flex-wrap gap-3 justify-content-between align-items-center">
      <div class="d-flex align-items-center gap-2">${SP.logo}<span>Powered by <a href="index.html">SwiftlyS2 Panel</a> <span class="text-faint">· mockup v0.1</span></span></div>
      <div class="text-faint">Modules: ${mods}</div>
      <div class="d-flex gap-3"><a href="#"><i class="bi bi-discord me-1"></i>Discord</a><a href="#">Rules</a><a href="#">Privacy</a></div>
    </div></footer>`;
  }

  function mockBar() {
    const t = SP.theme.current();
    return SP.html`<div class="mock-bar" role="region" aria-label="Mockup controls">
      <b>Mockup</b>
      <label class="d-flex align-items-center gap-1">View as
        <select data-mock="viewer">${Object.entries(SP.viewers).map(([id, v]) => SP.html`<option value="${id}" ${id === SP.viewerId ? 'selected' : ''}>${v.label}</option>`)}</select></label>
      <label class="d-flex align-items-center gap-1">Theme
        <select data-mock="theme">${Object.entries(SP.theme.presets).map(([id, p]) => SP.html`<option value="${id}" ${id === t.preset ? 'selected' : ''}>${p.label}</option>`)}${t.preset === 'custom' ? SP.html`<option value="custom" selected>Custom</option>` : ''}</select></label>
      <a href="index.html">All pages</a>
    </div>`;
  }

  SP.toast = (title, message, tone = 'tone-accent') => {
    let stack = document.querySelector('.sp-toast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'sp-toast-stack'; document.body.append(stack); }
    const el = document.createElement('div');
    el.className = `sp-toast ${tone}`;
    el.innerHTML = part(SP.html`<div class="sp-toast-title">${title}</div><div>${message}</div>`);
    stack.append(el);
    setTimeout(() => el.remove(), 4200);
  };
  SP.tips = (root = document) => { if (window.bootstrap) root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => bootstrap.Tooltip.getOrCreateInstance(el)); };

  /* ---------------------------------------------------------------- admin area */
  SP.adminNav = (active) => {
    const item = (id, href, icon, label, perm, module) => (module && !SP.modules.enabled(module)) ? '' :
      SP.html`<a class="sp-side-item ${id === active ? 'active' : ''} ${perm && !SP.can(perm) ? 'locked' : ''}" href="${href}"><i class="bi bi-${icon}"></i>${label}</a>`;
    return SP.html`
      ${item('dashboard', 'admin.html', 'speedometer2', 'Dashboard')}
      ${item('modules', 'admin.html#modules', 'puzzle-fill', 'Modules', 'panel.modules')}
      ${item('roles', 'admin-roles.html', 'person-badge', 'Roles', 'panel.roles')}
      ${item('theme', 'admin-theme.html', 'palette-fill', 'Theme', 'panel.theme')}
      ${item('settings', 'admin.html#settings', 'gear-fill', 'Settings', 'panel.settings')}
      ${item('audit', 'admin.html#audit', 'journal-text', 'Audit log', 'panel.audit')}
      <div class="sp-side-label">Modules</div>
      ${item('admins', 'admin-admins.html', 'shield-lock-fill', 'Admins & groups', 'admins.admins.manage', 'admins')}
      ${item('ws', 'admin-roles.html#itemperms', 'crosshair', 'Item permissions', 'weaponskins.manage', 'weaponskins')}
      ${item('ranks', 'admin.html#modules', 'trophy-fill', 'Ranks ladder', 'ranks.settings', 'ranks')}
      ${item('vip', 'admin.html#modules', 'gem', 'VIP users', 'vipcore.manage', 'vipcore')}
      ${item('shop', 'admin-shop.html', 'bag-fill', 'Shop', 'shop.ledger.view', 'shop')}`;
  };
  /** The panel answers 403 server-side; the mockup shows what that page says. */
  SP.adminGate = (perm) => {
    if (SP.can(perm)) return null;
    return SP.html`<section class="sp-shell"><div class="sp-shell-body"><div class="sp-empty"><i class="bi bi-shield-lock-fill"></i>
      <div class="sp-display fs-4 text-body mb-2">You do not have permission for that</div>
      <p class="mb-3">This page needs <span class="mono">${perm}</span>. Signed in as ${SP.viewer.steamId ? SP.playerName(SP.viewer.steamId) : 'a guest'}.</p>
      <a class="btn btn-primary" href="#" data-viewer="staff">Mockup: view as staff</a></div></div></section>`;
  };

  SP.layout = (active) => {
    SP.ready(() => {
      const top = document.getElementById('sp-top');
      const foot = document.getElementById('sp-foot');
      if (top) top.outerHTML = part(topbar(active));
      if (foot) foot.outerHTML = part(footer());
      document.body.insertAdjacentHTML('beforeend', part(mockBar()));
      SP.tips();
    });
  };

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.mock === 'viewer') { SP.store.set('sp-viewer', t.value); location.reload(); }
    if (t.dataset.mock === 'theme' && SP.theme.presets[t.value]) { SP.theme.save({ preset: t.value, tokens: SP.theme.presets[t.value].tokens }); location.reload(); }
  });
  document.addEventListener('click', (e) => {
    const v = e.target.closest('[data-viewer]');
    if (v) { e.preventDefault(); SP.store.set('sp-viewer', v.dataset.viewer); location.reload(); }
    const c = e.target.closest('[data-copy]');
    if (c) { e.preventDefault(); navigator.clipboard?.writeText(c.dataset.copy); SP.toast('Copied', c.dataset.copy, 'tone-info'); }
  });
})();
