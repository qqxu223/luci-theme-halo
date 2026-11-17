'use strict';
'require baseclass';
'require ui';

/*
 * menu-halo — navigation rail, breadcrumb, command palette, theme switch.
 *
 * LuCI's menu tree is a name-keyed map (not arrays); ui.menu.getChildren()
 * gives the ordered, satisfied children. URLs are just the name chain, so
 * L.url('admin','status','overview') is the canonical link form.
 */

var ICONS = {
	/* status */
	'overview': '<path d="M2.6 2.6h4.4v4.4H2.6zM9 2.6h4.4v4.4H9zM2.6 9h4.4v4.4H2.6zM9 9h4.4v4.4H9z"/>',
	'routes': '<path d="M2.6 12.4h4.2a3 3 0 0 0 3-3V6.2"/><path d="M7.6 8.2L9.8 6l2.2 2.2"/>',
	'firewall': '<path d="M8 2.2l5 1.8v4.3c0 2.8-2 4.8-5 5.5-3-.7-5-2.7-5-5.5V4z"/><path d="M6 8l1.5 1.5L10.2 6.8"/>',
	'logs': '<path d="M3.4 2.8h9.2v10.4H3.4z"/><path d="M5.8 5.8h4.4M5.8 8h4.4M5.8 10.2h2.6"/>',
	'processes': '<path d="M5.6 4.4h7.6M5.6 8h7.6M5.6 11.6h7.6"/><circle cx="3" cy="4.4" r=".9"/><circle cx="3" cy="8" r=".9"/><circle cx="3" cy="11.6" r=".9"/>',
	'realtime': '<path d="M1.8 11.4l3.4-4.2 2.6 2.4 3-4.2 3.4 3.4"/>',
	'wireguard': '<path d="M8 2.2l5 1.8v4.3c0 2.8-2 4.8-5 5.5-3-.7-5-2.7-5-5.5V4z"/><circle cx="8" cy="7.2" r="1.5"/><path d="M8 8.7v2.1"/>',

	/* network */
	'network': '<path d="M5.4 2.4v3M10.6 2.4v3"/><path d="M3.6 5.4h8.8v3a4.4 4.4 0 0 1-8.8 0z"/><path d="M8 12.8v1.2"/>',
	'dhcp': '<rect x="2.2" y="3" width="11.6" height="4.2" rx="1.2"/><rect x="2.2" y="8.8" width="11.6" height="4.2" rx="1.2"/>',
	'dns': '<circle cx="8" cy="8" r="5.6"/><path d="M2.4 8h11.2"/><path d="M8 2.4c1.6 1.7 2.4 3.6 2.4 5.6S9.6 11.9 8 13.6C6.4 11.9 5.6 10 5.6 8S6.4 4.1 8 2.4z"/>',
	'diagnostics': '<path d="M2.2 8h2.8l1.6-3.8L9.4 11.4l1.6-3.4h2.8"/>',
	'wireless': '<path d="M2.6 6.2a8 8 0 0 1 10.8 0"/><path d="M4.8 8.6a4.8 4.8 0 0 1 6.4 0"/><circle cx="8" cy="11.6" r="1.2"/>',

	/* system */
	'system': '<rect x="2.2" y="2.8" width="11.6" height="7.4" rx="1.4"/><path d="M5.6 12.8h4.8M8 10.4v2.4"/>',
	'admin': '<circle cx="8" cy="5.8" r="2.6"/><path d="M3 13.4c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>',
	'package-manager': '<path d="M8 2.2l5.4 2.6v6.4L8 13.8 2.6 11.2V4.8z"/><path d="M2.6 4.8L8 7.4l5.4-2.6M8 7.4v6.4"/>',
	'startup': '<path d="M8 2.4v5.2"/><path d="M5.2 4.2a5.2 5.2 0 1 0 5.6 0"/>',
	'crontab': '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.8V8l2.2 1.4"/>',
	'mounts': '<path d="M2.6 5.6h10.8v7H2.6z"/><path d="M2.6 5.6l1.6-2.8h7.6l1.6 2.8"/><path d="M6.2 9h3.6"/>',
	'leds': '<path d="M8 2.4a3.6 3.6 0 0 1 2.1 6.5c-.5.4-.7.9-.7 1.5v.3H6.6v-.3c0-.6-.2-1.1-.7-1.5A3.6 3.6 0 0 1 8 2.4z"/><path d="M6.8 12.8h2.4"/>',
	'flash': '<path d="M8 2.4v6.6"/><path d="M5.2 6.4L8 9.2l2.8-2.8"/><path d="M3 11.4v2h10v-2"/>',
	'reboot': '<path d="M13 8a5 5 0 1 1-1.7-3.8"/><path d="M13.2 2.6v3.4H9.8"/>',
	'cpufreq': '<rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.4"/><path d="M6.6 1.8v2.4M9.4 1.8v2.4M6.6 11.8v2.4M9.4 11.8v2.4M1.8 6.6h2.4M1.8 9.4h2.4M11.8 6.6h2.4M11.8 9.4h2.4"/>',
	'aurora': '<path d="M8 2.2l1.5 4.3 4.3 1.5-4.3 1.5L8 13.8 6.5 9.5 2.2 8l4.3-1.5z"/>',
	'ttyd': '<rect x="1.8" y="3" width="12.4" height="10" rx="1.6"/><path d="M4.4 6.4l2 1.9-2 1.9M8.4 10.4h3.4"/>',

	/* services */
	'openclash': '<path d="M2.6 5.2h6.6l2.4-2.4"/><path d="M9.4 2.8l2.2 0 0 2.2"/><path d="M13.4 10.8H6.8L4.4 13.2"/><path d="M6.6 13.2H4.4v-2.2"/>',
	'lucky': '<circle cx="5.6" cy="5.6" r="2.2"/><circle cx="10.4" cy="5.6" r="2.2"/><circle cx="5.6" cy="10.4" r="2.2"/><circle cx="10.4" cy="10.4" r="2.2"/>',
	'wol': '<path d="M8 2.6v4.8"/><path d="M5.4 4.4a5.4 5.4 0 1 0 5.2 0"/>',
	'gecoosac': '<rect x="4.8" y="9" width="6.4" height="4.2" rx="1.2"/><path d="M2.8 6.6a7.4 7.4 0 0 1 10.4 0"/><path d="M5.2 8.8a4 4 0 0 1 5.6 0"/>',
	'dockerman': '<path d="M2.6 8.2h10.8v3.4a1.4 1.4 0 0 1-1.4 1.4H4a1.4 1.4 0 0 1-1.4-1.4z"/><rect x="3.6" y="4.6" width="2.2" height="2.2" rx=".5"/><rect x="6.6" y="4.6" width="2.2" height="2.2" rx=".5"/><rect x="9.6" y="4.6" width="2.2" height="2.2" rx=".5"/>',
	'uhttpd': '<rect x="2.6" y="2.8" width="10.8" height="3.8" rx="1"/><rect x="2.6" y="9.4" width="10.8" height="3.8" rx="1"/><path d="M5 4.7h.02M5 11.3h.02"/>',
	'upnp': '<circle cx="8" cy="8" r="1.4"/><path d="M5.4 5.4a3.7 3.7 0 0 0 0 5.2M10.6 5.4a3.7 3.7 0 0 1 0 5.2"/><path d="M2.9 2.9a7.2 7.2 0 0 0 0 10.2M13.1 2.9a7.2 7.2 0 0 1 0 10.2"/>',
	'vlmcsd': '<circle cx="5.4" cy="5.4" r="2.6"/><path d="M7.3 7.3l5.4 5.4M10.3 10.3l1.4-1.4M11.9 11.9l1.4-1.4"/>',

	/* other */
	'hostnames': '<path d="M2.6 4.2h10.8v7.4H2.6z"/><path d="M5 7.9h6"/>',
	'timewol': '<circle cx="8" cy="8.8" r="4.4"/><path d="M8 6.4v2.6l1.6 1"/><path d="M3.2 3.8l1.6-1.4M12.8 3.8L11.2 2.4"/>',
	'usb_printer': '<path d="M4.8 6V2.8h6.4V6"/><rect x="2.2" y="6" width="11.6" height="5.2" rx="1.2"/><path d="M4.8 11.2v2.2h6.4v-2.2"/>',
	'vpn': '<path d="M8 2.2l5 1.8v4.3c0 2.8-2 4.8-5 5.5-3-.7-5-2.7-5-5.5V4z"/><path d="M6 8l1.5 1.5L10.2 6.6"/>',
	'services': '<path d="M2.6 5.6l5.4-2.6 5.4 2.6v5.6L8 13.8 2.6 11.2z"/><path d="M8 8.2l5.4-2.6M8 8.2v5.6"/>',
	'logout': '<path d="M6.4 3.2H3.4v9.6h3"/><path d="M9 8h4.6M11.6 5.8L13.8 8l-2.2 2.2"/>'
};

