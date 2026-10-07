import { DocumentConverter } from "/modules/babele/script/converter/document-converter.js";

// Полные местные Item-переводы применяются штатным преобразователем Babele.
// Поиск внешнего перевода отключён только у этого отдельного имени.
class SevenDoomsDocumentConverter extends DocumentConverter {
  _fallbackPolicySteps() { return []; }
}

const MODULE_ID = "pf2e-seven-dooms-ru";
const SOURCE_MODULE_ID = "pf2e-ap200-seven-dooms-for-sandpoint";
const TESTED_SOURCE_VERSION = "14.1.0";

Hooks.once("babele.init", (babele) => {
  // Узкие сопоставления хранятся в поле mapping каждого нашего файла перевода.
  // Глобальные сопоставления Babele и других приключений не изменяются.
  babele.registerConverters({ sevenDoomsDocument: new SevenDoomsDocumentConverter() });
  babele.register({ module: MODULE_ID, lang: "ru", dir: "translations" });
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = Object.freeze({
      sourceModule: SOURCE_MODULE_ID,
      testedSourceVersion: TESTED_SOURCE_VERSION
    });
  }
  if (!game.user?.isGM) return;
  const source = game.modules.get(SOURCE_MODULE_ID);
  if (!source?.active) {
    ui.notifications.error(
      "Перевод «Семь бедствий Сэндпойнта» не загружен: включите официальный модуль pf2e-ap200-seven-dooms-for-sandpoint."
    );
    return;
  }
  if (source.version !== TESTED_SOURCE_VERSION) {
    ui.notifications.warn(
      `Перевод «Семь бедствий Сэндпойнта» проверен с версией ${TESTED_SOURCE_VERSION}; установлена ${source.version}. Перед импортом проверьте журналы и карточки.`
    );
  }
});
// Babele иначе заменяет сюжетные маски именами прототипов актёров.
const ADVENTURE_UUID = `Compendium.${SOURCE_MODULE_ID}.adventures.Adventure.pf2ap200adv00001`;
// Флаг живёт только внутри синхронного события; настройка мира не меняется.
let preserveImportedTokenNames = false;

Hooks.once("ready", () => {
  if (!game.modules.get("lib-wrapper")?.active) return;

  libWrapper.register(MODULE_ID, "game.settings.get", function (wrapped, namespace, key, ...args) {
    const value = wrapped(namespace, key, ...args);
    if (preserveImportedTokenNames
      && namespace === "babele" && key === "syncImportedAdventureTokenNames") return false;
    return value;
  }, "WRAPPER");

  libWrapper.register(MODULE_ID, "Hooks.callAll", function (wrapped, event, ...args) {
    if (event !== "importAdventure") return wrapped(event, ...args);
    const previous = preserveImportedTokenNames;
    preserveImportedTokenNames = args[0]?.uuid === ADVENTURE_UUID
      && game.i18n.lang === "ru"
      && [MODULE_ID, SOURCE_MODULE_ID, "babele", "pf2e-ru", "ru-ru", "lib-wrapper"]
        .every((id) => game.modules.get(id)?.active);
    try {
      return wrapped(event, ...args);
    } finally {
      preserveImportedTokenNames = previous;
    }
  }, "WRAPPER");
});
