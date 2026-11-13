// ===== Settings =====
const API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";
// Free translation service — no key, no account needed (about 5000 letters per day free)
const TRANSLATE_URL = "https://api.mymemory.translated.net/get";
const RECENT_KEY = "vaarththai-recent";
const THEME_KEY = "vaarththai-theme";
const WORDS_OF_THE_DAY = [
  "serendipity", "resilience", "ephemeral", "luminous", "tranquil", "wanderlust",
  "eloquent", "meticulous", "harmony", "courage", "gratitude", "curiosity",
];

// ===== Page elements =====
const form = document.getElementById("searchForm");
const input = document.getElementById("searchInput");
const clearBtn = document.getElementById("clearBtn");
const searchBtn = document.getElementById("searchBtn");
const recentBox = document.getElementById("recent");
const errorBox = document.getElementById("error");
const loadingBox = document.getElementById("loading");
const resultBox = document.getElementById("result");
const wotdBox = document.getElementById("wotd");
const themeToggle = document.getElementById("themeToggle");

let currentEntry = null;

// ===== Small helper: create an element with class + text =====
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent = safe, no HTML injection
  return node;
}

function show(node) { node.classList.remove("hidden"); }
function hide(node) { node.classList.add("hidden"); }

// ===== Call the Free Dictionary API =====
async function fetchWord(word) {
  const response = await fetch(API_URL + encodeURIComponent(word));
  if (!response.ok) throw new Error("not-found");
  const data = await response.json();
  if (!Array.isArray(data) || !data[0]) throw new Error("not-found");
  return data[0];
}

// ===== Search =====
async function search(rawWord) {
  const word = (rawWord ?? input.value).trim().toLowerCase();
  if (!word) return;

  input.value = word;
  updateClearButton();
  hide(errorBox);
  hide(resultBox);
  hide(wotdBox);
  hide(recentBox);
  show(loadingBox);
  searchBtn.disabled = true;
  searchBtn.textContent = "...";

  try {
    const entry = await fetchWord(word);
    currentEntry = entry;
    renderResult(entry);
    rememberWord(entry.word);
  } catch (err) {
    currentEntry = null;
    errorBox.textContent = `Could not find the word "${word}". Check the spelling and try again.`;
    show(errorBox);
  } finally {
    hide(loadingBox);
    searchBtn.disabled = false;
    searchBtn.textContent = "Search";
  }
}

// ===== Show the result card =====
function renderResult(entry) {
  resultBox.innerHTML = "";

  // Word + phonetic + audio button
  const head = el("div", "word-head");
  const titleWrap = el("div");
  titleWrap.appendChild(el("h2", "", entry.word));
  if (entry.phonetic) titleWrap.appendChild(el("p", "phonetic", entry.phonetic));
  head.appendChild(titleWrap);

  const audioUrl = (entry.phonetics || []).find((p) => p.audio)?.audio;
  if (audioUrl) {
    const audioBtn = el("button", "audio-btn", "🔊");
    audioBtn.setAttribute("aria-label", "Play pronunciation");
    audioBtn.addEventListener("click", () => new Audio(audioUrl).play().catch(() => {}));
    head.appendChild(audioBtn);
  }
  resultBox.appendChild(head);

  // Meanings (noun, verb, adjective...)
  const allSynonyms = new Set();
  (entry.meanings || []).forEach((meaning) => {
    const section = el("section", "meaning");
    const title = el("div", "meaning-title");
    title.appendChild(el("span", "pos", meaning.partOfSpeech));
    title.appendChild(el("span", "line"));
    section.appendChild(title);

    const list = el("ol", "defs");
    meaning.definitions.slice(0, 4).forEach((def, i) => {
      const li = el("li");
      li.appendChild(el("span", "num", String(i + 1)));
      const body = el("div");
      body.appendChild(el("p", "def", def.definition));
      if (def.example) body.appendChild(el("p", "example", `“${def.example}”`));
      li.appendChild(body);
      list.appendChild(li);
    });
    section.appendChild(list);
    resultBox.appendChild(section);

    (meaning.synonyms || []).forEach((s) => allSynonyms.add(s));
  });

  // Synonyms
  const synonyms = [...allSynonyms].slice(0, 10);
  if (synonyms.length > 0) {
    const synBox = el("div", "synonyms");
    synBox.appendChild(el("p", "section-label", "Synonyms"));
    const chips = el("div", "chips");
    synonyms.forEach((syn) => {
      const chip = el("button", "chip syn", syn);
      chip.addEventListener("click", () => search(syn));
      chips.appendChild(chip);
    });
    synBox.appendChild(chips);
    resultBox.appendChild(synBox);
  }

  // Tamil explanation box
  resultBox.appendChild(buildTamilBox(entry));

  // Source link
  if (entry.sourceUrls && entry.sourceUrls[0]) {
    const link = el("a", "source", "🔗 Source");
    link.href = entry.sourceUrls[0];
    link.target = "_blank";
    link.rel = "noreferrer";
    resultBox.appendChild(link);
  }

  show(resultBox);
}

