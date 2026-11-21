// Alerts · Wi-Fi devices: how many devices are on your Wi-Fi; an unknown one joining becomes an alert.
// The projector app finds them in Phase 1 (ping sweep + neighbor table + hardware-address brand + mDNS names).
(function () {
const U = BearWall.util;
const ICON = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 15a22 22 0 0 1 30 0M10 21a14 14 0 0 1 20 0M15 27a7 7 0 0 1 10 0"/><circle cx="20" cy="32" r="1.6"/></svg>';
BearWall.register(BearWall.alertModule('wifi', 'alerts-wifi', 'Wi-Fi devices', 'Wi-Fi devices', {
  icon: ICON,
  idle: ctx => {
    const d = ctx.system.wifi, last = d.filter(x => x.known).slice(-1)[0];
    return { title: `${d.length} devices on Wi-Fi`, detail: last ? `All known · ${last.name} (${last.vendor})` : 'All known' };
  },
  alert: ctx => {
    const n = ctx.system.wifi.filter(x => !x.known).slice(-1)[0];
    return n && { id: 'wifi-' + n.name, level: 'info', title: `New device: ${n.name}`, detail: `${n.vendor} · joined ${U.ago(n.since)}` };
  }
}));
})();
