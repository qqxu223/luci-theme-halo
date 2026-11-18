'use strict';
'require baseclass';
'require rpc';

/*
 * halo-live — collects router state over ubus and feeds the dashboard.
 *
 * RPC surface (LuCI 25.12 / rpcd ACL):
 *   network.interface.<name>/status is denied to the session,
 *   network.interface/dump and luci-rpc/* are allowed — so everything
 *   interface-related is derived from the dump.
 *
 * ---------------------------------------------------------------------------
 * SAFETY CONTRACT — read before changing the polling code.
 *
 * A dashboard that hammers ubus can wedge uhttpd: it runs one epoll loop, so a
 * burst of slow CGI/ubus calls piles up until the accept queue stops draining
 * and the whole web UI goes dark (this actually happened once). Every rule below
 * exists to make that impossible:
 *
 *   1. SINGLE FLIGHT — a tick never starts while another is running.
 *   2. PER-CALL TIMEOUT — no promise is ever awaited forever.
 *   3. INFLIGHT CAP — if abandoned calls have not settled, stop issuing new ones
 *      until they drain. Prevents "zombie request" accumulation.
 *   4. ADAPTIVE BACKOFF — consecutive failures stretch the interval 5→10→20→40→60 s
 *      instead of retrying at full rate.
 *   5. VISIBILITY PAUSE — a hidden tab does zero network work. Closing the tab
 *      stops it entirely; there is no unattended polling.
 *   6. THREE CLOCKS — counters every 5 s, per-host traffic every 10 s, DHCP
 *      leases and host hints every 30 s, each on its own timer.
 *
 * 7. NO BROWSER-SIDE CONNTRACK DUMP — see the talker note below.
 *
 * PER-HOST TRAFFIC DOES NOT COME FROM luci/getConntrackList. That RPC walks the
 * whole nf_conntrack table and serialises every entry; on a busy router (this
 * one runs 3-13k entries) one call took >30 s and took rpcd down with it, which
 * dropped *every* LuCI session — every browser got kicked back to the login
 * page, over and over. The RPC has no filter parameters, so there is no cheap
 * variant of it.
 *
 * Instead the theme ships a small rpcd plugin (`luci.halo`, see
 * root/usr/share/rpcd/ucode/luci.halo). It reads the table once with a single
 * large buffered read (at most three passes, hard caps) and returns only the
 * per-host byte counters — a few hundred bytes over the bus instead of
 * megabytes. The browser turns successive cumulative counters into rates.
 * Sampled every 12 s at best, never on the 5 s chart clock: one sample costs a
 * full table walk — measured 0.07 s on a 1.6k entry table, 3.4 s on a 16k one —
 * and a ranking does not need to be fresher than that. The interval stretches
 * with the measured cost so the sampler never owns more than ~15% of rpcd.
 * ---------------------------------------------------------------------------
 */

/* NB: an expect of {} makes rpc return the array itself, not the wrapper. */
var callDump = rpc.declare({ object: 'network.interface', method: 'dump', expect: {} });
var callNetDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: {} });
var callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', params: ['family'], expect: {} });
var callHints = rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: {} });
var callSysInfo = rpc.declare({ object: 'system', method: 'info', expect: {} });
var callBoard = rpc.declare({ object: 'system', method: 'board', expect: {} });
var callCPU = rpc.declare({ object: 'luci', method: 'getCPUUsage', expect: {} });
var callTemp = rpc.declare({ object: 'luci', method: 'getTempInfo', expect: {} });
var callTalkers = rpc.declare({ object: 'luci.halo', method: 'talkers', params: ['lan'], expect: {} });

var STEP = 5;                 /* fast tick, seconds */
var TALK = 12;                /* per-host traffic sample, seconds */
var SLOW = 30;                /* leases / host hints, seconds */
var POINTS = 60;              /* 60 x 5 s = 5 min of history */
var RPC_TIMEOUT = 6000;
var INFLIGHT_CAP = 3;
var BACKOFF = [5, 10, 20, 40, 60];

