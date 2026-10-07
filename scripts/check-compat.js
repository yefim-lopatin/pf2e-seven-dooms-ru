const MODULE_ID = "pf2e-seven-dooms-ru";
const SOURCE_ID = "pf2e-ap200-seven-dooms-for-sandpoint";
const ADVENTURE_UUID = `Compendium.${SOURCE_ID}.adventures.Adventure.pf2ap200adv00001`;
const JOURNAL_ID = "pf2ap20005shadow";
const PAGE_ID = "05strangedream00";
const SHEET = `${SOURCE_ID}.MetaMorphicJournalEntrySheet`;

function enabled() {
  return game.i18n.lang === "ru"
    && game.modules.get(MODULE_ID)?.active === true
    && game.modules.get(SOURCE_ID)?.active === true;
}

export function isSourcePage(page) {
  if (page?.documentName !== "JournalEntryPage" || page.id !== PAGE_ID) return false;
  const journal = page.parent;
  if (journal?.documentName !== "JournalEntry" || journal.id !== JOURNAL_ID) return false;
  const journalUUID = `${ADVENTURE_UUID}.JournalEntry.${JOURNAL_ID}`;
  const pageUUID = `${journalUUID}.JournalEntryPage.${PAGE_ID}`;
  // Явное происхождение из чужого документа исключает даже совпадающие ID.
  for (const [doc, expected] of [[journal, journalUUID], [page, pageUUID]]) {
    for (const source of [doc._stats?.compendiumSource, doc.flags?.core?.sourceId]) {
      if (source && source !== expected) return false;
    }
  }
  if (journal.parent?.documentName === "Adventure") return journal.parent.uuid === ADVENTURE_UUID;
  // Foundry14 не записывает compendiumSource в JournalEntry при импорте Adventure.
  // Поэтому исходные ID подтверждаются назначенным листом и записью точного импорта.
  return !journal.pack && journal.flags?.core?.sheetClass === SHEET
    && Boolean(game.settings.get("core", "adventureImports")?.[ADVENTURE_UUID]);
}

export function makeCheckWrapper(original) {
  return function (match, options = {}, ...rest) {
    if (!enabled() || !isSourcePage(options.relativeTo)
      || match?.[1] !== "Check" || !/^diplolmacy(?=\||$)/.test(match[2] ?? "")) {
      return original.call(this, match, options, ...rest);
    }
    // Только временная копия совпадения для штатного PF2e. Данные страницы не меняются.
    const corrected = Object.assign([...match], match);
    corrected[0] = match[0].replace(/^@Check\[diplolmacy(?=\||\])/, "@Check[diplomacy");
    corrected[2] = match[2].replace(/^diplolmacy(?=\||$)/, "diplomacy");
    const result = original.call(this, corrected, options, ...rest);
    const localizeFlavor = (element) => {
      if (element?.dataset?.pf2Check === "diplomacy" && element.dataset.pf2RepostFlavor === "diplomacy") {
        element.dataset.pf2RepostFlavor = "Дипломатия";
        if (typeof element.dataset.pf2Label === "string") {
          element.dataset.pf2Label = element.dataset.pf2Label.replace(/\bdiplomacy\b/g, "Дипломатия");
        }
      }
      return element;
    };
    if (typeof result?.then === "function") {
      result.then(localizeFlavor, () => {});
      return result;
    }
    return localizeFlavor(result);
  };
}

Hooks.once("ready", () => {
  const editor = game.pf2e?.TextEditor;
  if (typeof editor?.enrichString !== "function") return;
  libWrapper.register(MODULE_ID, "game.pf2e.TextEditor.enrichString", function (wrapped, ...args) {
    return makeCheckWrapper(wrapped).call(this, ...args);
  }, "WRAPPER");
});
