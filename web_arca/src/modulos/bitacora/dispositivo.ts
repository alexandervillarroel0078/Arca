/** "Chrome en Windows" a partir del user-agent (que es largo e ilegible). Si no se reconoce, se recorta. */
export function resumenDispositivo(ua: string | null | undefined): string {
  if (!ua) return "";
  const navegador = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const sistema = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux|X11/.test(ua) ? "Linux" : "";
  if (navegador && sistema) return `${navegador} en ${sistema}`;
  if (navegador || sistema) return navegador || sistema;
  const primero = ua.split(" ")[0]; // p. ej. "curl/8.0" o "Playwright/1.49.1"
  return primero.length > 40 ? `${primero.slice(0, 40)}...` : primero;
}
