import { describe, expect, it } from "vitest";
import {
  VOICES, WRITERS, formatTime, hostList, labelFor, nextEpisode, timeSlots, timeZones, voiceCatalog,
  withHostVoice,
} from "../../src/settings/options";

const MON_10AM_CDT = Date.parse("2026-10-19T15:00:00Z");

describe("settings options", () => {
  it("lists every writer and voice provider id the podcast package registers", () => {
    expect(WRITERS.map((w) => w.id)).toEqual(["command", "anthropic", "openai", "ollama"]);
    expect(VOICES.map((v) => v.id)).toEqual(["elevenlabs", "openai", "google", "polly", "azure", "local"]);
    expect(VOICES.filter((v) => !v.paid).map((v) => v.id)).toEqual(["local"]);
    expect(labelFor(VOICES, "elevenlabs")).toBe("ElevenLabs");
    expect(labelFor(VOICES, "someday")).toBe("someday");
  });

  it("writes the time the way the app shows it", () => {
    expect(formatTime("06:00")).toEqual({ clock: "6:00", ampm: "AM" });
    expect(formatTime("00:30")).toEqual({ clock: "12:30", ampm: "AM" });
    expect(formatTime("12:00")).toEqual({ clock: "12:00", ampm: "PM" });
    expect(formatTime("17:45")).toEqual({ clock: "5:45", ampm: "PM" });
  });

  it("offers a time every half hour, plus the saved time when it is off the grid", () => {
    expect(timeSlots("06:00")).toHaveLength(48);
    const slots = timeSlots("06:10");
    expect(slots).toHaveLength(49);
    expect(slots.slice(12, 15)).toEqual(["06:00", "06:10", "06:30"]);
  });

  it("puts the saved and the device time zones first, once each", () => {
    const zones = timeZones("America/Chicago", "Europe/Paris");
    expect(zones.slice(0, 2)).toEqual(["Europe/Paris", "America/Chicago"]);
    expect(zones.filter((z) => z === "America/Chicago")).toHaveLength(1);
    expect(zones).toContain("UTC");
  });

  it("says when the next episode is due, in the episode's time zone", () => {
    expect(nextEpisode(MON_10AM_CDT, "06:00", "America/New_York")).toBe("tomorrow, Tue Oct 20");
    expect(nextEpisode(MON_10AM_CDT, "12:00", "America/New_York")).toBe("today, Mon Oct 19");
    // 15:00 UTC is already midnight Tuesday in Tokyo.
    expect(nextEpisode(MON_10AM_CDT, "06:00", "Asia/Tokyo")).toBe("today, Tue Oct 20");
    expect(nextEpisode(MON_10AM_CDT, "06:00", "Not/AZone")).toBe("");
  });

  it("keeps host names and their order when a voice changes", () => {
    expect(hostList({})).toEqual([{ name: "Host 1", voice: "" }, { name: "Host 2", voice: "" }]);
    const named = { Alex: "nova", Sam: "onyx" };
    expect(withHostVoice(named, 1, "echo")).toEqual({ Alex: "nova", Sam: "echo" });
    expect(Object.keys(withHostVoice(named, 0, "fable"))).toEqual(["Alex", "Sam"]);
    expect(withHostVoice({}, 0, "nova")).toEqual({ "Host 1": "nova" });
    expect(withHostVoice({ "Host 1": "nova" }, 1, "onyx")).toEqual({ "Host 1": "nova", "Host 2": "onyx" });
  });

  it("has built-in voice names for providers whose voice ids are names", () => {
    expect(voiceCatalog("openai")).toContain("nova");
    expect(voiceCatalog("google")).toContain("Kore");
    expect(voiceCatalog("elevenlabs")).toEqual([]);
  });
});
