/*
 * luci-theme-halo — dashboard renderer
 * Pure browser script: no LuCI dependency. Call HaloDash.render(el, model).
 * The live collector (halo-live.js) builds the same model from ubus data,
 * the preview builds it from fixtures — one renderer, no drift.
 */
(function (global) {
	"use strict";

	/* ------------------------------------------------------------ format */

	var KB = 1024;

	function fmtRate(bps) {
		if (bps == null || isNaN(bps)) return "—";
		if (bps < 1) return "0 B/s";
		if (bps < KB) return Math.round(bps) + " B/s";
		if (bps < KB * KB) return (bps / KB).toFixed(bps < KB * 10 ? 1 : 0) + " kB/s";
		return (bps / KB / KB).toFixed(2) + " MB/s";
	}

	function fmtRateParts(bps) {
		var s = fmtRate(bps);
		var i = s.indexOf(" ");
		return [s.slice(0, i), s.slice(i + 1)];
	}

	function fmtBytes(b) {
		if (b == null || isNaN(b)) return "—";
		if (b < KB) return Math.round(b) + " B";
		if (b < KB * KB) return (b / KB).toFixed(1) + " KB";
		if (b < KB * KB * KB) return (b / KB / KB).toFixed(1) + " MB";
		return (b / KB / KB / KB).toFixed(2) + " GB";
	}

	function fmtMbps(kbps) {
		if (kbps == null || isNaN(kbps) || kbps <= 0) return "—";
		if (kbps >= 1000) return (kbps / 1000).toFixed(kbps % 1000 ? 1 : 0) + " Gb/s";
		return Math.round(kbps) + " Mb/s";
	}

	function fmtUptime(sec) {
		if (!sec && sec !== 0) return "—";
		var d = Math.floor(sec / 86400),
			h = Math.floor((sec % 86400) / 3600),
			m = Math.floor((sec % 3600) / 60);
		if (d > 0) return d + " 天 " + h + " 小时";
		if (h > 0) return h + " 小时 " + m + " 分";
		return m + " 分";
	}

	function fmtLease(sec) {
		if (!sec && sec !== 0) return "";
		if (sec <= 0) return "已过期";
		var h = Math.floor(sec / 3600),
			m = Math.round((sec % 3600) / 60);
		if (h >= 1) return "租约 " + h + " 小时";
		return "租约 " + m + " 分";
	}

	function el(tag, cls, txt) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (txt != null) n.textContent = txt;
		return n;
	}

	function svg(tag, attrs) {
		var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
		for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
		return n;
	}

	function truncate(s, n) {
		s = String(s || "");
		return s.length > n ? s.slice(0, n - 1) + "…" : s;
	}

	var ICONS = {
		clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.3 1.4"/></svg>',
		topo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.6" y="2.4" width="6" height="5" rx="1.4"/><rect x="8.6" y="8.8" width="5.8" height="4.8" rx="1.4"/><path d="M4.6 7.4v3.2h4"/></svg>',
		flux: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 11.2l3.4-4 2.6 2.4 3-4.2 3.4 3.4"/><path d="M1.8 14h12.4"/></svg>',
		sys: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="1.8" y="2.6" width="12.4" height="7.4" rx="1.4"/><path d="M5.6 13h4.8M8 10.4V13"/></svg>',
		cli: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="5.6" cy="5.4" r="2.4"/><path d="M1.8 13c0-2.2 1.7-3.6 3.8-3.6S9.4 10.8 9.4 13"/><circle cx="11.4" cy="6" r="1.9"/><path d="M10 9.6c2.2-.2 4 1 4.2 3.4"/></svg>',
		talk: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.2 13V8.4M6 13V4.6M9.8 13V6.8M13.6 13V2.8"/></svg>',
		iface: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="4.4" width="12.4" height="7.2" rx="1.4"/><path d="M4.4 8h1.4M7.4 8h1.4M10.4 8h1.4"/></svg>'
	};

	/* ------------------------------------------------------------ model */

	function emptySeries(n) {
		var a = new Array(n);
		for (var i = 0; i < n; i++) a[i] = 0;
		return a;
	}

	function normalize(model) {
		var m = model || {};
		m.history = m.history || {};
		m.seriesLen = m.seriesLen || (m.history.rx ? m.history.rx.length : 0) || 60;
		if (!m.history.rx || !m.history.rx.length) {
			m.history.rx = emptySeries(m.seriesLen || 60);
			m.history.tx = emptySeries(m.seriesLen || 60);
		}
		m.clients = m.clients || [];
		m.talkers = m.talkers || [];
		m.ifaces = m.ifaces || [];
		m.wifi = m.wifi || [];
		m.tunnels = m.tunnels || [];
		m.rates = m.rates || { rx: 0, tx: 0 };
		m.system = m.system || {};
		m.wan = m.wan || {};
		m.lan = m.lan || {};
		m.host = m.host || {};
		return m;
	}

	/* ------------------------------------------------------------ shell */

	function card(cls, icon, title, meta, linkHref, linkText) {
		var c = el("section", "hd-card " + cls);
		var h = el("div", "hd-card-h");
		var t = el("h3");
		if (icon) {
			var i = el("span", "hd-ico");
			i.innerHTML = ICONS[icon] || "";
			t.appendChild(i);
		}
		t.appendChild(el("span", null, title));
		h.appendChild(t);
		if (meta) h.appendChild(el("span", "hd-meta", meta));
		h.appendChild(el("span", "hd-spacer"));
		if (linkHref) {
			var a = el("a", "hd-link", linkText || "详情 →");
			a.href = linkHref;
			h.appendChild(a);
		}
		c.appendChild(h);
		var b = el("div", "hd-card-b");
		c.appendChild(b);
		return { root: c, body: b, head: h };
	}

	/* ------------------------------------------------------------ vitals */

	function renderVitals(m) {
		var c = card("hd-c-info", "clock", "网络信息", null, "/cgi-bin/luci/admin/network/network", "接口 →");
		c.body.classList.add("flush");
		var wrap = el("div", "hd-card-b");
		wrap.style.padding = "12px 14px 13px";
		var v = el("div", "hd-vitals");

		/* WAN / LAN / uptime */
		[
			["WAN", (m.wan.ip || "未连接") + (m.wan.proto ? " · " + m.wan.proto.toUpperCase() : ""), m.wan.up],
			["LAN", (m.lan.ip || "—") + (m.lan.mask ? " /" + m.lan.mask : ""), true],
			["运行", fmtUptime(m.system.uptime), true]
		].forEach(function (r) {
			var row = el("div", "hd-vital-row");
			var k = el("div", "hd-vital-name");
			var dot = el("span", "hd-dot");
			dot.style.color = r[2] ? "var(--halo-ok)" : "var(--halo-bad)";
			k.appendChild(dot);
			k.appendChild(el("b", null, r[0]));
			row.appendChild(k);
			row.appendChild(el("div", "hd-vital-val" + (r[2] ? "" : " is-muted"), r[1]));
			v.appendChild(row);
		});

		/* live rates */
		var rates = el("div", "hd-rates");
		[
			["rx", "下载", m.rates.rx],
			["tx", "上传", m.rates.tx]
		].forEach(function (r) {
			var box = el("div", "hd-rate" + (r[0] === "tx" ? " is-tx" : ""));
			var top = el("div", "hd-rate-top");
			top.appendChild(el("i", "hd-rate-bar"));
			top.appendChild(el("span", "hd-rate-k", r[0].toUpperCase()));
			top.appendChild(el("span", "hd-rate-k", r[1]));
			box.appendChild(top);
			var parts = fmtRateParts(r[2] || 0);
			var val = el("div", "hd-rate-v", parts[0]);
			val.appendChild(el("span", "hd-unit", parts[1]));
			box.appendChild(val);
			rates.appendChild(box);
		});
		v.appendChild(rates);

		/* 60-second sparkline */
		v.appendChild(el("canvas", "hd-spark"));

		/* link facts */
		var detail = el("div", "hd-kv-grid");
		[
			["网关", m.wan.gw || "—"],
			["DNS", (m.wan.dns || []).slice(0, 1).join("") || "—"],
			["链路", m.wan.speed ? fmtMbps(m.wan.speed) : m.wan.up ? "已连接" : "断开"]
		].forEach(function (r) {
			detail.appendChild(el("span", "hd-kv-k", r[0]));
			detail.appendChild(el("span", "hd-kv-v", r[1]));
		});
		v.appendChild(detail);

		var total = el("div", "hd-total-row");
		total.appendChild(el("span", "hd-kv-k", "开机累计"));
		total.appendChild(
			el("span", "hd-kv-v mono", "↓ " + fmtBytes(m.rates.totalRx || 0) + "  ↑ " + fmtBytes(m.rates.totalTx || 0))
		);
		v.appendChild(total);

		wrap.appendChild(v);
		c.body.appendChild(wrap);
		c.spark = wrap.querySelector("canvas.hd-spark");
		return c;
	}

	/* ------------------------------------------------------------ topology */

	var TOPO = {
		w: 780,
		h: 268,
		cloud: { x: 48, y: 88 },
		router: { x: 250, y: 34, w: 190, h: 104 },
		busX: 466,
		listX: 508,
		listW: 232,
		rowStep: 58,
		rowH: 46,
		startY: 14,
		tunnel: { x: 176, y: 186, w: 164, h: 44 }
	};

	/* Phones get a vertical chain instead of the wide bus: one column, real type
	 * size, no 0.45x downscale. */
	var TOPO_N = {
		w: 340,
		pad: 24,
		rowH: 46,
		rowStep: 58
	};

	function topoNode(x, y, w, h, cls, href) {
		var g = svg("g", { class: "topo-node" + (cls ? " " + cls : "") });
		g.appendChild(svg("rect", { x: x, y: y, width: w, height: h, rx: 9, class: "topo-node-box" }));
		if (href) {
			g.setAttribute("class", g.getAttribute("class") + " is-link");
			g.addEventListener("click", function () {
				global.location.href = href;
			});
		}
		return g;
	}

	function buildTopoWide(g, m) {
		var R = TOPO.router;
		var centerY = R.y + R.h / 2;

		/* internet cloud */
		var cloud = svg("g", {});
		cloud.appendChild(
			svg("path", {
				d: "M46 108c-8 0-14-6-14-13 0-7 5-12 12-13 1-10 9-17 19-17 8 0 15 5 18 12 9-1 16 5 16 14 0 9-7 15-16 15H46z",
				class: "topo-node-box",
				style: "fill:var(--halo-surface-sunk)",
				transform: "translate(-17,-4)"
			})
		);
		cloud.appendChild(text(48, 128, "互联网", "topo-cap", "middle"));
		var cip = text(48, 142, m.wan.gw ? "网关 " + m.wan.gw : "无连接", "topo-s", "middle");
		cloud.appendChild(cip);
		g.appendChild(cloud);

		/* router */
		var rn = topoNode(R.x, R.y, R.w, R.h, "is-self", "/cgi-bin/luci/admin/status/overview");
		rn.appendChild(text(R.x + 14, R.y + 22, m.host.name || "router", "topo-t"));
		rn.appendChild(text(R.x + 14, R.y + 36, m.host.model || "", "topo-s"));
		[
			["CPU", m.system.cpu || 0],
			["MEM", m.system.memPct || 0]
		].forEach(function (row, i) {
			var yy = R.y + 50 + i * 22;
			rn.appendChild(text(R.x + 14, yy + 4.5, row[0], "topo-cap"));
			rn.appendChild(
				svg("rect", { x: R.x + 44, y: yy, width: 96, height: 5, rx: 2.5, fill: "var(--halo-hairline)" })
			);
			rn.appendChild(
				svg("rect", {
					x: R.x + 44,
					y: yy,
					width: Math.max(2, Math.min(96, (96 * row[1]) / 100)),
					height: 5,
					rx: 2.5,
					fill: row[1] > 85 ? "var(--halo-warn)" : "var(--halo-rx)"
				})
			);
			rn.appendChild(text(R.x + 148, yy + 4.5, Math.round(row[1]) + "%", "topo-s"));
		});
		rn.appendChild(
			svg("circle", { cx: R.x + R.w - 15, cy: R.y + 14, r: 4, fill: m.wan.up ? "var(--halo-ok)" : "var(--halo-bad)" })
		);
		g.appendChild(rn);

		/* WAN link + label */
		var linkD = "M84 " + TOPO.cloud.y + " C 158 " + TOPO.cloud.y + ", 176 " + centerY + ", " + R.x + " " + centerY;
		g.appendChild(svg("path", { d: linkD, class: "topo-link is-active" }));
		g.appendChild(svg("path", { d: linkD, class: "topo-flow" }));
		g.appendChild(
			text(
				(100 + R.x) / 2,
				centerY - 11,
				"↓ " + fmtRate(m.rates.rx || 0) + "   ↑ " + fmtRate(m.rates.tx || 0),
				"topo-rate",
				"middle"
			)
		);

		/* clients */
		var clients = m.clients.slice(0, 4);
		var cyList = clients.map(function (_, i) {
			return TOPO.startY + i * TOPO.rowStep;
		});
		if (clients.length) {
			var busTop = cyList[0] + TOPO.rowH / 2;
			var busBottom = cyList[cyList.length - 1] + TOPO.rowH / 2;
			g.appendChild(svg("path", { d: "M" + (R.x + R.w) + " " + centerY + " H " + TOPO.busX, class: "topo-link is-active" }));
			g.appendChild(
				svg("path", { d: "M" + TOPO.busX + " " + busTop + " V " + busBottom, class: "topo-link is-active" })
			);
		}

		clients.forEach(function (cl, i) {
			var cy = cyList[i];
			var mid = cy + TOPO.rowH / 2;
			g.appendChild(
				svg("path", {
					d: "M" + TOPO.busX + " " + mid + " H " + TOPO.listX,
					class: "topo-link" + (cl.online === false ? "" : " is-active")
				})
			);
			var nb = topoNode(TOPO.listX, cy, TOPO.listW, TOPO.rowH, null, "/cgi-bin/luci/admin/network/dhcp");
			var icon = svg("g", { class: "topo-icon" });
			if (cl.band === "5G" || cl.band === "2.4G") {
				icon.appendChild(
					svg("path", { d: "M" + (TOPO.listX + 15) + " " + (mid + 3) + "a8 8 0 0 1 11 0" })
				);
				icon.appendChild(
					svg("path", { d: "M" + (TOPO.listX + 12) + " " + (mid - 1) + "a13 13 0 0 1 17 0" })
				);
				icon.appendChild(
					svg("circle", {
						cx: TOPO.listX + 20.5,
						cy: mid + 6,
						r: 1.6,
						fill: "var(--halo-ink-3)",
						stroke: "none"
					})
				);
			} else {
				icon.appendChild(svg("rect", { x: TOPO.listX + 12, y: mid - 5, width: 18, height: 12, rx: 2.5 }));
				icon.appendChild(
					svg("path", {
						d:
							"M" + (TOPO.listX + 16) + " " + (mid - 1) + "h10M" + (TOPO.listX + 16) + " " + (mid + 3) + "h6"
					})
				);
			}
			nb.appendChild(icon);
			nb.appendChild(text(TOPO.listX + 38, cy + 19, truncate(cl.name || cl.ip || "未知设备", 17), "topo-t"));
			nb.appendChild(
				text(TOPO.listX + 38, cy + 34, (cl.ip || "—") + (cl.band ? " · " + cl.band : ""), "topo-s")
			);
			nb.appendChild(
				svg("circle", {
					cx: TOPO.listX + TOPO.listW - 14,
					cy: cy + 13,
					r: 3,
					fill: cl.online === false ? "var(--halo-ink-4)" : "var(--halo-ok)"
				})
			);
			nb.appendChild(
				text(
					TOPO.listX + TOPO.listW - 12,
					cy + 32,
					cl.rate ? fmtRate(cl.rate) : cl.online === false ? "离线" : "空闲",
					"topo-s",
					"end"
				)
			);
			g.appendChild(nb);
		});

		if (!clients.length) {
			g.appendChild(text(TOPO.listX, centerY + 4, "暂无客户端", "topo-s"));
		}

		/* optional tunnel */
		if (m.tunnels.length) {
			var t = m.tunnels[0];
			var T = TOPO.tunnel;
			g.appendChild(
				svg("path", {
					d:
						"M" +
						(T.x + T.w + 26) +
						" " +
						(R.y + R.h) +
						" V " +
						(T.y + T.h / 2) +
						" H " +
						(T.x + T.w),
					class: "topo-link",
					"stroke-dasharray": "4 4"
				})
			);
			var tn = topoNode(T.x, T.y, T.w, T.h, "is-off", "/cgi-bin/luci/admin/network/network");
			tn.appendChild(text(T.x + 14, T.y + 19, "隧道 · " + (t.name || "wg"), "topo-t"));
			tn.appendChild(text(T.x + 14, T.y + 33, t.ip || "", "topo-s"));
			g.appendChild(tn);
		}

		return TOPO.h;
	}


	/* vertical variant: internet chip -> router -> clients (bus behind the rows) */
	function buildTopoNarrow(g, m) {
		var W = TOPO_N.w,
			PAD = TOPO_N.pad,
			CW = W - PAD * 2,
			mid = Math.round(W / 2);

		function vlink(x, y1, y2, dashed) {
			var d = "M" + x + " " + y1 + " V" + y2;
			g.appendChild(
				svg("path", { d: d, class: "topo-link" + (dashed ? "" : " is-active"), "stroke-dasharray": dashed ? "4 4" : null })
			);
			if (!dashed) g.appendChild(svg("path", { d: d, class: "topo-flow" }));
		}

		/* internet */
		var iy = 4,
			ih = 40;
		var inet = topoNode(PAD, iy, CW, ih, "is-off", "/cgi-bin/luci/admin/network/network");
		inet.appendChild(text(PAD + 12, iy + 17, "互联网", "topo-t"));
		inet.appendChild(text(PAD + 12, iy + 31, m.wan.gw || "未连接", "topo-s"));
		inet.appendChild(text(PAD + CW - 12, iy + 17, "↓ " + fmtRate(m.rates.rx || 0), "topo-s", "end"));
		inet.appendChild(text(PAD + CW - 12, iy + 31, "↑ " + fmtRate(m.rates.tx || 0), "topo-s", "end"));
		g.appendChild(inet);

		/* router */
		var ry = iy + ih + 30,
			rh = 92;
		vlink(mid, iy + ih, ry);

		var R = { x: PAD, y: ry, w: CW, h: rh };
		var rn = topoNode(R.x, R.y, R.w, R.h, "is-self", "/cgi-bin/luci/admin/status/overview");
		rn.appendChild(text(R.x + 14, R.y + 20, m.host.name || "router", "topo-t"));
		rn.appendChild(text(R.x + 14, R.y + 34, m.host.model || "", "topo-s"));
		[
			["CPU", m.system.cpu || 0],
			["MEM", m.system.memPct || 0]
		].forEach(function (row, i) {
			var yy = R.y + 50 + i * 22,
				track = CW - 116;
			rn.appendChild(text(R.x + 14, yy + 4.5, row[0], "topo-cap"));
			rn.appendChild(svg("rect", { x: R.x + 48, y: yy, width: track, height: 5, rx: 2.5, fill: "var(--halo-hairline)" }));
			rn.appendChild(
				svg("rect", {
					x: R.x + 48,
					y: yy,
					width: Math.max(2, (track * Math.min(100, row[1])) / 100),
					height: 5,
					rx: 2.5,
					fill: row[1] > 85 ? "var(--halo-warn)" : "var(--halo-rx)"
				})
			);
			rn.appendChild(text(R.x + CW - 14, yy + 4.5, Math.round(row[1]) + "%", "topo-s", "end"));
		});
		rn.appendChild(
			svg("circle", { cx: R.x + R.w - 15, cy: R.y + 16, r: 4, fill: m.wan.up ? "var(--halo-ok)" : "var(--halo-bad)" })
		);
		g.appendChild(rn);

		/* clients — the spine runs behind the rows so only the gaps show */
		var clients = m.clients.slice(0, 4);
		var cy = R.y + R.h + 26;
		var bottom = cy;
		if (clients.length) {
			var last = cy + (clients.length - 1) * TOPO_N.rowStep + TOPO_N.rowH / 2;
			vlink(mid, R.y + R.h, last);
			clients.forEach(function (cl, i) {
				var y = cy + i * TOPO_N.rowStep;
				var nb = topoNode(PAD, y, CW, TOPO_N.rowH, null, "/cgi-bin/luci/admin/network/dhcp");
				nb.appendChild(text(PAD + 14, y + 19, truncate(cl.name || cl.ip || "未知设备", 20), "topo-t"));
				nb.appendChild(text(PAD + 14, y + 33, (cl.ip || "—") + (cl.band ? " · " + cl.band : ""), "topo-s"));
				nb.appendChild(
					svg("circle", {
						cx: PAD + CW - 15,
						cy: y + 14,
						r: 3,
						fill: cl.online === false ? "var(--halo-ink-4)" : "var(--halo-ok)"
					})
				);
				nb.appendChild(
					text(
						PAD + CW - 14,
						y + 33,
						cl.rate ? fmtRate(cl.rate) : cl.online === false ? "离线" : "空闲",
						"topo-s",
						"end"
					)
				);
				g.appendChild(nb);
				bottom = y + TOPO_N.rowH;
			});
		} else {
			g.appendChild(text(PAD, cy + 10, "暂无客户端", "topo-s"));
			bottom = cy + 18;
		}

		/* tunnel hangs off the router down the right gutter */
		if (m.tunnels.length) {
			var t = m.tunnels[0],
				ty = bottom + 18,
				tw = CW - 28;
			g.appendChild(
				svg("path", {
					d: "M" + (PAD + CW) + " " + (R.y + 54) + " H" + (W - 8) + " V" + (ty + 18) + " H" + (PAD + tw),
					class: "topo-link",
					"stroke-dasharray": "4 4"
				})
			);
			var tn = topoNode(PAD, ty, tw, 36, "is-off", "/cgi-bin/luci/admin/network/network");
			tn.appendChild(text(PAD + 12, ty + 15, "隧道 · " + (t.name || "wg"), "topo-t"));
			tn.appendChild(text(PAD + 12, ty + 28, t.ip || "", "topo-s"));
			g.appendChild(tn);
			bottom = ty + 36;
		}

		return bottom + 6;
	}

	function renderTopology(m) {
		var c = card(
			"hd-c-topo",
			"topo",
			"网络拓扑",
			(m.clients.length || 0) + " 台客户端",
			"/cgi-bin/luci/admin/network/routes",
			"路由表 →"
		);
		var wrap = el("div", "hd-topo-wrap");
		var S = svg("svg", { class: "hd-topo", role: "img" });
		S.setAttribute("aria-label", "网络拓扑示意图");
		var g = svg("g", {});
		var narrow = (global.innerWidth || 1024) < 620;
		var vw = narrow ? TOPO_N.w : TOPO.w;
		var vh = narrow ? buildTopoNarrow(g, m) : buildTopoWide(g, m);
		S.setAttribute("viewBox", "0 0 " + vw + " " + vh);
		S.appendChild(g);
		wrap.appendChild(S);

		var legend = el("div", "topo-legend");
		legend.innerHTML =
			'<span><i class="flow"></i>活跃链路</span><span><i class="idle"></i>空闲链路</span><span class="is-dim">点击节点可跳转对应配置</span>';
		wrap.appendChild(legend);

		c.body.classList.add("flush");
		c.body.appendChild(wrap);
		return c;
	}

	function text(x, y, str, cls, anchor) {
		var t = svg("text", { x: x, y: y, class: cls, "text-anchor": anchor });
		t.textContent = str;
		return t;
	}

	/* ------------------------------------------------------------ chart */

	/* Axis scale in the same unit fmtRate() prints, so every label is round:
	 * steps are 1 / 1.5 / 2 / 2.5 / 5 x 10^n of a single B/s, kB/s or MB/s.
	 * The unit follows the resulting top value, not the peak — otherwise a peak
	 * just under 1 MB yields labels like "1000kB/s" next to "1.46MB/s". */
	/* One unit for the whole axis: 1.5M / 1M / 500k / 0 reads better than
	 * "1.50MB/s" next to "512kB/s" on the same ladder. */
	function axisLabel(v, unit) {
		if (!(v > 0)) return "0";
		var n;
		if (unit >= KB * KB) {
			n = v / (KB * KB);
			return (n >= 10 ? Math.round(n) : Math.round(n * 100) / 100) + "M";
		}
		if (unit >= KB) {
			n = v / KB;
			return (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10) + "k";
		}
		return Math.round(v) + "B";
	}

	function scaleIn(peak, want, unit) {
		var v = Math.max(peak, 0) / unit;
		var raw = v > 0 ? v / want : 1;
		var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
		var norm = raw / mag;
		var mult = norm <= 1 ? 1 : norm <= 1.5 ? 1.5 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
		var step = Math.max(Math.round(mult * mag * unit), 1);
		var top = Math.ceil((v * unit) / step) * step;
		if (top < step * 4) top = step * 4;
		return { max: top, step: step, count: Math.round(top / step), unit: unit };
	}

	function niceScale(peak, intervals) {
		var want = Math.max(1, intervals || 4);
		/* An idle link reads "4k / 3k / 2k / 1k / 0", never "4B / 3B" — a
		 * byte-scale ladder is a tell that the meter is not really running. */
		var unit = peak < KB * KB ? KB : KB * KB;
		var s = scaleIn(peak, want, unit);
		/* Only ever promote the unit. Demoting a kB ladder back to bytes is what
		 * produced "600B / 450B / 300B" on a link that was merely idle. */
		if (s.max >= KB * KB) s = scaleIn(peak, want, KB * KB);
		return s;
	}

	function drawChart(canvas, rx, tx, opts) {
		var o = opts || {};
		var dpr = global.devicePixelRatio || 1;
		var cssW = canvas.clientWidth || 600;
		var cssH = canvas.clientHeight || 196;
		canvas.width = Math.round(cssW * dpr);
		canvas.height = Math.round(cssH * dpr);
		var ctx = canvas.getContext("2d");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cssW, cssH);

		var cs = getComputedStyle(document.documentElement);
		var v = function (name, fb) {
			return cs.getPropertyValue(name).trim() || fb;
		};
		var hair = v("--halo-hairline", "#e0e4e2");
		var ink4 = v("--halo-ink-4", "#a3adb2");
		var cRx = v("--halo-rx", "#3a3f9e");
		var cTx = v("--halo-tx", "#b5651f");

		var narrow = cssW < 520;
		var padL = 2,
			padR = narrow ? 34 : 46,
			padT = 8,
			padB = 6;
		var W = Math.max(10, cssW - padL - padR);
		var H = Math.max(10, cssH - padT - padB);

		var n = rx.length;
		var win = o.windowSec || 300;
		var span = o.spanSec || 0;
		var full = span >= win * 0.92;          /* buffer long enough for the real window */
		var total = Math.max(n, o.total || n);
		var slots = full ? total : Math.max(2, n);
		var xStep = W / Math.max(1, slots - 1);
		var x0 = full ? padL + W - (n - 1) * xStep : padL;
		var peak = 0;
		for (var i = 0; i < n; i++) peak = Math.max(peak, rx[i] || 0, tx[i] || 0);
		var scale = niceScale(peak, 4);
		var scaleMax = scale.max;
		var step = scale.step;

		ctx.font = (narrow ? 9 : 10) + 'px ui-monospace, "SF Mono", Consolas, monospace';
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		for (var gi = 0; gi <= scale.count; gi++) {
			var gy = padT + (H * gi) / scale.count;
			ctx.beginPath();
			ctx.strokeStyle = hair;
			ctx.lineWidth = 1;
			ctx.setLineDash(gi === scale.count ? [] : [2, 4]);
			ctx.moveTo(padL, gy + 0.5);
			ctx.lineTo(padL + W, gy + 0.5);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = ink4;
			ctx.textAlign = "left";
			ctx.fillText(axisLabel(scaleMax - gi * step, scale.unit), padL + W + 7, gy);
		}

		function line(series, color, soft) {
			if (!series.length) return;
			ctx.beginPath();
			var started = false;
			for (var i = 0; i < series.length; i++) {
				var x = x0 + i * xStep;
				var y = padT + H - (H * Math.min(series[i], scaleMax)) / scaleMax;
				if (x < padL) continue;
				if (!started) { ctx.moveTo(Math.max(padL, x), y); started = true; }
				else ctx.lineTo(x, y);
			}
			ctx.strokeStyle = color;
			ctx.lineWidth = 1.8;
			ctx.lineJoin = "round";
			ctx.lineCap = "round";
			ctx.stroke();
			ctx.lineTo(padL + W, padT + H);
			ctx.lineTo(Math.max(padL, x0), padT + H);
			ctx.closePath();
			var grad = ctx.createLinearGradient(0, padT, 0, padT + H);
			grad.addColorStop(0, soft);
			grad.addColorStop(1, "rgba(0,0,0,0)");
			ctx.fillStyle = grad;
			ctx.fill();
		}

		line(tx, cTx, v("--halo-tx-soft", "rgba(181,101,31,.10)"));
		line(rx, cRx, v("--halo-rx-soft", "rgba(58,63,158,.13)"));

		if (n > 1) {
			var hx = padL + W;
			var hy = padT + H - (H * Math.min(rx[n - 1], scaleMax)) / scaleMax;
			ctx.beginPath();
			ctx.arc(hx, hy, 5, 0, Math.PI * 2);
			ctx.fillStyle = v("--halo-accent-soft", "rgba(58,63,158,.13)");
			ctx.fill();
			ctx.beginPath();
			ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
			ctx.fillStyle = cRx;
			ctx.fill();
		}

		/* hover crosshair */
		if (o.hover != null && n > 1) {
			var hxx = Math.max(padL, x0 + o.hover * xStep);
			ctx.beginPath();
			ctx.strokeStyle = cRx;
			ctx.globalAlpha = 0.35;
			ctx.setLineDash([3, 3]);
			ctx.moveTo(hxx, padT);
			ctx.lineTo(hxx, padT + H);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.globalAlpha = 1;
		}

		return {
			padL: padL, padT: padT, W: W, H: H,
			scaleMax: scaleMax, cssW: cssW, cssH: cssH,
			x0: x0, xStep: xStep, n: n,
			full: full, span: span, windowSec: win
		};
	}

	function spanLabel(sec) {
		if (!(sec > 0)) return "0 秒";
		if (sec < 90) return Math.round(sec) + " 秒";
		if (sec < 3600) return Math.round(sec / 60) + " 分钟";
		return (sec / 3600).toFixed(1) + " 小时";
	}

	/* seconds covered by the sample buffer (timestamps when available) */
	function bufferSpan(m) {
		var t = m.history && m.history.t;
		if (t && t.length > 1) return Math.max(0, (t[t.length - 1] - t[0]) / 1000);
		var n = m.history && m.history.rx ? m.history.rx.length : 0;
		return Math.max(0, (n - 1) * (m.step || 5));
	}

	function renderFlux(m) {
		var WINDOW = 300;
		var c = card(
			"hd-c-flux",
			"flux",
			"吞吐量",
			"近 5 分钟",
			"/cgi-bin/luci/admin/status/realtime/bandwidth",
			"实时 →"
		);
		var meta = c.head.querySelector(".hd-meta");
		var head = el("div", "hd-flux-head");
		var legend = el("div", "hd-legend");
		[
			["rx", "RX", "下载", m.rates.rx],
			["tx", "TX", "上传", m.rates.tx]
		].forEach(function (r) {
			var item = el("div", "hd-legend-item");
			var key = el("span", "hd-legend-key" + (r[0] === "tx" ? " is-tx" : ""));
			key.appendChild(el("i"));
			key.appendChild(el("span", null, r[1]));
			item.appendChild(key);
			item.appendChild(el("span", "hd-legend-val", fmtRate(r[3] || 0)));
			legend.appendChild(item);
		});
		head.appendChild(legend);
		c.body.appendChild(head);

		var box = el("div", "hd-chart");
		var canvas = el("canvas");
		box.appendChild(canvas);
		var tip = el("div", "hd-chart-tip");
		box.appendChild(tip);
		c.body.appendChild(box);

		var ticks = el("div", "hd-ticks");
		var marks = [];
		for (var ti = 0; ti < 6; ti++) {
			var s = el("span");
			ticks.appendChild(s);
			marks.push(s);
		}
		c.body.appendChild(ticks);

		var hover = null;
		function paint() {
			var span = bufferSpan(m);
			var geo = drawChart(canvas, m.history.rx, m.history.tx, {
				hover: hover,
				total: m.seriesLen,
				spanSec: span,
				windowSec: WINDOW
			});
			canvas._geo = geo;

			var shown = geo.full ? WINDOW : span;
			if (meta) meta.textContent = geo.full ? "近 5 分钟" : "已采集 " + spanLabel(shown);

			marks.forEach(function (el2, i) {
				if (shown < 6) {
					el2.textContent = i === 5 ? "现在" : "";
					return;
				}
				el2.textContent = i === 5 ? "现在" : "−" + spanLabel((shown * (5 - i)) / 5);
			});
		}

		box.addEventListener("mousemove", function (e) {
			var geo = canvas._geo;
			if (!geo || geo.n < 2) return;
			var rect = box.getBoundingClientRect();
			var x = e.clientX - rect.left;
			var idx = Math.round((x - geo.x0) / geo.xStep);
			idx = Math.max(0, Math.min(geo.n - 1, idx));
			var ago = (geo.span * (geo.n - 1 - idx)) / Math.max(1, geo.n - 1);
			var when = ago < 3 ? "现在" : ago < 60 ? Math.round(ago) + " 秒前" : Math.round(ago / 60) + " 分钟前";
			tip.innerHTML =
				"<b>" +
				when +
				"</b><br>↓ " +
				fmtRate(m.history.rx[idx] || 0) +
				"<br>↑ " +
				fmtRate(m.history.tx[idx] || 0);
			tip.style.left = Math.max(56, Math.min(geo.cssW - 56, x)) + "px";
			tip.classList.add("is-on");
			hover = idx;
			paint();
		});
		box.addEventListener("mouseleave", function () {
			tip.classList.remove("is-on");
			hover = null;
			paint();
		});

		c.paint = paint;
		requestAnimationFrame(paint);
		return c;
	}

	/* ------------------------------------------------------------ system */

	function meter(label, pct, right, sub, warnAt) {
		var w = el("div", "hd-meter");
		var top = el("div", "hd-meter-top");
		top.appendChild(el("span", "hd-meter-k", label));
		if (sub) top.appendChild(el("span", "hd-meter-sub", sub));
		top.appendChild(el("span", "hd-meter-v", right));
		w.appendChild(top);
		var track = el("div", "hd-track");
		var fill = el("i");
		fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
		if (pct >= (warnAt || 90)) fill.classList.add("is-bad");
		else if (pct >= (warnAt ? warnAt - 15 : 75)) fill.classList.add("is-warn");
		track.appendChild(fill);
		w.appendChild(track);
		return w;
	}

	function renderSystem(m) {
		var s = m.system;
		var c = card("hd-c-sys", "sys", "系统", null, "/cgi-bin/luci/admin/status/overview?raw=1", "原始视图 →");
		var meters = el("div", "hd-meters");
		meters.appendChild(meter("CPU", s.cpu || 0, (s.cpu || 0).toFixed(0) + "%", "", 90));
		meters.appendChild(
			meter("内存", s.memPct || 0, (s.memPct || 0).toFixed(0) + "%", (s.memUsed || 0).toFixed(0) + " / " + (s.memTotal || 0).toFixed(0) + " MB", 92)
		);
		meters.appendChild(
			meter("存储", s.storagePct || 0, (s.storagePct || 0).toFixed(0) + "%", (s.storageUsed || 0).toFixed(0) + " / " + (s.storageTotal || 0).toFixed(0) + " MB", 92)
		);
		c.body.appendChild(meters);

		var foot = el("div", "hd-sys-foot");
		[
			["负载", s.load ? s.load.map(function (x) { return x.toFixed(2); }).join("  ") : "—"],
			["运行", fmtUptime(s.uptime)],
			["内核", s.kernel || "—"]
		].forEach(function (r) {
			var kv = el("div", "hd-kv");
			kv.appendChild(el("span", "hd-kv-k", r[0]));
			kv.appendChild(el("span", "hd-kv-v", r[1]));
			foot.appendChild(kv);
		});
		c.body.appendChild(foot);

		var stats = el("div", "hd-stat-row");
		[
			["温度", s.temp != null ? s.temp + "°C" : "—"],
			["租约", s.leases != null ? s.leases : "—"],
			["负载", s.load ? s.load[0].toFixed(2) : "—"]
		].forEach(function (r) {
			var box = el("div", "hd-stat");
			box.appendChild(el("span", "hd-kv-k", r[0]));
			box.appendChild(el("span", "hd-stat-v", r[1]));
			stats.appendChild(box);
		});
		c.body.appendChild(stats);
		return c;
	}

	/* ------------------------------------------------------------ clients */

	function renderClients(m) {
		var c = card(
			"hd-c-cli",
			"cli",
			"客户端",
			m.clients.length + " 台在线",
			"/cgi-bin/luci/admin/network/dhcp",
			"全部 →"
		);
		c.body.classList.add("flush");
		var list = el("div", "hd-clients");
		if (!m.clients.length) {
			var empty = el("div", "hd-empty");
			empty.innerHTML =
				ICONS.cli +
				"<span>暂无客户端<br><a href=\"/cgi-bin/luci/admin/network/dhcp\">检查 DHCP 设置</a></span>";
			list.appendChild(empty);
		}
		m.clients.slice(0, 5).forEach(function (cl) {
			var row = el("div", "hd-client");
			row.appendChild(el("span", "hd-avatar", (cl.name || cl.ip || "?").slice(0, 2)));
			var main = el("div", "hd-client-main");
			var nm = el("div", "hd-client-name");
			nm.appendChild(el("span", null, truncate(cl.name || "未知设备", 20)));
			nm.appendChild(el("span", "hd-pill" + (cl.online === false ? "" : " is-ok"), cl.band || "有线"));
			main.appendChild(nm);
			var sub = el("div", "hd-client-sub");
			sub.appendChild(el("span", null, cl.ip || "—"));
			if (cl.mac) sub.appendChild(el("span", null, cl.mac.toUpperCase()));
			main.appendChild(sub);
			row.appendChild(main);
			var right = el("div", "hd-client-right");
			var showRate = cl.online !== false && cl.rate;
			right.appendChild(el("div", "hd-client-rate" + (showRate ? "" : " is-zero"), showRate ? fmtRate(cl.rate) : "空闲"));
			right.appendChild(
				el(
					"div",
					"hd-client-lease",
					cl.signal != null ? "信号 " + cl.signal + " dBm" : cl.lease != null ? fmtLease(cl.lease) : "静态"
				)
			);
			row.appendChild(right);
			list.appendChild(row);
		});
		c.body.appendChild(list);
		return c;
	}

	/* ------------------------------------------------------------ talkers */

	/* state comes from the collector:
	 *   ok      — per-host rates are available
	 *   pending — sampler healthy, first sample still on its way
	 *   idle    — sampled, but nothing on the LAN is moving bytes
	 *   off     — luci.halo (the rpcd sampler) is missing or not permitted */
	var TALK_TEXT = {
		pending: ["采样中", "正在采样客户端流量…"],
		idle: ["实时", "当前没有客户端流量"],
		off: ["未启用", "客户端流量采样不可用"]
	};

	function renderTalkers(m) {
		var state = m.talkerState || (m.talkers.length ? "ok" : "idle");
		var txt = TALK_TEXT[state] || ["实时", ""];
		var c = card(
			"hd-c-talk",
			"talk",
			"流量大户",
			txt[0],
			"/cgi-bin/luci/admin/status/realtime/bandwidth",
			"详情 →"
		);
		var wrap = el("div", "hd-talk");
		if (!m.talkers.length) {
			var idle = el("div", "hd-empty");
			idle.innerHTML =
				ICONS.talk +
				"<span>" +
				txt[1] +
				(state === "off"
					? "<br><a href=\"/cgi-bin/luci/admin/status/realtime/bandwidth\">查看实时流量</a>"
					: "") +
				"</span>";
			wrap.appendChild(idle);

			var lull = el("div", "hd-talk-foot");
			lull.appendChild(el("span", "hd-kv-k", "链路合计"));
			lull.appendChild(
				el("span", "hd-kv-v", fmtRate(m.rates.rx || 0) + " ↓ / " + fmtRate(m.rates.tx || 0) + " ↑")
			);
			wrap.appendChild(lull);
		}
		var max = 1;
		m.talkers.forEach(function (t) { max = Math.max(max, t.rate || 0); });
		m.talkers.slice(0, 4).forEach(function (t) {
			var row = el("div", "hd-talk-row");
			row.appendChild(el("div", "hd-talk-name", truncate(t.name || t.ip, 14)));
			row.appendChild(el("div", "hd-talk-val", fmtRate(t.rate || 0)));
			var bar = el("div", "hd-talk-bar");
			var fill = el("i");
			fill.style.width = Math.max(3, ((t.rate || 0) / max) * 100) + "%";
			bar.appendChild(fill);
			row.appendChild(bar);
			wrap.appendChild(row);
		});
		if (m.talkers.length) {
			var sum = m.talkers.reduce(function (a, t) { return a + (t.rate || 0); }, 0);
			var foot = el("div", "hd-talk-foot");
			foot.appendChild(el("span", "hd-kv-k", "合计"));
			foot.appendChild(el("span", "hd-kv-v", fmtRate(sum)));
			wrap.appendChild(foot);
		}
		c.body.appendChild(wrap);
		return c;
	}

	/* ------------------------------------------------------------ interfaces */

	function renderIfaces(m) {
		var c = card("hd-c-if", "iface", "接口", m.ifaces.length + " 个", "/cgi-bin/luci/admin/network/network", "网络 →");
		c.body.classList.add("flush");
		var list = el("div", "hd-ifaces");
		if (!m.ifaces.length) list.appendChild(el("div", "hd-empty", "无接口"));
		m.ifaces.slice(0, 5).forEach(function (f) {
			var row = el("div", "hd-iface");
			row.appendChild(el("span", "hd-iface-tag", f.tag || "IF"));
			row.appendChild(el("span", "hd-iface-name", f.name || f.tag));
			row.appendChild(el("span", "hd-iface-state", f.up === false ? "DOWN" : f.link ? fmtMbps(f.link) : "UP"));
			row.appendChild(el("span", "hd-iface-ip", f.ip || "未分配"));
			list.appendChild(row);
		});
		c.body.appendChild(list);
		return c;
	}

	/* ------------------------------------------------------------ mount */

	function paintSpark(canvas, series) {
		if (!canvas) return;
		var dpr = global.devicePixelRatio || 1;
		var w = canvas.clientWidth || 200;
		var h = canvas.clientHeight || 44;
		if (!w) return;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		var ctx = canvas.getContext("2d");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		var cs = getComputedStyle(document.documentElement);
		var slots = 60;
		var data = series.slice(-slots);
		var max = Math.max.apply(null, data.concat([1]));
		/* Spread whatever we have across the full width. Pinning a 9-sample
		 * series to the right edge of a 60-slot window drew a spike in the
		 * corner that looked like a rendering fault. */
		var span = Math.max(2, data.length);
		var dx = w / (span - 1);
		var x0 = 0;

		/* baseline so an idle link still reads as a chart, not a hole */
		ctx.beginPath();
		ctx.strokeStyle = cs.getPropertyValue('--halo-hairline').trim() || '#e0e4e2';
		ctx.lineWidth = 1;
		ctx.moveTo(0, h - 1.5);
		ctx.lineTo(w, h - 1.5);
		ctx.stroke();
		ctx.beginPath();
		ctx.setLineDash([2, 4]);
		ctx.moveTo(0, h / 2 + 0.5);
		ctx.lineTo(w, h / 2 + 0.5);
		ctx.stroke();
		ctx.setLineDash([]);

		if (data.length < 4) {
			/* barely started: a lone dot on the baseline, not a fake spike */
			ctx.beginPath();
			ctx.arc(w - 3, h - 3, 2, 0, Math.PI * 2);
			ctx.fillStyle = cs.getPropertyValue("--halo-rx").trim() || "#3a3f9e";
			ctx.fill();
			return;
		}

		ctx.beginPath();
		var started = false;
		data.forEach(function (v, i) {
			var x = x0 + i * dx;
			var y = h - 2 - ((h - 7) * v) / max;
			if (x < 0) return;
			if (!started) { ctx.moveTo(Math.max(0, x), y); started = true; }
			else ctx.lineTo(x, y);
		});
		ctx.strokeStyle = cs.getPropertyValue("--halo-rx").trim() || "#3a3f9e";
		ctx.lineWidth = 1.4;
		ctx.lineJoin = "round";
		ctx.stroke();
		ctx.lineTo(w, h);
		ctx.lineTo(Math.max(0, x0), h);
		ctx.closePath();
		var grad = ctx.createLinearGradient(0, 0, 0, h);
		grad.addColorStop(0, cs.getPropertyValue("--halo-rx-soft").trim() || "rgba(58,63,158,.13)");
		grad.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = grad;
		ctx.fill();
	}

	function render(root, model) {
		var m = normalize(model);
		root.innerHTML = "";
		var grid = el("div", "hd");

		var vitals = renderVitals(m);
		grid.appendChild(vitals.root);
		grid.appendChild(renderTopology(m).root);
		grid.appendChild(renderFlux(m).root);
		grid.appendChild(renderSystem(m).root);
		grid.appendChild(renderClients(m).root);
		grid.appendChild(renderIfaces(m).root);
		grid.appendChild(renderTalkers(m).root);
		root.appendChild(grid);

		paintSpark(vitals.spark, m.history.rx);

		return {
			update: function (next) { return render(root, next); }
		};
	}

	global.HaloDash = {
		render: render,
		fmt: { rate: fmtRate, bytes: fmtBytes, uptime: fmtUptime, mbps: fmtMbps }
	};
})(window);