/* Third-party pages (OpenClash, dockerman, ...) ship arbitrary names, so fall
 * back to a keyword match before the neutral service glyph. */
var HINTS = [
	[/nft|firewall/i, 'firewall'],
	[/wire|vpn|vnt|tunnel|clash|proxy/i, 'wireguard'],
	[/syslog|log/i, 'logs'],
	[/route|arp/i, 'routes'],
	[/dhcp|lease/i, 'dhcp'],
	[/dns|host/i, 'dns'],
	[/ping|trace|diag/i, 'diagnostics'],
	[/wifi|wireless|ssid|radio/i, 'wireless'],
	[/cron|time|clock|wake|wol|alarm/i, 'crontab'],
	[/usb|printer|disk|mount|storage|nas/i, 'mounts'],
	[/reboot|power|startup|boot/i, 'startup'],
	[/docker|container/i, 'dockerman'],
	[/user|admin|pass|auth|acl/i, 'admin'],
	[/pkg|package|opkg|plugin/i, 'package-manager'],
	[/term|tty|shell|console/i, 'ttyd'],
	[/cpu|freq|thermal|temp/i, 'cpufreq'],
	[/led/i, 'leds'],
	[/http|web|server/i, 'uhttpd']
];

function iconPath(name) {
	if (ICONS[name]) return ICONS[name];
	for (var i = 0; i < HINTS.length; i++) if (HINTS[i][0].test(name)) return ICONS[HINTS[i][1]];
	return ICONS.services;
}

