"use strict";

/*!
 * BBCode <-> HTML conversion for the description preview.
 * Supports the subset used by UNIT3D trackers.
 */

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};
function escapeHtml(text) {
  return String(text || "").replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

function bbcodeToHtml(bb) {
  let html = String(bb || "");

  // Escape raw HTML first so user text is safe.
  html = escapeHtml(html);

  // [b]...[/b]
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>");
  // [i]...[/i]
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>");
  // [u]...[/u]
  html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>");
  // [s]...[/s]
  html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, "<strike>$1</strike>");
  // [url=...]...[/url] and [url]...[/url]
  html = html.replace(/\[url=(.*?)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" rel="noopener noreferrer" target="_blank">$2</a>');
  html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" rel="noopener noreferrer" target="_blank">$1</a>');
  // [img]...[/img] and [img=WIDTH]...[/img]
  html = html.replace(/\[img=(\d+)\]([\s\S]*?)\[\/img\]/gi, '<img src="$2" width="$1" style="max-width:100%;height:auto;" alt="image">');
  html = html.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '<img src="$1" style="max-width:100%;height:auto;" alt="image">');
  // [quote]...[/quote]
  html = html.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, "<blockquote>$1</blockquote>");
  // [code]...[/code]
  html = html.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, "<pre><code>$1</code></pre>");
  // [color=...]...[/color]
  html = html.replace(/\[color=(.*?)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1">$2</span>');
  // [size=...]...[/size]
  html = html.replace(/\[size=(.*?)\]([\s\S]*?)\[\/size\]/gi, '<span style="font-size:$1">$2</span>');
  // [list]...[/list] and [*]
  html = html.replace(/\[\*\]([\s\S]*?)(?=\[\*\]|\[\/list\]|$)/gi, "<li>$1</li>");
  html = html.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, "<ul>$1</ul>");
  // Newlines -> <br>
  html = html.replace(/\n/g, "<br>\n");

  return html;
}

function htmlToBbcode(html) {
  let bb = String(html || "");

  bb = bb.replace(/<br\s*\/?>\n?/gi, "\n");
  bb = bb.replace(/<\/p>/gi, "\n");
  bb = bb.replace(/<\/div>/gi, "\n");
  bb = bb.replace(/<\/li>/gi, "\n");

  // <strong> / <b>
  bb = bb.replace(/<\/?(strong|b)>/gi, "[b]");
  // <em> / <i>
  bb = bb.replace(/<\/?(em|i)>/gi, "[i]");
  // <u>
  bb = bb.replace(/<\/?u>/gi, "[u]");
  // <strike>
  bb = bb.replace(/<\/?strike>/gi, "[s]");

  // <a href="...">...text...</a>
  bb = bb.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[url=$1]$2[/url]");
  // bare <a href="..."> (self-contained)
  bb = bb.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*\/?>/gi, "[url=$1]$1[/url]");

  // <img src="..." [width="N"]>
  bb = bb.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*width=["'](\d+)["'][^>]*\/?>/gi, "[img=$2]$1[/img]");
  bb = bb.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, "[img]$1[/img]");

  // <blockquote>
  bb = bb.replace(/<\/?blockquote>/gi, "[quote]");
  // <pre><code> / </code></pre>
  bb = bb.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, "[code]$1[/code]");
  bb = bb.replace(/<\/?pre>/gi, "");
  bb = bb.replace(/<\/?code>/gi, "");

  // <span style="color:X">...</span>
  bb = bb.replace(/<span\s+[^>]*color=["']([^"']+)["'][^>]*>([\s\S]*?)<\/span>/gi, "[color=$1]$2[/color]");
  // <span style="font-size:X">...</span>
  bb = bb.replace(/<span\s+[^>]*font-size=["']([^"']+)["'][^>]*>([\s\S]*?)<\/span>/gi, "[size=$1]$2[/size]");

  // Strip remaining HTML tags.
  bb = bb.replace(/<[^>]*>/g, "");

  // Unescape entities we produced.
  const unescape = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'" };
  bb = bb.replace(/&amp;|&lt;|&gt;|&quot;|&#039;/g, (ch) => unescape[ch]);

  return bb;
}

module.exports = { bbcodeToHtml, htmlToBbcode, escapeHtml };
