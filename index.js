const id = (id) => document.getElementById(id);
/** @param tag { string } */
const make = (tag) => document.createElement(tag);
const add = (el, ...cl) => void el.classList.add(...cl);
const remove = (el, ...cl) => void el.classList.remove(...cl);
const append = (el, ...ch) => void el.append(...ch.flat());
const attr = (el, at) => void Object.assign(el, at);
const style = (el, st) =>
  void (st ? attr(el.style, st) : el.removeAttribute("style"));

const textEncoder = new TextEncoder();
const encodeUTF8 = (str) => textEncoder.encode(str);
const textDecoder = new TextDecoder();
const decodeUTF8 = (str) => textDecoder.decode(str);

const hexlify = (arr) =>
  Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
const unhexlify = (hex) =>
  Uint8Array.from(hex.match(/../g), (byte) => parseInt(byte, 16));
const base64decode = (b64) =>
  Uint8Array.from(atob(b64), (x) => x.charCodeAt(0));
const base64encode = (arr) => btoa(String.fromCharCode(...arr));

const arrEq = (a, b) => {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const clamp = (t, a, b) => (t < a ? a : t > b ? b : t);

const err = (str) => {
  // TODO: graceful error handling
  throw new Error(str);
};

const charForByte = (b) =>
  b < 0x20
    ? // https://en.wikipedia.org/wiki/Control_Pictures
      String.fromCharCode(0x2400 | b)
    : b <= 0x7e
      ? String.fromCharCode(b)
      : ".";

const confirmMatch = (idx) => {
  const match = matches[idx];
  console.assert(match.status !== "confirmed");
  match.status = "confirmed";

  matches.splice(idx, 1);

  matches.forEach((otherMatch, idx) => {
    if (
      otherMatch.start >= match.start &&
      otherMatch.start + otherMatch.crib.length <=
        match.start + match.crib.length
    ) {
      // otherMatch is completely contained within this match; remove it
      removeMatch(idx);
    }
  });

  matches.splice(numConfirmedMatches, 0, match);
  numConfirmedMatches++;
};
const removeMatch = (idx) => {
  const match = matches[idx];
  matches.splice(idx, 1);
  if (match.status === "confirmed") numConfirmedMatches--;
};
const recalculateKeyForMatch = (match) => {
  const ct = ciphertexts[match.ct].bytes;
  const start = match.start;
  match.key = xor(ct.subarray(start, start + match.crib.length), match.crib);
};

let undoStack = [];
let undoStackPos = 0;

const clearUndoStack = () => {
  undoStack = [];
  undoStackPos = 0;
};

const serializeState = () => {
  const serialized = {
    ciphertexts: ciphertextsTextarea.value,
    crib: base64encode(crib),
    validFilter: validFilter.el.value,
    acceptableFilter: acceptableFilter.el.value,
    matches: matches.slice(0, numConfirmedMatches).map((match) => ({
      crib: base64encode(match.crib),
      ct: match.ct,
      start: match.start,
    })),
  };

  const str = JSON.stringify(serialized);
  // too lazy to deep equals properly
  if (str === undoStack[undoStackPos - 1]) return;

  localStorage.setItem("state", str);
  location.hash = "#";

  undoStack.length = undoStackPos;
  undoStack.push(str);
  undoStackPos++;
};
const deserializeState = (json) => {
  const deserialized = JSON.parse(json);

  crib = base64decode(deserialized.crib);
  cribInput.value = decodeUTF8(crib);

  validFilter.el.value = deserialized.validFilter;
  validFilter.update();
  acceptableFilter.el.value = deserialized.acceptableFilter;
  acceptableFilter.update();

  ciphertextsTextarea.value = deserialized.ciphertexts;
  refreshCiphertexts();

  matches = deserialized.matches.map((data) => {
    const match = {
      crib: base64decode(data.crib),
      key: null,
      ct: data.ct,
      start: data.start,
      status: "confirmed",
    };
    recalculateKeyForMatch(match);
    return match;
  });

  numConfirmedMatches = matches.length;
};

addEventListener("keydown", (e) => {
  if (e.key === "z" && e.ctrlKey) {
    // undo
    if (undoStackPos > 0) {
      deserializeState(undoStack[--undoStackPos - 1]);
      rerender();
    }
  } else if (e.key === "Z" && e.ctrlKey && e.shiftKey) {
    // redo
    if (undoStackPos < undoStack.length) {
      deserializeState(undoStack[undoStackPos++]);
      rerender();
    }
  } else return;

  drags.clear();

  e.preventDefault();
  e.stopImmediatePropagation();
});

const main = id("main");
const ciphertextsTextarea = id("ciphertexts");
const mainTablesEl = id("main-tables");
const cribInput = id("crib-input");

for (const input of document.querySelectorAll("input, textarea")) {
  input.addEventListener("focus", () => {
    input.select();
  });
}

let bytesPerTable = null;
/** @type {{
  el: HTMLTableElement,
  trs: HTMLTableRowElement,
  deco: HTMLElement,
  container: HTMLElement,
  numHeaderRows: number,
}[]} */
let tables = [];
const handleResize = () => {
  const dummy = make("div");
  add(dummy, "dummy");
  mainTablesEl.appendChild(dummy);

  const elWidth = dummy.getBoundingClientRect().width;
  const totalWidth = mainTablesEl.getBoundingClientRect().width;

  dummy.remove();

  const newBytesPerTable = Math.max((totalWidth / elWidth) | 0, 1);
  if (bytesPerTable === newBytesPerTable) return;
  bytesPerTable = newBytesPerTable;

  remakeTables();
};
const remakeTables = () => {
  tables = [];
  mainTablesEl.replaceChildren();

  for (let idx = 0; idx < keyLength; idx += bytesPerTable) {
    const tableContainer = make("div");
    add(tableContainer, "main-table-container");

    const tableAlign = make("div");
    add(tableAlign, "main-table-align");

    const table = make("table");

    const trs = [];
    ciphertexts.forEach((ciphertext, ct) => {
      const tr = make("tr");
      tr.dataset.ct = ct;
      // .slice automatically clamps its args so this is fine
      append(tr, ciphertext.tds.slice(idx, idx + bytesPerTable));
      trs.push(tr);
    });
    append(table, trs);

    const deco = make("div");
    add(deco, "main-table-deco");
    append(tableAlign, table, deco);
    append(tableContainer, tableAlign);

    tables.push({
      el: table,
      trs,
      deco,
      container: tableContainer,
      // A persistent number of header rows that this table has. This is calculated every rerender except when the user is dragging stuff.
      numHeaderRows: 0,
    });

    append(mainTablesEl, tableContainer);
  }
};
addEventListener("load", () => void handleResize());
addEventListener("resize", () => {
  handleResize();
  rerender();
});

const makeRegexFilterInput = (i) => {
  const inputEl = id(i);
  let filter = Array(256).fill(false);
  const updateValidRange = () => {
    let regex;
    try {
      regex = new RegExp(inputEl.value || inputEl.placeholder);
    } catch (e) {
      let match;
      if (
        e instanceof SyntaxError &&
        (match = e.message.match(/^Invalid regular expression: (.*)$/))
      )
        return err(match[1]);
    }

    for (let b = 0; b < 256; b++)
      filter[b] = regex.test(String.fromCharCode(b));
  };
  inputEl.addEventListener("input", () => {
    updateValidRange();
    rerender();
  });

  addEventListener("load", () => updateValidRange());

  filter.el = inputEl;
  filter.update = updateValidRange;

  return filter;
};

const validFilter = makeRegexFilterInput("valid-range");
const acceptableFilter = makeRegexFilterInput("acceptable-range");

/** @type {{
  bytes: Uint8Array,
  tds: HTMLElement[],
}[]} */
let ciphertexts = [];

/** @type { Uint8Array } */
let crib = encodeUTF8(" the ");

cribInput.addEventListener("input", () => {
  // TODO: support for non-utf8 stuff (like >0x80 bytes)
  const newCrib = encodeUTF8(cribInput.value);

  crib = newCrib;

  rerender();
});
cribInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const possibleMatches = matches.slice(numConfirmedMatches);
    if (possibleMatches.length !== 0) {
      while (matches.length !== numConfirmedMatches)
        confirmMatch(numConfirmedMatches);

      cribInput.value = "";
      crib = new Uint8Array();

      rerender();
      serializeState();
    }
  }
});

