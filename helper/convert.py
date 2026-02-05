import json, re

words = []
with open("wordle-allowed-guesses.txt", "r", encoding="utf-8") as f:
    for line in f:
        w = line.strip().lower()
        if re.fullmatch(r"[a-z]{5}", w):
            words.append(w)

words = sorted(set(words))
with open("guesses.json", "w", encoding="utf-8") as f:
    json.dump(words, f)
print("Wrote", len(words), "words")