var S = {
	history: { rx: [], tx: [], t: [] },
	prev: null,
	prevT: 0,

	/* per-host traffic: previous cumulative counters, current rates */
	talkSampled: false,
	talkRates: {},
	talkWindow: 0,
	talkMs: 0,
	talkFails: 0,
	talkOff: false,

	clients: [],
	root: null,
	board: {},
	leases: {},
	hints: {},
	lanBase: '192.168.2',
	lanSelf: null,

	/* scheduler state */
	heartbeat: null,
	nextAt: 0,
	talkNextAt: 0,
	slowNextAt: 0,
	busy: false,
	talkBusy: false,
	slowBusy: false,
	inflight: 0,
	fails: 0,
	ticks: 0,
	skipped: 0,
	started: false
};

function parseCPU(str) {
	var m = /CPU:\s*([\d.]+)%/.exec(String(str || ''));
	return m ? parseFloat(m[1]) : 0;
}

function parseTemp(str) {
	var m = (/([\d.]+)/.exec(String(str || '')) || [])[1];
	return m ? parseFloat(m) : null;
}

function firstIp(entry) {
	var a = entry && entry['ipv4-address'];
	if (!a || !a.length) return '';
	return a[0].address + (a[0].mask != null ? '/' + a[0].mask : '');
}

function byName(dump, name) {
	var list = (dump && dump.interface) || [];
	for (var i = 0; i < list.length; i++)
		if (list[i].interface === name) return list[i];
	return null;
}

/* ------------------------------------------------------------ safe rpc */

/*
 * A call that can never hang the scheduler, and can never throw synchronously.
 *
 * rpc.declare()'s callee can throw *before* returning a promise (a denied ACL,
 * a malformed expect, a module still loading). If that happens inside the
 * Promise.all() argument list, tick() throws instead of returning a promise,
 * the `.then` that releases the single-flight lock never runs, and the
 * dashboard freezes on its first frame forever. Passing a thunk and invoking it
 * inside the executor turns every failure mode into an ordinary rejection.
 */
function guard(thunk, ms) {
	var limit = ms || RPC_TIMEOUT;
	var released = false;

	S.inflight++;

	function release() {
		if (released) return;
		released = true;
		S.inflight = Math.max(0, S.inflight - 1);
	}

	return new Promise(function (resolve, reject) {
		var timer = setTimeout(function () {
			reject(new Error('rpc timeout after ' + limit + 'ms'));
		}, limit);

		var p;
		try {
			p = thunk();
		}
		catch (e) {
			clearTimeout(timer);
			release();
			reject(e);
			return;
		}

		Promise.resolve(p).then(
			function (v) {
				clearTimeout(timer);
				release();
				resolve(v);
			},
			function (e) {
				clearTimeout(timer);
				release();
				reject(e);
			}
		);
	});
}

function safe(thunk, fallback) {
	return guard(thunk).catch(function (e) {
		S.lastErr = e && e.message ? e.message : String(e);
		return fallback;
	});
}

/* ------------------------------------------------------------ rates */

function sampleRates(devices, wanDev) {
	var now = Date.now();
	var d = devices[wanDev] || null;
	if (!d || !d.stats) return { rx: 0, tx: 0, totalRx: 0, totalTx: 0 };

	var rx = d.stats.rx_bytes || 0;
	var tx = d.stats.tx_bytes || 0;

	if (!S.prev) {
		S.prev = { rx: rx, tx: tx };
		S.prevT = now;
		S.history.rx.push(0);
		S.history.tx.push(0);
		S.history.t.push(now);
		return { rx: 0, tx: 0, totalRx: rx, totalTx: tx };
	}

	var dt = Math.max(0.5, (now - S.prevT) / 1000);
	var drx = Math.max(0, rx - S.prev.rx);
	var dtx = Math.max(0, tx - S.prev.tx);
	S.prev = { rx: rx, tx: tx };
	S.prevT = now;

	var rate = { rx: drx / dt, tx: dtx / dt, totalRx: rx, totalTx: tx };

	S.history.rx.push(rate.rx);
	S.history.tx.push(rate.tx);
	S.history.t.push(now);
	while (S.history.rx.length > POINTS) S.history.rx.shift();
	while (S.history.tx.length > POINTS) S.history.tx.shift();
	while (S.history.t.length > POINTS) S.history.t.shift();

	return rate;
}

