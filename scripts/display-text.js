import { active } from "./macro-ui.js";
const MODULE_ID = "pf2e-seven-dooms-ru";
const SOURCE_ID = "pf2e-ap200-seven-dooms-for-sandpoint";
const CLASS = "pf2e-seven-dooms-ru";
let catalogue;
const observers = new WeakMap();
const FIELD = /^system\.(?:(?:spell\.system\.)?(?:heightening\.levels\.[^.]+\.|overlays\.[^.]+\.system\.)?)(?:(?:range|target|duration|time|cost)\.value|ritual\.(?:primary\.check|secondary\.checks))$/;

export function isSourceDocument(doc, scope = catalogue?.scope) {
  if (!doc || !scope) return false;
  const actor = doc.actor ?? (doc.documentName === "Actor" ? doc : null);
  const root = actor ?? doc.original ?? doc.parentItem ?? doc;
  const source = root._stats?.compendiumSource ?? root.flags?.core?.sourceId ?? "";
  if (source.startsWith(`Compendium.${SOURCE_ID}.`) || source.startsWith("Compendium.pf2e.seven-dooms-for-sandpoint-bestiary.")) return true;
  if (root.documentName === "Actor" && Object.hasOwn(scope.actors, root.id)) {
    return !source || source === scope.actors[root.id] || scope.actorSourceAliases?.[root.id]?.includes(source) === true;
  }
  return root.documentName === "Item" && scope.items.includes(root.id) && !source;
}

export function displayValue(value, values = catalogue?.displayValues ?? {}) {
  return typeof value === "string" ? (values[value.trim()] ?? value) : value;
}

// Только текстовые узлы печатного блока заклинания. Атрибуты и механические данные не трогаются.
export function translateBlock(block, values = catalogue?.displayValues ?? {}) {
  const keys = Object.keys(values).sort((a, b) => b.length - a.length);
  const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const node = walk.currentNode;
    if (node.parentElement?.closest("input,textarea,select,button,script,style,a")) continue;
    let text = node.textContent;
    for (const key of keys) {
      const start = text.indexOf(key);
      if (start < 0) continue;
      const before = text[start - 1] ?? "";
      const after = text[start + key.length] ?? "";
      if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
      text = text.slice(0, start) + values[key] + text.slice(start + key.length);
    }
    if (text !== node.textContent) node.textContent = text;
  }
}

// Исходное input.value всегда сохраняется. При редактировании показывается именно оно.
function decorateInput(input) {
  if (!FIELD.test(input.name) || input.dataset.sevenDoomsDisplay || input.type !== "text") return;
  const translated = displayValue(input.value);
  if (translated === input.value) return;
  const preview = document.createElement("span");
  preview.classList.add("seven-dooms-ru-display-value");
  preview.textContent = translated;
  preview.tabIndex = 0;
  preview.setAttribute("role", "button");
  preview.setAttribute("aria-label", `${translated}. Изменить исходное значение`);
  preview.title = "Нажмите, чтобы изменить исходное значение";
  input.dataset.sevenDoomsDisplay = "true";
  input.insertAdjacentElement("afterend", preview);
  input.hidden = true;
  const edit = () => { preview.hidden = true; input.hidden = false; input.focus(); };
  preview.addEventListener("click", edit);
  preview.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    edit();
  });
  input.addEventListener("focus", () => { preview.hidden = true; input.hidden = false; });
  input.addEventListener("blur", () => {
    const value = displayValue(input.value);
    preview.textContent = value;
    const hasTranslation = value !== input.value;
    preview.hidden = !hasTranslation;
    input.hidden = hasTranslation;
  });
}

function translateRoot(root, inputs = false) {
  root.classList.add(CLASS);
  for (const block of root.querySelectorAll('.item-block-line, .spell-list .spell[data-item-type="spell"] > div.range')) translateBlock(block);
  if (inputs) for (const input of root.querySelectorAll("input[name]")) decorateInput(input);
}

function renderSheet(app, html) {
  if (!active() || !isSourceDocument(app.document ?? app.object)) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  translateRoot(root, true);
  observers.get(app)?.disconnect();
  const observer = new MutationObserver(() => { if (active()) translateRoot(root, true); });
  observer.observe(root, { childList: true, subtree: true });
  observers.set(app, observer);
}

function renderChat(message, html) {
  if (!active()) return;
  const actor = game.actors.get(message.speaker?.actor);
  const origin = message.flags?.pf2e?.origin?.uuid;
  const item = origin ? fromUuidSync(origin) : null;
  if (!isSourceDocument(item) && !isSourceDocument(actor)) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (root) translateRoot(root);
}

Hooks.once("ready", async () => {
  if (!game.modules.get(SOURCE_ID)?.active) return;
  const response = await fetch(`modules/${MODULE_ID}/data/macro-ui-strings.json`);
  if (!response.ok) throw new Error("Не удалось загрузить русское отображение системных строк.");
  catalogue = await response.json();
  Hooks.on("renderApplication", renderSheet);
  Hooks.on("renderApplicationV2", renderSheet);
  Hooks.on("renderActorSheet", renderSheet);
  Hooks.on("renderItemSheet", renderSheet);
  Hooks.on("closeApplication", (app) => observers.get(app)?.disconnect());
  Hooks.on("closeApplicationV2", (app) => observers.get(app)?.disconnect());
  Hooks.on("closeActorSheet", (app) => observers.get(app)?.disconnect());
  Hooks.on("closeItemSheet", (app) => observers.get(app)?.disconnect());
  Hooks.on("renderChatMessageHTML", renderChat);
});
