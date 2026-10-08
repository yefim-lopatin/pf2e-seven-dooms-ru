import { active, isSourceJournal } from "./macro-ui.js";
import { isSourceDocument } from "./display-text.js";

const MODULE_ID = "pf2e-seven-dooms-ru";
const SERVICES_UUID = "Compendium.pf2e.journals.JournalEntry.S55aqwWIzpQRFhcq.JournalEntryPage.qMNBD91gc5kIKPs2";
const DICE = /(?<![\p{L}\p{N}_])\d*[dдк]\d+(?:\s*[+−-]\s*(?:\d+[dдк]\d+|\d+))*(?![\p{L}\p{N}_])/giu;
const SKIP = "a,button,input,textarea,select,script,style,code,pre,[contenteditable],.trait,.inline-roll,.dice-roll,.dice-formula,.dice-tooltip";
const observers = new WeakMap();
let help;
let scope;

// Только видимый текст: сохранённые документы, технические токены и готовые броски не изменяются.
export function addRollLinks(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) {
    const node = walk.currentNode;
    if (!node.parentElement?.closest(SKIP)) nodes.push(node);
  }
  for (const node of nodes) {
    const text = node.textContent;
    // Не обрабатываем нераскрытые служебные конструкции редактора.
    if (/@[A-Za-z]+\[|\[\[/.test(text)) continue;
    const matches = Array.from(text.matchAll(DICE));
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let position = 0;
    for (const match of matches) {
      const label = match[0];
      const formula = label.replace(/[дк]/gi, "d").replace(/−/g, "-").replace(/\s/g, "");
      if (!Roll.validate(formula)) continue;
      fragment.append(document.createTextNode(text.slice(position, match.index)));
      const link = document.createElement("a");
      link.classList.add("inline-roll", "roll");
      link.dataset.formula = formula;
      link.dataset.mode = game.settings.get("core", "messageMode");
      link.dataset.flavor = "Бросок из «Семи бедствий Сэндпойнта»";
      link.dataset.tooltipText = formula;
      const icon = document.createElement("i");
      icon.classList.add("fa-solid", "fa-dice-d20");
      icon.inert = true;
      link.append(icon, label);
      fragment.append(link);
      position = match.index + label.length;
    }
    if (!position) continue;
    fragment.append(document.createTextNode(text.slice(position)));
    node.replaceWith(fragment);
  }
}

export function decorateJournal(root) {
  for (const trait of root.querySelectorAll(".traits .trait")) {
    const key = trait.textContent.trim().toLocaleLowerCase("ru");
    const description = help.traits[key === "преступник" ? "преступность" : key];
    if (!description) continue;
    trait.dataset.tooltip = description;
    trait.dataset.tooltipDirection = "UP";
    trait.tabIndex = 0;
  }
  for (const link of root.querySelectorAll("a.content-link")) {
    if (link.dataset.uuid !== SERVICES_UUID
      && !(link.classList.contains("broken") && link.textContent.trim() === "Услуги заклинателя")) continue;
    link.classList.remove("broken");
    link.removeAttribute("data-link");
    link.removeAttribute("draggable");
    link.dataset.sevenDoomsSpellcasting = "true";
    link.dataset.tooltip = "Правила и стоимость услуг заклинателя";
    link.tabIndex = 0;
    link.setAttribute("role", "button");
    const icon = link.querySelector("i");
    if (icon) icon.className = "fa-solid fa-book-open";
  }
}

function improve(root, journal) {
  if (!active()) return;
  if (journal) decorateJournal(root);
  addRollLinks(root);
}

function renderSheet(app, html) {
  if (!help || !active()) return;
  const doc = app.document ?? app.object;
  const journal = isSourceJournal(doc) || isSourceJournal(doc?.parent);
  if (!journal && !isSourceDocument(doc, scope)) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  observers.get(app)?.disconnect();
  improve(root, journal);
  const observer = new MutationObserver(() => {
    observer.disconnect();
    improve(root, journal);
    observer.observe(root, { childList: true, subtree: true });
  });
  observer.observe(root, { childList: true, subtree: true });
  observers.set(app, observer);
}

function renderChat(message, html) {
  if (!help || !active() || message.isRoll) return;
  const actor = game.actors.get(message.speaker?.actor);
  const uuid = message.flags?.pf2e?.origin?.uuid;
  const item = uuid ? fromUuidSync(uuid) : null;
  if (!isSourceDocument(actor, scope) && !isSourceDocument(item, scope)) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (root) addRollLinks(root);
}

Hooks.once("ready", async () => {
  if (!game.modules.get("pf2e-ap200-seven-dooms-for-sandpoint")?.active) return;
  const responses = await Promise.all([
    fetch(`modules/${MODULE_ID}/data/content-help.json`),
    fetch(`modules/${MODULE_ID}/data/macro-ui-strings.json`)
  ]);
  if (responses.some(response => !response.ok)) throw new Error("Не удалось загрузить справку Сэндпойнта.");
  const [data, catalogue] = await Promise.all(responses.map(response => response.json()));
  help = data;
  scope = catalogue.scope;
  const editor = foundry.applications.ux.TextEditor;
  help.traits = Object.fromEntries(await Promise.all(Object.entries(help.traits).map(async ([name, text]) =>
    [name.toLocaleLowerCase("ru"), await editor.enrichHTML(text)])));
  for (const event of ["renderApplication", "renderApplicationV2", "renderActorSheet", "renderItemSheet"]) {
    Hooks.on(event, renderSheet);
  }
  for (const event of ["closeApplication", "closeApplicationV2", "closeActorSheet", "closeItemSheet"]) {
    Hooks.on(event, app => observers.get(app)?.disconnect());
  }
  Hooks.on("renderChatMessageHTML", renderChat);
  const showServices = event => {
    const link = event.target.closest?.("[data-seven-dooms-spellcasting]");
    if (!link || !active()) return;
    event.preventDefault();
    foundry.applications.api.Dialog.prompt({
      window: { title: "Услуги заклинателя" },
      content: help.spellcasting,
      ok: { label: "Закрыть" }
    });
  };
  document.body.addEventListener("click", showServices);
  document.body.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") showServices(event);
  });
  // Окно могло открыться, пока загружалась справка.
  for (const app of foundry.applications.instances.values()) {
    if (app.element) renderSheet(app, app.element);
  }
});
