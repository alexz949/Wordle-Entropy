// best_starter.js
const fs = require("fs");

function loadWordList(path) {
  const arr = JSON.parse(fs.readFileSync(path, "utf8"));
  return arr
    .map(w => String(w).toLowerCase())
    .filter(w => /^[a-z]{5}$/.test(w));
}

// base-3 digits: 0=absent, 1=present, 2=correct => code in [0..242]
function patternCode(guess, answer) {
  const res0 = 0, res1 = 0, res2 = 0, res3 = 0, res4 = 0; // (we'll encode later)
  const res = [res0, res1, res2, res3, res4];

  const counts = new Int8Array(26);
  for (let i = 0; i < 5; i++) {
    counts[answer.charCodeAt(i) - 97]++;
  }

  // Greens first
  for (let i = 0; i < 5; i++) {
    const g = guess.charCodeAt(i) - 97;
    const a = answer.charCodeAt(i) - 97;
    if (g === a) {
      res[i] = 2;
      counts[g]--;
    }
  }

  // Yellows second
  for (let i = 0; i < 5; i++) {
    if (res[i] !== 0) continue;
    const g = guess.charCodeAt(i) - 97;
    if (counts[g] > 0) {
      res[i] = 1;
      counts[g]--;
    }
  }

  // Base-3 encode
  let code = 0;
  for (let i = 0; i < 5; i++) code = code * 3 + res[i];
  return code;
}

function scoreGuess(guess, answers) {
  const N = answers.length;
  const buckets = new Uint16Array(243);

  for (let i = 0; i < N; i++) {
    buckets[patternCode(guess, answers[i])]++;
  }

  let H = 0;
  let expectedRemaining = 0;
  for (let i = 0; i < 243; i++) {
    const c = buckets[i];
    if (!c) continue;
    const p = c / N;
    H -= p * Math.log2(p);
    expectedRemaining += p * c;
  }
  return { H, expectedRemaining };
}

function main() {
  const answersPath = process.argv[2] || "answers.json";
  const guessesPath = process.argv[3]; // optional

  const answers = loadWordList(answersPath);
  const guesses = guessesPath ? loadWordList(guessesPath) : answers;

  console.log(`Answers: ${answers.length}`);
  console.log(`Guesses scored: ${guesses.length}`);

  let best = { guess: "", H: -1, expectedRemaining: Infinity };
  const topK = 20;
  const top = [];

  for (let i = 0; i < guesses.length; i++) {
    const g = guesses[i];
    const { H, expectedRemaining } = scoreGuess(g, answers);

    // keep top list (simple)
    top.push({ guess: g, H, expectedRemaining });
    top.sort((a, b) => b.H - a.H);
    if (top.length > topK) top.pop();

    if (H > best.H) best = { guess: g, H, expectedRemaining };

    // tiny progress print every 500
    if ((i + 1) % 500 === 0) {
      process.stdout.write(`Scored ${i + 1}/${guesses.length}\r`);
    }
  }
  process.stdout.write("\n");

  console.log("\nBest by entropy:");
  console.log(best);

  console.log(`\nTop ${topK}:`);
  for (const t of top) {
    console.log(
      `${t.guess}  H=${t.H.toFixed(4)} bits  E[rem]=${t.expectedRemaining.toFixed(2)}`
    );
  }
}

main();