/* ------------------------------------------------------------ talkers */

/*
 * luci.halo/talkers does the diffing server side: it walks the connection table
 * once, compares each connection against the previous sample, and returns the
 * bytes each LAN host moved *during* the window, plus the window length. So the
 * browser only divides — no clocks, no assumptions about monotonic counters
 * (per-host totals are not monotonic: a closing connection takes its bytes
 * with it, which used to make the ranking read zero under load).
 *
 * A truncated reply (the plugin hit its read cap) is dropped outright: with
 * part of the table unseen, every connection in the unseen part looks new.
 */

function rateOf(ip) {
	var r = S.talkRates[ip];
	return r ? (r.up || 0) + (r.down || 0) : 0;
}

function talkerList() {
	var out = [];
	Object.keys(S.talkRates).forEach(function (ip) {
		out.push({ ip: ip, rate: rateOf(ip) });
	});
	out.sort(function (a, b) { return b.rate - a.rate; });
	return out.slice(0, 4);
}

function applyTalk(r) {
	if (!r || !r.hosts || r.truncated) return;

	/* first sample of a session has no baseline, so the plugin sends dt = 0 */
	if (!(r.dt > 0)) return;

	var rates = {};

	r.hosts.forEach(function (h) {
		if (!h || !h.ip) return;
		var up = h.up || 0;
		var down = h.down || 0;
		if (!up && !down) return;
		rates[h.ip] = { up: up / r.dt, down: down / r.dt };
	});

	S.talkRates = rates;
	S.talkWindow = r.dt;
	S.talkSampled = true;
}

function sampleTalk() {
	if (S.talkOff) return;

	S.talkBusy = true;
	var startedAt = Date.now();

	guard(function () { return callTalkers(S.lanBase + '.'); }, 12000)
		.then(function (r) {
			applyTalk(r);
			S.talkFails = 0;
			/* the plugin reports its own cost; that beats the round trip, which
			 * also contains rpcd queueing time */
			S.talkMs = (r && r.ms > 0) ? r.ms : Date.now() - startedAt;
		})
		.catch(function (err) {
			var msg = (err && err.message) || '';

			/* A slow sample is not a broken sample: the table walk grows with the
			 * connection table, so on a busy box one call really can take
			 * seconds. Only a real refusal (missing object, denied ACL) is
			 * permanent — three of those and the card stops asking. */
			if (/timeout/i.test(msg)) {
				S.talkMs = Date.now() - startedAt;
			}
			else {
				S.talkFails++;
				if (S.talkFails >= 3) S.talkOff = true;
				console.warn('[halo] talkers:', msg || err);
			}
		})
		.then(function () {
			S.talkBusy = false;

			/* Keep the sampler off rpcd's back: the next sample waits at least
			 * TALK seconds, and longer when the last walk was expensive, so the
			 * sampler never owns more than ~15% of a single-threaded daemon. */
			var back = Math.min(30000, Math.round((S.talkMs || 0) * 6));
			paceTalk(Math.max(TALK * 1000, back));
		});
}

/* ------------------------------------------------------------ model parts */

function buildClients() {
	var byIp = {};
	var out = [];
	var leases = (S.leases && S.leases.dhcp_leases) || [];

	leases.forEach(function (l) {
		if (!l.ipaddr || l.ipaddr === S.lanSelf) return;
		byIp[l.ipaddr] = true;
		out.push({
			name: l.hostname || '',
			ip: l.ipaddr,
			mac: l.macaddr || '',
			band: '有线',
			rate: rateOf(l.ipaddr),
			lease: l.expires != null ? l.expires : null,
			online: true
		});
	});

	Object.keys(S.hints || {}).forEach(function (mac) {
		var h = S.hints[mac];
		(h.ipaddrs || []).forEach(function (ip) {
			if (ip === S.lanSelf || ip.indexOf(S.lanBase + '.') !== 0 || byIp[ip]) return;
			byIp[ip] = true;
			out.push({
				name: '',
				ip: ip,
				mac: mac,
				band: '有线',
				rate: rateOf(ip),
				lease: null,
				online: rateOf(ip) > 0
			});
		});
	});

	out.sort(function (a, b) {
		if ((b.rate || 0) !== (a.rate || 0)) return (b.rate || 0) - (a.rate || 0);
		return (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true });
	});

	return out.slice(0, 8);
}