function ico(name) {
	return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
		iconPath(String(name || '')) + '</svg>';
}

function kids(node) {
	if (!node) return [];
	return ui.menu.getChildren(node).filter(function (c) { return c && c.title != null; });
}

function urlOf(path) {
	return L.url.apply(L, path);
}

function label(node) {
	return _(node.title);
}

/* Flatten leaf pages for the command palette. */
function flatten(tree) {
	var out = [];
	(function walk(node, path, group) {
		kids(node).forEach(function (child) {
			var p = path.concat([child.name]);
			var g = path.length >= 2 ? child.name && group : group;
			if (kids(child).length)
				walk(child, p, path.length === 1 ? child.name : group);
			else
				out.push({
					path: p,
					title: label(child),
					group: group || '',
					href: urlOf(p)
				});
		});
	})(tree, [], '');
	return out;
}

function buildRail(tree) {
	var nav = document.getElementById('halo-nav');
	if (!nav) return null;

	var modes = kids(tree);
	var mode = modes[0];
	if (!mode) return null;

	var dp = L.env.dispatchpath || [];
	var activePath = dp.slice(0, 3).join('/');

	nav.innerHTML = '';

	kids(mode).forEach(function (group) {
		var pages = kids(group);
		if (!pages.length && group.action == null) return;
		var items = pages.length ? pages : [group];
		var g = document.createElement('div');
		g.className = 'halo-nav-group';

		var labelEl = document.createElement('div');
		labelEl.className = 'halo-nav-label';
		labelEl.textContent = label(group);
		g.appendChild(labelEl);

		items.forEach(function (item) {
			var path = pages.length
				? [mode.name, group.name, item.name].join('/')
				: [mode.name, group.name].join('/');

			var a = document.createElement('a');
			a.className = 'halo-nav-item' + (path === activePath ? ' is-active' : '');
			a.href = urlOf(pages.length ? [mode.name, group.name, item.name] : [mode.name, group.name]);
			a.title = label(item);

			var i = document.createElement('span');
			i.className = 'halo-nav-ico';
			i.innerHTML = ico(item.name);
			a.appendChild(i);

			var t = document.createElement('span');
			t.className = 'halo-nav-text';
			t.textContent = label(item);
			a.appendChild(t);

			g.appendChild(a);
		});

		if (g.querySelector('.halo-nav-item')) nav.appendChild(g);
	});

	return { mode: mode, modes: modes, dp: dp };
}

