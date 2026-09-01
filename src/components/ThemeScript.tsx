// Runs before paint to avoid a light/dark flash. Reads the stored
// preference; falls back to the OS preference.
export function ThemeScript() {
  const code = `
    (function () {
      try {
        var stored = localStorage.getItem('nexora-theme');
        var theme = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        if (theme === 'dark') document.documentElement.classList.add('dark');
      } catch (e) {}
    })();
  `;
  // eslint-disable-next-line react/no-danger
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