function protoLabel(proto) {
	var map = { dhcp: 'DHCP', static: '静态', dhcpv6: 'DHCPv6', wireguard: 'WireGuard', pppoe: 'PPPoE', none: '未启用' };
	return map[proto] || (proto ? proto.toUpperCase() : '—');
}

function buildIfaces(dump, devices) {
	var tags = { wan: 'WAN', wan6: 'WAN6', lan: 'LAN', wg: 'WG', docker: 'DK' };
	var order = ['wan', 'wan6', 'lan', 'wg', 'docker'];
	var list = (dump && dump.interface) || [];
	var out = [];

	var pick = list.filter(function (e) { return order.indexOf(e.interface) >= 0; });
	pick.sort(function (a, b) { return order.indexOf(a.interface) - order.indexOf(b.interface); });

	pick.forEach(function (e) {
		if (e.proto === 'none') return;
		var dev = devices[e.l3_device || e.interface];
		out.push({
			tag: tags[e.interface] || e.interface.toUpperCase(),
			name: protoLabel(e.proto),
			ip: firstIp(e) || '未分配',
			proto: e.proto || '',
			up: e.up !== false,
			link: dev && dev.link ? dev.link.speed || 0 : 0
		});
	});

	return out;
}

function buildModel(dump, devices, sysinfo, cpu, temp) {
	var wan = byName(dump, 'wan') || {};
	var lan = byName(dump, 'lan') || {};
	var wg = byName(dump, 'wg') || null;
	var lanIp = firstIp(lan) || '';
	var lanSelf = lanIp.split('/')[0];

	if (lanSelf) {
		S.lanSelf = lanSelf;
		S.lanBase = lanSelf.split('.').slice(0, 3).join('.');
	}

	var wanDev = wan.l3_device || 'wan';
	var rate = sampleRates(devices, wanDev);
	var dev = devices[wanDev] || {};

	var memTotal = ((sysinfo.memory && sysinfo.memory.total) || 0) / 1048576;
	var memAvail = ((sysinfo.memory && sysinfo.memory.available) || 0) / 1048576;
	var memUsed = Math.max(0, memTotal - memAvail);
	var rootTotal = ((sysinfo.root && sysinfo.root.total) || 0) / 1024;
	var rootUsed = ((sysinfo.root && sysinfo.root.used) || 0) / 1024;

	S.clients = buildClients();

	/* talkers may include hosts without a DHCP lease / host hints entry, so
	 * names are resolved through the client list where possible */
	var names = {};
	S.clients.forEach(function (c) {
		if (c.name) names[c.ip] = c.name;
	});

	var talkers = talkerList().map(function (t) {
		return { name: names[t.ip] || '', ip: t.ip, rate: t.rate };
	});

	return {
		step: STEP,
		seriesLen: POINTS,
		host: { name: S.board.hostname || '', model: S.board.model || '' },
		wan: {
			ip: firstIp(wan).split('/')[0] || '',
			proto: wan.proto || '',
			gw: (wan.route && wan.route.length) ? wan.route[0].nexthop || '' : '',
			dns: wan['dns-server'] || [],
			speed: (dev.link && dev.link.speed) || 0,
			up: !!wan.up
		},
		lan: {
			ip: lanSelf,
			mask: lanIp.indexOf('/') >= 0 ? lanIp.split('/')[1] : ''
		},
		rates: {
			rx: rate.rx,
			tx: rate.tx,
			totalRx: rate.totalRx,
			totalTx: rate.totalTx
		},
		history: { rx: S.history.rx.slice(), tx: S.history.tx.slice(), t: S.history.t.slice() },
		system: {
			cpu: parseCPU(cpu && cpu.cpuusage),
			load: sysinfo.load ? [sysinfo.load[0] / 65535, sysinfo.load[1] / 65535, sysinfo.load[2] / 65535] : [0, 0, 0],
			memUsed: memUsed,
			memTotal: memTotal,
			memPct: memTotal ? (memUsed / memTotal) * 100 : 0,
			storageUsed: rootUsed,
			storageTotal: rootTotal,
			storagePct: rootTotal ? (rootUsed / rootTotal) * 100 : 0,
			uptime: sysinfo.uptime || 0,
			kernel: S.board.kernel || '',
			temp: parseTemp(temp && temp.tempinfo),
			leases: ((S.leases && S.leases.dhcp_leases) || []).length
		},
		clients: S.clients,
		talkers: talkers,
		/* pending: sampler healthy but no rate yet (first sample, or the whole
		 * LAN is idle); off: luci.halo is missing or its ACL denies us */
		talkerState: S.talkOff ? 'off' : !S.talkSampled ? 'pending' : talkers.length ? 'ok' : 'idle',
		talkerWindow: S.talkWindow || 0,
		ifaces: buildIfaces(dump, devices),
		wifi: [],
		tunnels: (wg && wg.up) ? [{ name: 'wg', ip: firstIp(wg).split('/')[0] || '', up: true }] : []
	};
}