// ===== Tamil meaning (free, no secret key) =====
async function translateToTamil(text) {
  const url = `${TRANSLATE_URL}?q=${encodeURIComponent(text)}&langpair=en|ta`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("translate-failed");
  const data = await response.json();
  if (data.quotaFinished || data.responseStatus !== 200) throw new Error("quota");
  // Some saved answers are wrong (not even Tamil), so pick the first one written in Tamil letters
  const isTamil = (t) => /[\u0B80-\u0BFF]/.test(t || "");
  const candidates = [data.responseData.translatedText, ...(data.matches || []).map((m) => m.translation)];
  const best = candidates.find(isTamil);
  if (!best) throw new Error("translate-failed");
  return best;
}

function buildTamilBox(entry) {
  const box = el("div", "tamil-box");
  const top = el("div", "tamil-top");
  top.appendChild(el("p", "section-label tamil-label", "🌐 Tamil Meaning"));
  const btn = el("button", "tamil-btn", "Explain in Tamil");
  top.appendChild(btn);
  box.appendChild(top);

  const hint = el("p", "tamil-hint", `See the meaning of "${entry.word}" in Tamil.`);
  box.appendChild(hint);
  const output = el("dl", "tamil-output");
  box.appendChild(output);

  btn.addEventListener("click", async () => {
    // Pick what to translate: the word, first 2 meanings, first example
    const defs = [];
    let example = null;
    (entry.meanings || []).forEach((m) => {
      m.definitions.forEach((d) => {
        if (defs.length < 2) defs.push(d.definition);
        if (!example && d.example) example = d.example;
      });
    });

    btn.disabled = true;
    btn.textContent = "Translating…";
    hint.textContent = "Please wait…";
    output.innerHTML = "";

    try {
      const texts = [entry.word, ...defs, ...(example ? [example] : [])];
      const results = await Promise.all(texts.map(translateToTamil));

      addTamilRow(output, "பொருள் (Meaning)", results[0]);
      defs.forEach((def, i) => addTamilRow(output, `விளக்கம் ${i + 1}`, results[i + 1], def));
      if (example) addTamilRow(output, "உதாரணம் (Example)", results[results.length - 1], example);
      hide(hint);
      btn.textContent = "Translate again";
    } catch (err) {
      hint.textContent = err.message === "quota"
        ? "Today's free translation limit is over. Please try again tomorrow."
        : "Could not get the Tamil meaning right now. Please try again.";
      show(hint);
      btn.textContent = "Try again";
    } finally {
      btn.disabled = false;
    }
  });

  return box;
}

function addTamilRow(list, label, tamil, english) {
  const row = el("div", "tamil-row");
  row.appendChild(el("dt", "", label));
  row.appendChild(el("dd", "tamil-text", tamil));
  if (english) row.appendChild(el("dd", "tamil-en", english));
  list.appendChild(row);
}

// ===== Recent searches (saved in browser) =====
function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function rememberWord(word) {
  const list = [word, ...getRecent().filter((w) => w !== word)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

function renderRecent() {
  const list = getRecent();
  recentBox.innerHTML = "";
  if (list.length === 0) return hide(recentBox);
  recentBox.appendChild(el("span", "", "🕘"));
  list.forEach((word) => {
    const chip = el("button", "chip", word);
    chip.addEventListener("click", () => search(word));
    recentBox.appendChild(chip);
  });
  show(recentBox);
}

// ===== Word of the day =====
async function loadWordOfTheDay() {
  const dayIndex = Math.floor(Date.now() / 86400000);
  const word = WORDS_OF_THE_DAY[dayIndex % WORDS_OF_THE_DAY.length];
  try {
    const entry = await fetchWord(word);
    if (currentEntry) return; // user already searched something
    wotdBox.innerHTML = "";
    wotdBox.appendChild(el("p", "section-label wotd-label", "✨ Word of the Day"));

    const wordBtn = el("button", "wotd-word", entry.word);
    wordBtn.addEventListener("click", () => search(entry.word));
    wotdBox.appendChild(wordBtn);

    const firstMeaning = entry.meanings[0];
    if (firstMeaning) {
      const p = el("p", "wotd-def");
      p.appendChild(el("em", "", firstMeaning.partOfSpeech));
      p.appendChild(document.createTextNode(" — " + firstMeaning.definitions[0].definition));
      wotdBox.appendChild(p);
    }
    show(wotdBox);
  } catch {
    hide(wotdBox);
  }
}

// ===== Dark mode =====
function applyTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  themeToggle.textContent = isDark ? "☀️" : "🌙";
}

themeToggle.addEventListener("click", () => {
  const isDark = !document.body.classList.contains("dark");
  applyTheme(isDark);
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
});

// ===== Clear button =====
function updateClearButton() {
  input.value ? show(clearBtn) : hide(clearBtn);
}

input.addEventListener("input", updateClearButton);
clearBtn.addEventListener("click", () => {
  input.value = "";
  updateClearButton();
  input.focus();
});

// ===== Form submit =====
form.addEventListener("submit", (event) => {
  event.preventDefault();
  search();
});

// ===== Start =====
const savedTheme = localStorage.getItem(THEME_KEY);
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
applyTheme(savedTheme ? savedTheme === "dark" : prefersDark);
renderRecent();
loadWordOfTheDay();