// the confirmed matches are always at the start of the array
let matches = [];
let numConfirmedMatches = 0;

let keyLength;

let lastContent = "";
const refreshCiphertexts = () => {
  /** @type { string } */
  let content = ciphertextsTextarea.value;
  const chars = new Set(content);
  let sep;
  if (chars.has("\n")) sep = "\n";
  else if (chars.has(",")) sep = ",";

  content = content.replaceAll(sep, "\n");

  if (content === lastContent) return;
  lastContent = content;

  ciphertexts = content
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length !== 0)
    .map((str) => {
      let bytes;
      if (/^([a-z0-9]+|[A-Z0-9]+)$/.test(str)) bytes = unhexlify(str);
      else if (/^[A-Za-z0-9+/=]+$/.test(str)) bytes = base64decode(str);
      else return err(`hex ${str} isn't hex or base64`);

      const tds = Array(bytes.length)
        .fill("td")
        .map((t) => make(t));
      return { bytes, tds };
    });

  keyLength = Math.max(...ciphertexts.map((hex) => hex.bytes.length));

  remakeTables();

  rerender();
};
ciphertextsTextarea.addEventListener("input", refreshCiphertexts);

addEventListener("load", () => {
  const stateJSON = localStorage.getItem("state");
  if (!stateJSON) return;

  deserializeState(stateJSON);

  undoStack = [stateJSON];
  undoStackPos = 1;

  rerender();
});

