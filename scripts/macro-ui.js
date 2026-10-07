const MODULE_ID = "pf2e-seven-dooms-ru";
const SOURCE_ID = "pf2e-ap200-seven-dooms-for-sandpoint";
const CLASS = "pf2e-seven-dooms-ru";
let catalogue;
let macroContext = false;
const readAloudClicks = new WeakMap();
let dispatchedClicks = [];
const verifiedCommands = new Map();
const pendingExits = new Map();

export function active() {
  return game.i18n.lang === "ru" && game.modules.get(SOURCE_ID)?.active === true;
}

export function translateText(value, strings = catalogue?.strings ?? {}) {
  return typeof value === "string" ? (strings[value] ?? value) : value;
}

// Копируются только контейнеры отображения; функции, пути, ID и действия сохраняются.
export function translateOptions(options = {}, strings, defaults = {}) {
  const out = { ...options, classes: [...(options.classes ?? [])] };
  if (!out.classes.includes(CLASS)) out.classes.push(CLASS);
  out.window = { ...options.window, title: translateText(options.window?.title ?? defaults.title, strings) };
  if (typeof options.content === "string") out.content = translateText(options.content, strings);
  out.ok = { ...options.ok, label: translateText(options.ok?.label ?? defaults.ok ?? "Close", strings) };
  return out;
}

export function makeApiWrapper(original, kind, strings, enabled = active) {
  return function (...args) {
    if (!enabled()) return original.apply(this, args);
    const choicesIndex = kind === "pickMacro" ? 0 : 2;
    const optionsIndex = choicesIndex + 1;
    const choices = args[choicesIndex] ?? [];
    args[choicesIndex] = choices.map((choice) => {
      const translated = { ...choice };
      for (const field of ["label", "group"]) {
        if (typeof choice[field] === "string") translated[field] = translateText(choice[field], strings);
      }
      return translated;
    });
    args[optionsIndex] = translateOptions(args[optionsIndex], strings, {
      title: kind === "pickMacro" ? "Execute Macro" : "Change Tile Image"
    });
    return original.apply(this, args);
  };
}

function translateHTML(content) {
  if (typeof content !== "string") return content;
  const template = document.createElement("template");
  template.innerHTML = content;
  // Поля получателей содержат имена пользователей; переводим только подписи формы и подсказку.
  for (const element of template.content.querySelectorAll(".hint, .form-group > label")) {
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent.trim();
      const translated = translateText(text);
      if (translated !== text) node.textContent = node.textContent.replace(text, translated);
    }
  }
  return template.innerHTML;
}

async function verifyMacro(macro) {
  const expected = catalogue?.macroCommandHashes[macro.id];
  verifiedCommands.delete(macro.id);
  if (!expected || macro.type !== "script") return;
  const command = macro.command;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(command));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash === expected && macro.command === command) verifiedCommands.set(macro.id, command);
}

function installNotifications() {
  const proto = CONFIG.Macro.documentClass.prototype;
  const execute = proto.execute;
  proto.execute = function (...args) {
    const previous = macroContext;
    macroContext = active() && verifiedCommands.get(this.id) === this.command;
    const scope = args[0] ?? {};
    const actorId = scope.token?.actor?.id ?? scope.actor?.id ?? canvas.tokens?.controlled?.[0]?.actor?.id;
    const sceneId = scope.token?.scene?.id ?? canvas.scene?.id;
    const exit = macroContext && this.id === "W4uW8TBUFyfiabR7" && catalogue.scope.scenes.includes(sceneId)
      && ["ecqOHEl8XRfXrQUj", "abBSh56KTwnv53PO", "Xrwz0r4y4wKiEZfr", "4ws2PCdkV5QVEJ49"].includes(actorId);
    const key = exit ? Symbol() : null;
    if (key) pendingExits.set(key, { sceneId, userId: game.user.id });
    try {
      const result = execute.apply(this, args);
      if (key) {
        if (result?.then) result.then(() => pendingExits.delete(key), () => pendingExits.delete(key));
        else pendingExits.delete(key);
      }
      return result;
    } catch (error) {
      if (key) pendingExits.delete(key);
      throw error;
    } finally { macroContext = previous; }
  };
  const notify = ui.notifications.notify;
  ui.notifications.notify = function (message, ...args) {
    return notify.call(this, macroContext && active() ? translateText(message) : message, ...args);
  };
  Hooks.on("preCreateToken", (token, data, _options, userId) => {
    if (!active() || data.name !== "Tiluatchek" || data.actorId !== "hxncLW8a85xWnOLG") return;
    const actor = game.actors.get(data.actorId);
    const source = actor?._stats?.compendiumSource ?? "";
    if (!actor || !(Object.hasOwn(catalogue.scope.actors, actor.id) && (!source || source === catalogue.scope.actors[actor.id]))) return;
    const matches = Array.from(pendingExits.values()).some((run) => run.sceneId === token.parent?.id && run.userId === userId);
    if (matches) token.updateSource({ name: translateText(data.name) });
  });
  Hooks.on("createMacro", verifyMacro);
  Hooks.on("updateMacro", verifyMacro);
  Hooks.on("deleteMacro", (macro) => verifiedCommands.delete(macro.id));
}

