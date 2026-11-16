import { describe, expect, it } from "vitest";
import {
  NICKNAME_MAX,
  SUGGESTION_ADJECTIVES,
  SUGGESTION_NOUNS,
  USERNAME_MAX,
  USERNAME_MIN,
  buildSuggestion,
  checkNickname,
  checkUsername,
  suggestUsernames,
  type UsernameProblem,
} from "@/server/services/username";

const problemOf = (raw: string, context = {}): UsernameProblem | null => {
  const result = checkUsername(raw, context);
  return result.ok ? null : result.problem;
};

/** A repeatable stand-in for Math.random. */
function sequence(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("checkUsername: shape", () => {
  it("accepts 3 to 20 letters, digits and underscores", () => {
    expect(checkUsername("fox")).toEqual({ ok: true, username: "fox" });
    expect(checkUsername("brave_otter_482")).toEqual({ ok: true, username: "brave_otter_482" });
    expect(checkUsername("a".repeat(USERNAME_MAX)).ok).toBe(true);
  });

  it("refuses names that are too short or too long", () => {
    expect(problemOf("ab")).toBe("too_short");
    expect(problemOf("a".repeat(USERNAME_MIN - 1))).toBe("too_short");
    expect(problemOf("a".repeat(USERNAME_MAX + 1))).toBe("too_long");
  });

  it("refuses spaces, dots, hyphens and other symbols", () => {
    for (const raw of ["sky walker", "sky.walker", "sky-walker", "skywalker!", "skÿwalker", "<b>bold</b>"]) {
      expect(problemOf(raw), raw).toBe("bad_characters");
    }
  });

  it("is case-insensitive: the stored form is lower case, with outer spaces removed", () => {
    expect(checkUsername("  Pixel_Wren_7 ")).toEqual({ ok: true, username: "pixel_wren_7" });
  });

  it("needs at least one letter", () => {
    expect(problemOf("123_45")).toBe("no_letters");
  });

  it("gives a message a teenager can act on for every problem", () => {
    const result = checkUsername("ab");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/too short/i);
  });
});

describe("checkUsername: personal information", () => {
  it("refuses a username that contains the nickname, however it is dressed up", () => {
    const context = { nickname: "Maya" };
    for (const raw of ["maya", "maya_draws", "its_maya_k", "m4ya_plays", "MAYA_9", "ma_ya_x"]) {
      expect(problemOf(raw, context), raw).toBe("contains_nickname");
    }
    expect(problemOf("pixel_wren", context)).toBeNull();
  });

  it("ignores a nickname too short to match safely", () => {
    expect(problemOf("jolly_owl", { nickname: "Jo" })).toBeNull();
  });

  it("refuses anything that looks like an email address", () => {
    expect(problemOf("maya@example.com")).toBe("looks_like_email");
    for (const raw of ["sam_gmail_com", "sam_at_school_com", "hotmail_sam", "sam_dot_com", "sam_co_uk"]) {
      expect(problemOf(raw), raw).toBe("looks_like_email");
    }
  });

  it("refuses anything that looks like a phone number", () => {
    expect(problemOf("07700900123")).toBe("looks_like_phone");
    expect(problemOf("call_07700_900123")).toBe("looks_like_phone");
    expect(problemOf("sam0770090")).toBe("looks_like_phone");
  });

  it("refuses a year, and the two-digit form of the birth year", () => {
    expect(problemOf("sam_2011")).toBe("contains_year");
    expect(problemOf("born1999x")).toBe("contains_year");
    expect(problemOf("sam_11", { birthYear: 2011 })).toBe("contains_year");
    expect(problemOf("sam11", { birthYear: 2011 })).toBe("contains_year");
    // Other two-digit numbers, and the same digits inside a longer number, are fine.
    expect(problemOf("sam_42", { birthYear: 2011 })).toBeNull();
    expect(problemOf("sam_114", { birthYear: 2011 })).toBeNull();
    expect(problemOf("sam_11")).toBeNull();
  });

  it("refuses school-like and place-like words", () => {
    for (const raw of ["oak_school_sam", "stmarys_academy", "year9_gamer", "yr_10_art", "sixthform_sam", "form_7b_x"]) {
      expect(problemOf(raw), raw).toBe("school_or_place");
    }
    for (const raw of ["leeds_lad", "manchester_fan", "from_bristol", "sw1a_1aa", "m11ae"]) {
      expect(problemOf(raw), raw).toBe("school_or_place");
    }
    // Regression: "form" and "class" inside an ordinary word are not a school form or class.
    for (const raw of ["platform_3", "uniform_5", "subclass_9", "class_act"]) {
      expect(problemOf(raw), raw).toBeNull();
    }
  });

  it("refuses names that could be mistaken for the team or Coach", () => {
    for (const raw of ["admin_sam", "the_moderator", "coach_bot", "support_team", "safeguarding1"]) {
      expect(problemOf(raw), raw).toBe("reserved");
    }
  });
});