const xor = (a, b) => a.map((x, i) => x ^ b[i]);

const calculateKey = (matches) => {
  const out = new Uint8Array(keyLength);
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    if (match.status === "new") continue;
    if (match.start >= out.length) continue;

    out.set(match.key, match.start);
  }
  return out;
};

let lastRenderedCrib;

const recalculateMatches = () => {
  matches.length = numConfirmedMatches;

  const confirmedKey = calculateKey(matches);
  const taken = new Set();

  if (crib.length !== 0) {
    // O(n^2 * m) les gooooooooooo
    for (let start = 0; start <= keyLength - crib.length; start++) {
      for (let ct1idx = 0; ct1idx < ciphertexts.length; ct1idx++) {
        const ct = ciphertexts[ct1idx].bytes;
        if (start + crib.length > ct.length) continue;

        // check crib for ciphertext 1 starting at index i
        const key = xor(ct.subarray(start, start + crib.length), crib);

        // if the key is already fully covered by other matches, no need to check it; it definitely is valid but it'll be useless
        if (arrEq(key, confirmedKey.subarray(start, start + crib.length)))
          continue;

        // if the key conflicts with the confirmed key, it's guaranteed to be invalid
        if (
          !confirmedKey
            .subarray(start, start + crib.length)
            .every((x, i) => x === 0 || x === key[i])
        )
          continue;

        // heuristic value for how likely the key is to be valid
        let hp = crib.length;
        let numCt = 0;

        // for each ciphertext
        bad: for (const hex of ciphertexts) {
          const otherCt = hex.bytes;
          // that is not the current ciphertext
          if (ct === otherCt) continue;
          // and is long enough
          if (start + crib.length > otherCt.length) continue;

          numCt++;

          // assuming the key is valid, this will decode into valid plaintext
          const plain = xor(key, otherCt.subarray(start, start + crib.length));

          let allOk = true;
          for (let i = 0; i < plain.length; i++) {
            // if the confirmed key matches with the current key, skip this char; it's already valid
            if (confirmedKey[start + i] === key[i]) continue;

            const b = plain[i];

            if (validFilter[b]) {
              // it's valid! cool!
            } else if (acceptableFilter[b]) {
              // a byte that is rare in valid text has appeared (e.g. a @, ^, or #)
              // these are sometimes in flags, but if too many of these exist then it's probably not valid
              hp -= 5;
              allOk = false;
            } else {
              // a byte that should never appear in valid text has appeared (e.g. a null byte) so there is no way this crib is valid at this position
              hp = 0;
              // jesse we need to drag the cribs
              break bad;
            }
          }

          // add a little bonus to the heuristic if all the text is valid
          if (allOk) hp += 0.3;
        }

        if (numCt <= 1) continue;

        if (hp > 0) {
          // we have a match!
          matches.push({
            crib,
            key,
            ct: ct1idx,
            start: start,
            status: "possible",
          });

          // whether a given start position is taken, we don't want another one starting at that exact position; break early in this case
          break;
        }
      }
    }

    if (matches.length === numConfirmedMatches && cribInput.value) {
      // there are no new possible matches! assume the user wants to insert a new match at the end; insert a fake one
      matches.push({
        crib,
        key: new Uint8Array(crib.length),
        ct: 0,
        start: keyLength,
        status: "new",
      });
    }
  }
};

