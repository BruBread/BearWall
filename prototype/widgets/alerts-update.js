// Alerts · Update: shows the installed version; a newer BearWall on GitHub becomes an alert (from the runtime's update check).
(function () {
const ICON = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 6v18M12 16l8 8 8-8M8 32h24"/></svg>';
BearWall.register(BearWall.alertModule('update', 'alerts-update', 'Update', 'Update', {
  icon: ICON,
  idle: ctx => {
    const u = ctx.system.update || {};
    return u.state === 'current' ? { title: 'Up to date', detail: `BearWall ${u.sha.slice(0, 7)}` }
      : u.state === 'checking' ? { title: 'Checking for updates…', detail: 'GitHub · BruBread/BearWall' }
      : { title: 'Up to date?', detail: "Can't reach GitHub from here" };
  },
  alert: ctx => {
    const u = ctx.system.update || {};
    return u.state === 'available' && { id: 'update', level: 'info', title: 'Update available', detail: `${u.sha.slice(0, 7)} · ${u.msg}` };
  }
}));
})();
