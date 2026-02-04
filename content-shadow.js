(async () => {
  // ---------------- UI overlay ----------------
  const overlayHost = document.createElement("div");
  overlayHost.style.cssText = "position:fixed;top:12px;right:12px;z-index:999999;";
  const overlayShadow = overlayHost.attachShadow({ mode: "open" });
  const box = document.createElement("div");
  box.style.cssText = `
    padding:10px 12px;border-radius:10px;
    background:rgba(0,0,0,0.75);color:#fff;
    font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    white-space: pre-line;
    max-width: 320px;
  `;
  box.textContent = "Wordle Entropy: loading…";
  overlayShadow.appendChild(box);
  document.documentElement.appendChild(overlayHost);

  // ---------------- Load answer list ----------------
  async function loadAnswers() {
    const url = chrome.runtime.getURL("answers.json");
    const res = await fetch(url);
    const arr = await res.json();
    return arr
      .map(w => String(w).toLowerCase())
      .filter(w => /^[a-z]{5}$/.test(w));
  }
  const ANSWERS = await loadAnswers();

  // ---------------- Wordle scoring (handles duplicates) ----------------
  // base-3 digits per tile: 0=absent, 1=present, 2=correct => code in [0..242]
  function patternCode(guess, answer) {
    const res = [0, 0, 0, 0, 0];
    const counts = Object.create(null);

    for (let i = 0; i < 5; i++) counts[answer[i]] = (counts[answer[i]] || 0) + 1;

    // greens
    for (let i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) {
        res[i] = 2;
        counts[guess[i]] -= 1;
      }
    }
    // yellows
    for (let i = 0; i < 5; i++) {
      if (res[i] === 0) {
        const g = guess[i];
        if ((counts[g] || 0) > 0) {
          res[i] = 1;
          counts[g] -= 1;
        }
      }
    }
    let code = 0;
    for (let i = 0; i < 5; i++) code = code * 3 + res[i];
    return code;
  }

  function entropyForGuess(guess, candidates) {
    if (!/^[a-z]{5}$/.test(guess)) return null;
    const N = candidates.length;
    if (N === 0) return null;

    const buckets = new Uint16Array(243);
    for (const ans of candidates) buckets[patternCode(guess, ans)]++;

    let H = 0;
    let expectedRemaining = 0;
    for (let i = 0; i < 243; i++) {
      const c = buckets[i];
      if (!c) continue;
      const p = c / N;
      H -= p * Math.log2(p);
      expectedRemaining += p * c;
    }
    return { H, expectedRemaining, N };
  }

  // ---------------- Shadow root helper ----------------
  function getAnyShadowRoot(el) {
    if (!el) return null;
    if (el.shadowRoot) return el.shadowRoot;
    try {
      if (chrome?.dom?.openOrClosedShadowRoot) {
        return chrome.dom.openOrClosedShadowRoot(el);
      }
    } catch (_) {}
    return null;
  }

  // ---------------- DOM readers (shadow) ----------------
  const evalMap = { absent: 0, present: 1, correct: 2 };
  function normalizeLetter(text) {
    const t = (text || "").trim().toLowerCase();
    const m = t.match(/[a-z]/);
    return m ? m[0] : "";
  }

  // Shadow DOM version: game-row/game-tile with attributes letter/evaluation
  function readShadowBoard() {
    const gameApp = document.querySelector("game-app");
    if (!gameApp) return null;

    // Try $game first (some builds expose it), else try through shadow roots.
    let rows = null;
    if (gameApp.$game) {
      rows = Array.from(gameApp.$game.getElementsByTagName("game-row"));
    } else {
      const sr = getAnyShadowRoot(gameApp);
      if (!sr) return null;
      rows = Array.from(sr.querySelectorAll("game-row"));
      if (!rows.length) return null;
    }

    const board = [];
    for (const row of rows) {
      const rsr = getAnyShadowRoot(row);
      if (!rsr) continue;

      const tiles = Array.from(rsr.querySelectorAll("game-tile"));
      if (tiles.length !== 5) continue;

      const lettersArr = tiles.map(t => normalizeLetter(t.getAttribute("letter")));
      const evalArr = tiles.map(t => t.getAttribute("evaluation"));

      const digits = evalArr.map(e => (e in evalMap ? evalMap[e] : null));
      const letters = lettersArr.join("");
      const submitted = digits.every(d => d !== null) && letters.length === 5;

      const evalCode = submitted ? digits.reduce((a, d) => a * 3 + d, 0) : null;
      board.push({ letters, digits, evalCode, submitted, mode: "shadow", tiles });
    }

    return board.length ? board : null;
  }

  function getSnapshot(board) {
    const submitted = board
      .filter(r => r.submitted)
      .map(r => ({ guess: r.letters, evalCode: r.evalCode }));

    // Current typed row = first non-submitted row with at least 1 letter
    const typedRow = board.find(r => !r.submitted && r.letters.length > 0) || null;
    const typed = typedRow?.letters || "";

    return { submitted, typed };
  }

  function filterCandidates(allAnswers, submitted) {
    let cand = allAnswers;
    for (const { guess, evalCode } of submitted) {
      cand = cand.filter(ans => patternCode(guess, ans) === evalCode);
    }
    return cand;
  }

  // ---------------- Update logic: entropy ONLY at 5 letters ----------------
  let updateTimer = null;
  let lastText = "";

  function scheduleUpdate(readBoardFn) {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      const board = readBoardFn();
      if (!board) return;

      const snap = getSnapshot(board);
      const candidates = filterCandidates(ANSWERS, snap.submitted);

      const typed = snap.typed;

      // IMPORTANT: show entropy only when 5 letters are filled
      let text = `Candidates: ${candidates.length}`;
      if (typed.length !== 5) {
        text += `\nType 5 letters to see entropy.`;
      } else {
        const ent = entropyForGuess(typed, candidates);
        if (!ent) {
          text += `\nGuess: "${typed}"\nEntropy: —`;
        } else {
          text +=
            `\nGuess: "${typed}"` +
            `\nEntropy: ${ent.H.toFixed(2)} bits` +
            `\nE[remaining]: ${ent.expectedRemaining.toFixed(1)}`;
        }
      }

      if (text !== lastText) {
        lastText = text;
        box.textContent = text;
      }
    }, 50);
  }

  // ---------------- Attach observers ----------------
  function hook(board, readBoardFn) {
    // Observe changes so we update as you type / submit.
    const mo = new MutationObserver(() => scheduleUpdate(readBoardFn));

    // Observe tile attribute changes + text changes
    for (const row of board) {
      for (const tile of row.tiles) {
        mo.observe(tile, {
          attributes: true,
          childList: true,
          subtree: true,
          characterData: true
        });
      }
    }

    scheduleUpdate(readBoardFn);
  }

  // ---------------- Bootstrap: detect which DOM version is present ----------------
  async function waitForBoard() {
    return new Promise((resolve) => {
      const tryDetect = () => {
        const shadowBoard = readShadowBoard();
        if (shadowBoard) return resolve({ board: shadowBoard, readFn: readShadowBoard });

        return null;
      };

      if (tryDetect()) return;

      const obs = new MutationObserver(() => {
        if (tryDetect()) obs.disconnect();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  const { board, readFn } = await waitForBoard();
  hook(board, readFn);
})();