const rerender = () => {
  if (ciphertexts.length === 0) return err("No ciphertexts!");

  if (!arrEq(lastRenderedCrib, crib)) {
    recalculateMatches();
  }

  const rootKey = calculateKey(matches);

  for (const hex of ciphertexts) {
    for (let i = 0; i < hex.bytes.length; i++) {
      const b = hex.bytes[i] ^ rootKey[i];
      const el = hex.tds[i];
      el.textContent = charForByte(b);

      el.className =
        b === 0
          ? "xn"
          : b === 0xff
            ? "xf"
            : validFilter[b]
              ? "xt"
              : acceptableFilter[b]
                ? "xw"
                : "xi";

      // el.title =
      //   b <= 0x7e
      //     ? `'${ch}' 0x${b.toString(16).padStart(2, "0")}`
      //     : `0x${b.toString(16).padStart(2, "0")}`;
    }
  }

  const sortedMatches = matches
    .map((match, i) => [match, i])
    .sort((a, b) => a[0].start - b[0].start);

  /* @type { number[][] } */
  const headerRowsPerTable = tables.map((table) =>
    drags.size === 0 ? [] : Array(table.numHeaderRows),
  );

  const decosPerTable = tables.map((_) => []);

  sortedMatches.forEach(([match, idx]) => {
    for (
      let tableIdx = (match.start / bytesPerTable) | 0;
      tableIdx < Math.ceil((match.start + match.crib.length) / bytesPerTable);
      tableIdx++
    ) {
      const headerRows = headerRowsPerTable[tableIdx];
      let headerIdx = 0;
      for (; headerIdx < headerRows.length; headerIdx++)
        if (headerRows[headerIdx] <= match.start) break;

      headerRows[headerIdx] = match.start + match.crib.length;

      const deco = make("div");
      add(deco, "deco");
      deco.dataset.idx = idx;

      if (match.status) add(deco, "deco-" + match.status);

      const headerHeight = headerIdx * 1.1 + 1 + "lh";
      style(deco, {
        left: match.start - tableIdx * bytesPerTable + "ch",
        width: `calc(${match.crib.length}ch - 1px)`,
        top: "-" + headerHeight,
        paddingTop: headerHeight,
      });

      const label = make("span");
      add(label, "deco-label");
      label.textContent =
        match.status === "new"
          ? "Add new?"
          : decodeUTF8(match.crib).replaceAll(" ", "␣");
      append(deco, label);

      const indicator = make("div");
      add(indicator, "deco-indicator");

      if (match.status === "new")
        indicator.textContent = Array.from(crib, charForByte).join("");

      style(indicator, {
        top: match.ct + "lh",
      });
      append(deco, indicator);

      decosPerTable[tableIdx].push({ deco, status: match.status });
    }
  });

  tables.forEach((table, tableIdx) => {
    style(table.container, {
      paddingTop: headerRowsPerTable[tableIdx].length + 1 + "lh",
    });

    // order the possible decos above the confirmed decos because the user most likely wants to click on the possible ones instead of the confirmed ones
    const STATUS_KEY = {
      confirmed: 0,
      possible: 1,
      new: 2,
    };
    decosPerTable[tableIdx].sort(
      (a, b) => STATUS_KEY[a.status] - STATUS_KEY[b.status],
    );

    table.deco.replaceChildren(...decosPerTable[tableIdx].map((x) => x.deco));

    table.numHeaderRows = headerRowsPerTable[tableIdx].length;
  });
};
addEventListener("load", async () => {
  const el = id("ciphertexts-presets");

  const presets = PRESETS; //await (await fetch("./dist.json")).json();

  for (const [key, ciphertexts] of Object.entries(presets)) {
    const button = make("button");
    button.textContent = key;
    button.addEventListener("click", () => {
      ciphertextsTextarea.value = ciphertexts.join("\n");
      clearUndoStack();
      refreshCiphertexts();
    });
    append(el, button);
    // TODO remove
    // if (key === "minecraft") button.click();
  }
});

id("ciphertexts-clear").addEventListener("click", () => {
  ciphertextsTextarea.value = "";
  refreshCiphertexts();
});
id("main-table-clear").addEventListener("click", () => {
  matches = [];
  numConfirmedMatches = 0;
  rerender();
});

const clickHandler = (e) => {
  const closest = e.target.closest(".deco");
  if (!closest) return;

  const idx = +closest.dataset.idx;
  const match = matches[idx];

  if (e.button === 0 && match.status !== "confirmed") {
    confirmMatch(idx);
  } else if (e.button === 2) {
    removeMatch(idx);
  } else return;

  rerender();
  serializeState();
  e.preventDefault();
};

document.body.addEventListener("click", clickHandler);
document.body.addEventListener("contextmenu", clickHandler);

