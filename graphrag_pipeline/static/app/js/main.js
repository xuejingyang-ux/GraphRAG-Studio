document.addEventListener("DOMContentLoaded", async () => {
  initParticles();
  initGlobalSearch();
  $("#sidebar-toggle")?.addEventListener("click", () => $("#sidebar")?.classList.toggle("open"));
  window.addEventListener("hashchange", navigate);
  if (!location.hash) {
    location.hash = "#/dashboard";
  } else {
    await navigate();
  }
  await refreshShellStats();
  setInterval(refreshShellStats, 10000);
});
