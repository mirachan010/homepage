const THEME_STORAGE_KEY = "mirachan-theme";

window.addEventListener("DOMContentLoaded", () => {
  applyInitialTheme();
  setupThemeButton();
});

function applyInitialTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);

  if (savedTheme === "light" || savedTheme === "dark") {
    setTheme(savedTheme, false);
    return;
  }

  document.documentElement.removeAttribute("data-theme");
  updateThemeLabel("auto");
}

function setupThemeButton() {
  const button = document.getElementById("themeToggle");

  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    const current = getCurrentThemeMode();

    if (current === "auto") {
      setTheme(getBrowserTheme() === "dark" ? "light" : "dark", true);
      return;
    }

    if (current === "light") {
      setTheme("dark", true);
      return;
    }

    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute("data-theme");
    updateThemeLabel("auto");
  });
}

function getCurrentThemeMode() {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "auto";
}

function getBrowserTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function setTheme(theme, shouldSave) {
  document.documentElement.dataset.theme = theme;

  if (shouldSave) {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }

  updateThemeLabel(theme);
}

function updateThemeLabel(theme) {
  const label = document.getElementById("themeLabel");

  if (!label) {
    return;
  }

  label.textContent = theme === "auto" ? `auto(${getBrowserTheme()})` : theme;
}