export function isSourceJournal(doc) {
  if (!doc || doc.documentName !== "JournalEntry") return false;
  const source = doc._stats?.compendiumSource ?? doc.flags?.core?.sourceId ?? "";
  return catalogue?.scope.journals.includes(doc.id) && (!source || source.startsWith(`Compendium.${SOURCE_ID}.`));
}

function journalUI(app, element) {
  if (!active() || !isSourceJournal(app.document)) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  root.classList.add(CLASS);
  for (const link of root.querySelectorAll(".toc-navigation [data-tooltip]")) {
    link.dataset.tooltip = translateText(link.dataset.tooltip);
  }
  if (!root.dataset.sevenDoomsWhisper) {
    root.dataset.sevenDoomsWhisper = "true";
    root.addEventListener("click", (event) => {
      if (!event.target.closest(".read-aloud") || event.target.closest("a,img")) return;
      readAloudClicks.set(event, { root, document: app.document });
    }, { capture: true });
  }
}

function trackClick(event) {
  dispatchedClicks = dispatchedClicks.filter((value) => value.eventPhase);
  dispatchedClicks.push(event);
}

function takeReadAloudCallback() {
  // Состояние самого события переживает checkpoint между capture и target,
  // но перестаёт действовать сразу после dispatch. Вложенный чужой клик имеет приоритет.
  const event = dispatchedClicks.findLast((value) => value.eventPhase);
  const context = event && readAloudClicks.get(event);
  const matches = Boolean(context && isSourceJournal(context.document)
    && event.currentTarget?.matches?.(".read-aloud")
    && context.root.contains(event.currentTarget));
  // У установленного обработчика ровно один Dialog.input до первого await.
  // Не оставляем разрешение другим callbacks/microtasks того же события.
  if (matches) readAloudClicks.delete(event);
  return matches;
}

// Только три подписи формы импорта конкретного официального Adventure.
export function importerUI(app, element, strings = catalogue?.strings ?? {}) {
  const doc = app.document;
  if (!active() || doc?.documentName !== "Adventure"
    || doc.uuid !== `Compendium.${SOURCE_ID}.adventures.Adventure.pf2ap200adv00001`) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const options = {
    customizeJoin: "Style Login Screen",
    displayJournal: "Display Introduction",
    initialScene: "Activate Scene"
  };
  for (const input of root.querySelectorAll('.import-options input[type="checkbox"][name]')) {
    const source = options[input.name];
    if (!source) continue;
    const group = input.closest(".form-group");
    const label = input.closest("label")
      ?? Array.from(group?.querySelectorAll("label") ?? []).find((node) => node.htmlFor === input.id && input.id)
      ?? group?.querySelector(":scope > label");
    if (!label) continue;
    const walk = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      if (node.textContent.trim() !== source
        || node.parentElement?.closest("input,textarea,select,button,script,style")) continue;
      node.textContent = node.textContent.replace(source, translateText(source, strings));
    }
  }
}

function installJournalUI() {
  globalThis.document?.addEventListener("click", trackClick, { capture: true });
  const Dialog = foundry.applications.api.Dialog;
  const input = Dialog.input;
  Dialog.input = function (options, ...args) {
    if (!active() || options?.window?.title !== "Speak Aloud Message" || !takeReadAloudCallback()) {
      return input.call(this, options, ...args);
    }
    const translated = translateOptions(options, catalogue.strings);
    translated.content = translateHTML(options.content);
    return input.call(this, translated, ...args);
  };
  Hooks.on("renderApplicationV2", journalUI);
  // Только регистрация листа официального приключения; записи иных модулей не меняются.
  if (!active()) return;
  for (const sheets of Object.values(CONFIG.JournalEntry.sheetClasses ?? {})) {
    for (const [key, definition] of Object.entries(sheets)) {
      if (key.startsWith(`${SOURCE_ID}.`) && definition.label === "Seven Dooms for Sandpoint Journal") {
        definition.label = translateText(definition.label);
      }
    }
  }
}

Hooks.once("ready", async () => {
  const source = game.modules.get(SOURCE_ID);
  if (!source?.active) return;
  const response = await fetch(`modules/${MODULE_ID}/data/macro-ui-strings.json`);
  if (!response.ok) throw new Error("Не удалось загрузить подписи «Семи бедствий Сэндпойнта».");
  catalogue = await response.json();
  for (const name of ["pickMacro", "pickTileImage"]) {
    if (typeof source.api?.[name] === "function") source.api[name] = makeApiWrapper(source.api[name], name, catalogue.strings);
  }
  await Promise.all(Array.from(game.macros, verifyMacro));
  installNotifications();
  installJournalUI();
  Hooks.on("renderApplicationV2", (app, element) => importerUI(app, element));
});