/* ------------------------------------------------------------ render */

function ensureDash() {
	if (window.HaloDash) return Promise.resolve();
	return new Promise(function (resolve, reject) {
		var s = document.createElement('script');
		s.src = (document.body.dataset.media || '/luci-static/halo') + '/dash.js';
		s.onload = function () { window.HaloDash ? resolve() : reject(new Error('dash.js export missing')); };
		s.onerror = function () { reject(new Error('dash.js failed to load')); };
		document.head.appendChild(s);
	});
}

function mount() {
	var host = document.getElementById('maincontent');
	if (!host) return null;
	var root = document.getElementById('halo-dash');
	if (!root) {
		root = document.createElement('div');
		root.id = 'halo-dash';
		host.insertBefore(root, host.firstChild);
	}
	return root;
}

function updateLed(up) {
	var led = document.getElementById('halo-led');
	if (led) led.className = 'halo-led' + (up ? '' : ' is-down');
}

/* ------------------------------------------------------------ scheduling */

/*
 * One heartbeat, one rule: the interval never stops, it only skips work.
 *
 * An earlier version cleared its timer whenever the tab looked hidden — which
 * meant that if the browser ever reported `hidden` during a callback, polling
 * stopped for good and the chart flatlined at "已采集 0 秒". A heartbeat that
 * keeps ticking and simply returns early can always recover, and it also
 * survives the background-timer throttling that a chained setTimeout suffers.
 */
var HEARTBEAT = 1000;

function nextDelay() {
	return BACKOFF[Math.min(S.fails, BACKOFF.length - 1)] * 1000;
}

function pace(ms) {
	S.nextAt = Date.now() + (ms == null ? nextDelay() : ms);
}

function paceSlow(ms) {
	S.slowNextAt = Date.now() + (ms == null ? SLOW * 1000 : ms);
}

function paceTalk(ms) {
	S.talkNextAt = Date.now() + (ms == null ? TALK * 1000 : ms);
}

function beat() {
	if (document.hidden) return;

	if (!S.busy && Date.now() >= S.nextAt) {
		if (S.inflight > INFLIGHT_CAP) {
			S.skipped++;
			pace(20000);
		}
		else {
			doTick();
		}
	}

	/* Not gated on S.inflight or S.busy: a tick always has five calls in the
	 * air and can itself take seconds on a busy box, so either test starves the
	 * sampler for good (both did, in testing). One call per 12 s, single-flight,
	 * 5 s guard — that is bounded on its own. */
	if (!S.talkBusy && Date.now() >= S.talkNextAt) sampleTalk();

	if (!S.slowBusy && Date.now() >= S.slowNextAt) {
		if (S.inflight > INFLIGHT_CAP) paceSlow(15000);
		else doSlow();
	}
}

