// A small, dependency-free markdown renderer for README.md. We write the
// README, so we control exactly which markdown it uses — full CommonMark
// compliance would buy nothing a few hundred extra lines of edge cases
// couldn't, so this covers only what the README actually uses: headings,
// paragraphs, lists, blockquotes, fenced code, bold/italic/inline code,
// links and a horizontal rule.
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Inline formatting, applied to already-escaped text so a literal `<` in the
// README can never become a tag.
function inline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![*\w])\*([^*]+)\*(?!\w)/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
      const safeHref = /^(https?:|\/|#)/.test(href) ? href : "#";
      return `<a href="${safeHref}">${label}</a>`;
    });
}

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;
  let listType = null; // 'ul' | 'ol' | null

  function closeList() {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^ {0,3}```/.test(line)) {
      closeList();
      const code = [];
      i++;
      while (i < lines.length && !/^ {0,3}```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      i++;
      continue;
    }

    if (/^ {0,3}(-{3,}|\*{3,})\s*$/.test(line)) {
      closeList();
      html.push("<hr>");
      i++;
      continue;
    }

    const quote = line.match(/^ {0,3}>\s?(.*)$/);
    if (quote) {
      closeList();
      const body = [quote[1]];
      i++;
      while (i < lines.length && lines[i].match(/^ {0,3}>\s?(.*)$/)) {
        body.push(lines[i].match(/^ {0,3}>\s?(.*)$/)[1]);
        i++;
      }
      html.push(`<blockquote><p>${inline(escapeHtml(body.join(" ")))}</p></blockquote>`);
      continue;
    }

    const unordered = line.match(/^ {0,3}[-*]\s+(.*)$/);
    const ordered = line.match(/^ {0,3}\d+\.\s+(.*)$/);
    if (unordered || ordered) {
      const wantType = unordered ? "ul" : "ol";
      if (listType !== wantType) {
        closeList();
        html.push(`<${wantType}>`);
        listType = wantType;
      }
      const item = (unordered ?? ordered)[1];
      html.push(`<li>${inline(escapeHtml(item))}</li>`);
      i++;
      continue;
    }

    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    // A paragraph: consume lines until a blank one or a block-starting line.
    closeList();
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^ {0,3}(#{1,6})\s|^ {0,3}```|^ {0,3}[-*]\s|^ {0,3}\d+\.\s|^ {0,3}>/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    html.push(`<p>${inline(escapeHtml(para.join(" ")))}</p>`);
  }
  closeList();
  return html.join("\n");
}