describe("checkUsername: profanity", () => {
  it("refuses profanity, including with underscores or number swaps", () => {
    for (const raw of ["fuck_this", "f_u_c_k_x", "sh1t_happens", "big_arsehole"]) {
      expect(problemOf(raw), raw).toBe("profanity");
    }
  });

  it("does not refuse innocent words", () => {
    for (const raw of ["class_act", "scunthorpe_fan", "bass_player", "grape_soda", "night_owl_77", "assassin_bug"]) {
      const problem = problemOf(raw);
      expect(problem === "profanity", `${raw} → ${problem}`).toBe(false);
    }
  });
});

describe("suggestUsernames", () => {
  it("offers three different names that pass every rule", () => {
    const suggestions = suggestUsernames(3, { random: sequence(7) });
    expect(suggestions).toHaveLength(3);
    expect(new Set(suggestions).size).toBe(3);
    for (const suggestion of suggestions) {
      expect(checkUsername(suggestion)).toEqual({ ok: true, username: suggestion });
      expect(suggestion).toMatch(/^[a-z]+_[a-z]+_\d{3}$/);
    }
  });

  it("is repeatable with the same random source and avoids taken names", () => {
    const first = suggestUsernames(3, { random: sequence(3) });
    expect(suggestUsernames(3, { random: sequence(3) })).toEqual(first);
    const second = suggestUsernames(3, { random: sequence(3), taken: [first[0] ?? ""] });
    expect(second).not.toContain(first[0]);
    expect(second).toHaveLength(3);
  });

  it("never suggests the two-digit birth year or anything that fails for this profile", () => {
    for (let seed = 1; seed <= 25; seed++) {
      for (const suggestion of suggestUsernames(3, { random: sequence(seed), context: { nickname: "Robin", birthYear: 2012 } })) {
        expect(checkUsername(suggestion, { nickname: "Robin", birthYear: 2012 }).ok, suggestion).toBe(true);
        expect(suggestion).not.toContain("robin");
      }
    }
  });

  it("every word in the lists makes a valid name", () => {
    for (const adjective of SUGGESTION_ADJECTIVES) {
      for (const noun of SUGGESTION_NOUNS) {
        const candidate = buildSuggestion(adjective, noun, 482);
        expect(checkUsername(candidate).ok, candidate).toBe(true);
      }
    }
  });

  it("gives up rather than looping when the random source is stuck", () => {
    expect(suggestUsernames(3, { random: () => 0 })).toHaveLength(1);
  });
});

describe("checkNickname", () => {
  it("accepts a short first name or nickname and tidies spaces", () => {
    expect(checkNickname("  Maya ")).toEqual({ ok: true, nickname: "Maya" });
    expect(checkNickname("Mary  Jane")).toEqual({ ok: true, nickname: "Mary Jane" });
  });

  it("refuses an empty or over-long nickname", () => {
    expect(checkNickname("   ").ok).toBe(false);
    expect(checkNickname("x".repeat(NICKNAME_MAX + 1)).ok).toBe(false);
  });

  it("refuses contact details, links, full names and profanity", () => {
    for (const raw of ["maya@example.com", "www.maya.me", "https://maya", "07700 900123", "Maya Jane Smith", "shithead"]) {
      expect(checkNickname(raw).ok, raw).toBe(false);
    }
  });
});