function tick() {
	return Promise.all([
		safe(callDump, {}),
		safe(callNetDevices, {}),
		safe(callSysInfo, {}),
		safe(callCPU, {}),
		safe(callTemp, {})
	]).then(function (r) {
		S.parts = r;
		var model = buildModel(r[0] || {}, r[1] || {}, r[2] || {}, r[3] || {}, r[4] || {});
		S.lastModel = model;

		if (!S.root) S.root = mount();
		if (!S.root) return;

		window.HaloDash.render(S.root, model);
		document.body.classList.add('halo-overview', 'halo-dash-ready');
		updateLed(model.wan.up);
	});
}

function doTick() {
	S.busy = true;
	var startedAt = Date.now();
	S.ticks++;

	var round;
	try {
		round = tick();
	}
	catch (e) {
		S.lastErr = e && e.message ? e.message : String(e);
		round = Promise.reject(e);
	}

	round
		.then(function () {
			S.fails = 0;
		})
		.catch(function (err) {
			S.fails++;
			console.warn('[halo] tick failed (' + S.fails + '):', err && err.message ? err.message : err);
		})
		.then(function () {
			S.busy = false;
			S.lastMs = Date.now() - startedAt;
			/* never re-fire sooner than the round itself took to complete */
			pace(Math.max(nextDelay(), S.lastMs > STEP * 1000 ? S.lastMs : 0));
		});
}

function doSlow() {
	S.slowBusy = true;

	Promise.all([
		safe(function () { return callLeases(4); }, {}),
		safe(callHints, {})
	])
		.then(function (r) {
			S.leases = r[0] || {};
			S.hints = r[1] || {};
		})
		.catch(function (err) {
			console.warn('[halo] slow refresh failed:', err && err.message ? err.message : err);
		})
		.then(function () {
			S.slowBusy = false;
			paceSlow();
		});
}

function startHeartbeat() {
	if (S.heartbeat) clearInterval(S.heartbeat);
	S.heartbeat = setInterval(beat, HEARTBEAT);
}

function stopHeartbeat() {
	if (S.heartbeat) clearInterval(S.heartbeat);
	S.heartbeat = null;
}

/* coming back to the tab: catch up immediately instead of waiting out the pace.
 * Only a real hidden->visible transition counts — some browsers fire duplicate
 * events, and resetting the pace on each one would pin the loop at full rate. */
var wasHidden = false;

function onVisibility() {
	var hiddenNow = !!document.hidden;
	if (hiddenNow === wasHidden) return;
	wasHidden = hiddenNow;
	if (hiddenNow) return;
	pace(150);
	paceSlow(150);
	paceTalk(150);
}

return baseclass.extend({
	__init__: function () {
		window.haloState = S;

		var start = function () {
			S.started = true;
			document.addEventListener('visibilitychange', onVisibility);
			window.addEventListener('pagehide', stopHeartbeat);
			pace(0);
			paceSlow(0);
			/* one of the first things to fire, but not in the same burst as the
			 * initial dashboard calls: the sampler holds rpcd for up to a second */
			paceTalk(1200);
			startHeartbeat();
		};

		/* let the page paint before the first burst of ubus traffic */
		setTimeout(function () {
			ensureDash()
				.then(function () {
					return Promise.all([
						safe(callBoard, {}),
						safe(function () { return callLeases(4); }, {}),
						safe(callHints, {})
					]);
				})
				.then(function (r) {
					S.board = r[0] || {};
					S.leases = r[1] || {};
					S.hints = r[2] || {};
					start();
				})
				.catch(function (err) {
					console.error('[halo] init failed:', err && err.message ? err.message : err);
					document.body.classList.remove('halo-overview', 'halo-dash-ready');
				});
		}, 400);
	}
});
