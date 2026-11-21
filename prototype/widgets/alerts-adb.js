// Alerts · ADB: the projector's debug port only accepts your PC's key; anything else connecting is a warning.
(function () {
const U = BearWall.util;
const LOCK = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="9" y="18" width="22" height="16" rx="3"/><path d="M14 18v-5a6 6 0 0 1 12 0v5M20 25v3"/></svg>';
BearWall.register(BearWall.alertModule('adb', 'alerts-adb', 'ADB', 'ADB', {
  icon: LOCK,
  idle: ctx => ({ title: 'ADB locked', detail: `Only your PC can connect · checked ${U.ago(ctx.system.adb.checkedAt)}` }),
  alert: ctx => ctx.system.adb.unknown > 0 && { id: 'adb', level: 'warning', title: 'New ADB connection', detail: 'Something connected to the debug port' }
}));
})();