function buildCrumbs(info) {
	var crumb = document.getElementById('halo-crumb');
	var title = document.getElementById('halo-title');
	if (!crumb || !info) return;

	var dp = info.dp;
	var node = info.mode;
	var parts = [];

	dp.slice(1, 3).forEach(function (seg) {
		if (!node) return;
		var child = kids(node).filter(function (c) { return c.name === seg; })[0];
		if (child) {
			if (child.title) parts.push({ title: label(child), name: seg });
			node = child;
		}
	});

	crumb.innerHTML = '';
	parts.forEach(function (p, i) {
		if (i) {
			var sep = document.createElement('span');
			sep.textContent = '/';
			crumb.appendChild(sep);
		}
		if (i === parts.length - 1) {
			var s = document.createElement('span');
			s.textContent = p.title;
			crumb.appendChild(s);
			return;
		}
		var a = document.createElement('a');
		a.textContent = p.title;
		a.href = urlOf([info.mode.name, p.name]);
		crumb.appendChild(a);
	});

	if (parts.length && title) {
		var lastTitle = parts[parts.length - 1].title;
		if (lastTitle) title.textContent = lastTitle;
	}
}

function buildModeMenu(info) {
	var mm = document.getElementById('modemenu');
	if (!mm || !info) return;
	mm.innerHTML = '';
	if (info.modes.length < 2) {
		mm.style.display = 'none';
		return;
	}
	info.modes.forEach(function (m, i) {
		var li = document.createElement('li');
		if (i === 0) li.className = 'active';
		var a = document.createElement('a');
		a.href = urlOf([m.name]);
		a.textContent = label(m);
		li.appendChild(a);
		mm.appendChild(li);
	});
}

function initRailToggle() {
	var btn = document.getElementById('halo-rail-toggle');
	var scrim = document.getElementById('halo-scrim');
	if (!btn) return;

	function narrow() {
		return window.matchMedia('(max-width: 780px)').matches;
	}

	function sync() {
		var t = narrow()
			? '打开菜单'
			: document.body.classList.contains('halo-rail-min')
				? '展开侧栏'
				: '收起侧栏';
		btn.title = t;
		btn.setAttribute('aria-label', t);
	}

	/* restore the collapsed rail chosen last time */
	try {
		if (!narrow() && localStorage.getItem('halo.rail') === 'min')
			document.body.classList.add('halo-rail-min');
	} catch (e) {}
	sync();

	btn.addEventListener('click', function () {
		if (narrow()) {
			var open = document.body.classList.toggle('halo-rail-open');
			document.body.classList.toggle('halo-locked', open);
		}
		else {
			var min = document.body.classList.toggle('halo-rail-min');
			try { localStorage.setItem('halo.rail', min ? 'min' : 'full'); } catch (e) {}
		}
		sync();
	});

	if (scrim) scrim.addEventListener('click', function () {
		document.body.classList.remove('halo-rail-open', 'halo-locked');
	});
}