document.body.addEventListener("keydown", (e) => {
  if (e.key === "/" && e.target !== cribInput) {
    cribInput.focus();
    e.preventDefault();
  }
});

// row highlight behavior
let prevHighlightedCt = null;
const handleCtHighlight = (e) => {
  const row = e.target.closest("tr[data-ct]");
  const ct = row ? +row.dataset.ct : null;

  if (ct === prevHighlightedCt) return;

  for (const table of tables) {
    if (table.trs[prevHighlightedCt])
      table.trs[prevHighlightedCt].classList.remove("highlight");
    if (table.trs[ct]) table.trs[ct].classList.add("highlight");
  }

  prevHighlightedCt = ct;
};

///////////////////////////////////

const drags = new Map();

const dragStart = (id, data, e) => {
  if (!e.cancelable) return;

  const targetEl = data.target.closest(".deco-indicator, .deco-label");
  if (!targetEl) return;
  const el = targetEl.parentElement;

  const idx = +el.dataset.idx;
  const match = matches[idx];

  if (match.status !== "confirmed") {
    confirmMatch(idx);
    rerender();
  }

  drags.set(id, {
    sx: data.pageX,
    sy: data.pageY,

    match,
    idx,
    start: match.start,
    ct: match.ct,
  });
  e.preventDefault();

  // https://stackoverflow.com/questions/33298828/touch-move-event-dont-fire-after-touch-start-target-is-removed
  e.target.addEventListener("touchmove", onTouchMove);
  e.target.addEventListener("touchend", onTouchEnd);
};

const dragMove = (id, data, e) => {
  handleCtHighlight(e);

  // matches behavior

  const entry = drags.get(id);

  if (!e.cancelable || !entry) {
    return;
  }

  const match = entry.match;

  const dx = data.pageX - entry.sx;
  const dy = data.pageY - entry.sy;

  const cellBox = mainTablesEl.querySelector("td").getBoundingClientRect();

  const newStart = clamp(
    entry.start + Math.round(dx / cellBox.width),
    0,
    keyLength,
  );
  const newCt = clamp(
    entry.ct + Math.round(dy / cellBox.height),
    0,
    ciphertexts.length - 1,
  );
  if (match.start === newStart && match.ct === newCt) return;

  match.start = newStart;
  match.ct = newCt;
  recalculateKeyForMatch(match);

  rerender();

  e.preventDefault();
};
const dragEnd = (id, e) => {
  if (drags.delete(id)) {
    if (e.cancelable) e.preventDefault();

    e.target.removeEventListener("touchmove", onTouchMove);
    e.target.removeEventListener("touchend", onTouchEnd);

    rerender();
    serializeState();
  }
};

document.body.addEventListener("mousedown", (e) => {
  dragStart("m", e, e);
});
document.body.addEventListener("mousemove", (e) => {
  dragMove("m", e, e);
});
document.body.addEventListener("mouseup", (e) => {
  dragEnd("m", e);
});

const onTouchStart = (e) => {
  for (const touch of e.changedTouches) {
    dragStart(touch.identifier, touch, e);
  }
};
const onTouchMove = (e) => {
  for (const touch of e.changedTouches) {
    dragMove(touch.identifier, touch, e);
  }
};
const onTouchEnd = (e) => {
  for (const touch of e.changedTouches) {
    dragEnd(touch.identifier, e);
  }
};

document.body.addEventListener("touchstart", onTouchStart, { passive: false });
document.body.addEventListener("touchmove", onTouchMove, { passive: false });
document.body.addEventListener("touchend", onTouchEnd, { passive: false });

////////////////////////

const shareButton = id("share-button");
shareButton.addEventListener("click", async () => {
  let state = localStorage.getItem("state") || "{}";

  // https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API#examples
  const blob = new Blob([encodeUTF8(state)]);
  const compressed = blob
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const data = await new Response(compressed).arrayBuffer();
  const hash = base64encode(new Uint8Array(data));

  location.hash = hash;
  navigator.clipboard.writeText(location.href);

  shareButton.textContent = "Copied!";
  setTimeout(() => void (shareButton.textContent = "Share"), 1000);
});
const decodeHash = async () => {
  const hash = location.hash.replace(/^#/, "").trim();
  if (!hash) return;

  const blob = new Blob([base64decode(hash)]);
  const decompressed = blob
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const data = new Uint8Array(await new Response(decompressed).arrayBuffer());
  const state = decodeUTF8(data);

  deserializeState(state);
  rerender();
};
addEventListener("load", () => void decodeHash());
addEventListener("hashchange", () => void decodeHash());
