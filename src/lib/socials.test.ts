import { describe, expect, it } from "vitest";
import { SOCIAL_KINDS, socialsFor } from "./socials";
import { dictionary } from "../i18n";
import { LANGS } from "../i18n/native";
import type { Social } from "../types";

const vk: Social = { kind: "vk", url: "https://vk.com/game" };
const tg: Social = { kind: "telegram", url: "https://t.me/game" };
const x: Social = { kind: "x", url: "https://x.com/game" };
const yt: Social = { kind: "youtube", url: "https://www.youtube.com/@game" };

describe("соцсети выбранной игры", () => {
  it("берётся список языка интерфейса, в порядке из данных", () => {
    const socials = { ru: [vk, tg], en: [x, yt] };
    expect(socialsFor(socials, "ru")).toEqual([vk, tg]);
    expect(socialsFor(socials, "en")).toEqual([x, yt]);
  });

  it("нет списка для языка интерфейса — берётся другой", () => {
    expect(socialsFor({ en: [x, yt] }, "ru")).toEqual([x, yt]);
    expect(socialsFor({ ru: [vk] }, "en")).toEqual([vk]);
  });

  it("пустой список для языка — тоже «нет списка»", () => {
    expect(socialsFor({ ru: [], en: [x] }, "ru")).toEqual([x]);
  });

  it("нет ни одного списка — столбика нет", () => {
    expect(socialsFor(undefined, "ru")).toEqual([]);
    expect(socialsFor({}, "en")).toEqual([]);
    expect(socialsFor({ ru: [], en: [] }, "en")).toEqual([]);
  });

  it("незнакомая сеть пропускается: для неё нет ни значка, ни названия", () => {
    const odd = { kind: "whatsapp", url: "https://hoyo.link/w" } as unknown as Social;
    expect(socialsFor({ ru: [odd, vk] }, "ru")).toEqual([vk]);
    // Список, где знакомых сетей не осталось, — всё равно что нет списка.
    expect(socialsFor({ ru: [odd], en: [x] }, "ru")).toEqual([x]);
  });

  it("у каждой сети есть название на обоих языках: подсказка и имя кнопки для диктора", () => {
    for (const lang of LANGS) {
      const { group, names } = dictionary(lang).main.socials;
      expect(group).not.toBe("");
      for (const kind of SOCIAL_KINDS) expect(names[kind], `${lang} ${kind}`).toMatch(/\S/);
    }
    expect(dictionary("ru").main.socials.names.site).toBe("Сайт игры");
    expect(dictionary("en").main.socials.names.site).toBe("Official site");
    expect(dictionary("en").main.socials.names.vk).toBe("VK");
  });

  it("список сетей тот же, что в контракте данных", () => {
    expect([...SOCIAL_KINDS].sort()).toEqual(
      ["hoyolab", "site", "youtube", "x", "discord", "reddit", "facebook", "instagram", "tiktok", "telegram", "vk"].sort(),
    );
  });
});