function initTheme() {
	var btn = document.getElementById('halo-theme-toggle');
	var labelEl = document.getElementById('halo-theme-label');
	if (!btn) return;

	function current() {
		try { return localStorage.getItem('halo.theme') || 'device'; } catch (e) { return 'device'; }
	}

	function apply(mode) {
		var dark = mode === 'dark' ||
			(mode === 'device' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.setAttribute('data-darkmode', String(dark));
		if (labelEl) labelEl.textContent =
			mode === 'dark' ? '浅色模式' : (mode === 'light' ? '跟随系统' : '深色模式');
		try { localStorage.setItem('halo.theme', mode); } catch (e) {}
	}

	apply(current());

	btn.addEventListener('click', function () {
		var order = { device: 'dark', dark: 'light', light: 'device' };
		apply(order[current()] || 'dark');
		document.dispatchEvent(new CustomEvent('halo:theme'));
	});

	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
		if (current() === 'device') apply('device');
	});
}

function initRefresh() {
	var btn = document.getElementById('halo-refresh');
	if (btn) btn.addEventListener('click', function () {
		btn.classList.add('is-spin');
		location.reload();
	});
}

function initCmdk(items) {
	var overlay = document.getElementById('halo-cmdk');
	var input = document.getElementById('halo-cmdk-input');
	var list = document.getElementById('halo-cmdk-list');
	var trigger = document.getElementById('halo-search');
	if (!overlay || !input || !list) return;

	var active = 0, filtered = items;

	function renderList() {
		list.innerHTML = '';
		if (!filtered.length) {
			var empty = document.createElement('div');
			empty.className = 'halo-cmdk-empty';
			empty.textContent = '没有匹配的页面';
			list.appendChild(empty);
			return;
		}
		filtered.slice(0, 40).forEach(function (it, i) {
			var a = document.createElement('a');
			a.className = 'halo-cmdk-item' + (i === active ? ' is-active' : '');
			a.href = it.href;
			var t = document.createElement('span');
			t.className = 'halo-cmdk-title';
			t.textContent = it.title;
			a.appendChild(t);
			var g = document.createElement('span');
			g.className = 'halo-cmdk-group';
			g.textContent = it.group || '';
			a.appendChild(g);
			list.appendChild(a);
		});
		var cur = list.querySelector('.is-active');
		if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
	}

	function open() {
		overlay.hidden = false;
		input.value = '';
		active = 0;
		filtered = items;
		renderList();
		setTimeout(function () { input.focus(); }, 10);
	}

	function close() {
		overlay.hidden = true;
	}

	input.addEventListener('input', function () {
		var q = input.value.trim().toLowerCase();
		filtered = !q ? items : items.filter(function (it) {
			return (it.title || '').toLowerCase().indexOf(q) >= 0 ||
				(it.path || []).join('/').toLowerCase().indexOf(q) >= 0 ||
				(it.group || '').toLowerCase().indexOf(q) >= 0;
		});
		active = 0;
		renderList();
	});

	input.addEventListener('keydown', function (e) {
		if (e.key === 'ArrowDown') { active = Math.min(filtered.length - 1, active + 1); renderList(); e.preventDefault(); }
		else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); renderList(); e.preventDefault(); }
		else if (e.key === 'Enter' && filtered[active]) location.href = filtered[active].href;
		else if (e.key === 'Escape') close();
	});

	overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
	if (trigger) trigger.addEventListener('click', open);

	document.addEventListener('keydown', function (e) {
		if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
			e.preventDefault();
			open();
		}
		else if (e.key === 'Escape' && !overlay.hidden) close();
	});
}

function isOverview() {
	var dp = L.env.dispatchpath || [];
	if (dp.join('/') !== 'admin/status/overview') return false;
	if (/[?&]raw=1/.test(location.search)) return false;
	return true;
}

return baseclass.extend({
	__init__: function () {
		initRailToggle();
		initTheme();
		initRefresh();

		ui.menu.load().then(function (tree) {
			var info = buildRail(tree);
			if (info) {
				buildCrumbs(info);
				buildModeMenu(info);
			}

			initCmdk(flatten(tree));

			/* Deferred: requiring a new module from inside ui.menu's promise chain
			   can be swallowed by LuCI's loader, so hand it to the next task. */
			if (isOverview()) {
				window.setTimeout(function () {
					L.require('halo-live').catch(function (err) {
						console.error('[halo] dashboard failed:', err);
					});
				}, 0);
			}
		});
	}
});
