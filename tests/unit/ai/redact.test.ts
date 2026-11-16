import { describe, expect, it } from "vitest";
import { looksLikeHighEntropyToken, passesLuhn, redactInput, redactionNotice, scrubForStorage } from "@/server/ai/redact";

const strip = (text: string) => {
  const result = redactInput(text, { now: new Date("2026-11-16T10:00:00Z") });
  if (result.refused) throw new Error(`unexpectedly refused (${result.secret}): ${text}`);
  return result;
};
const kinds = (text: string) => strip(text).redactions.map((r) => r.kind);

describe("redactInput: personal data is stripped and the learner is told", () => {
  it.each([
    ["my email is maya.okafor@example.com thanks", "email", "maya.okafor@example.com"],
    ["ring 07700 900123 later", "phone", "07700 900123"],
    ["call +44 7700 900456", "phone", "7700 900456"],
    ["landline is 020 7946 0958", "phone", "7946 0958"],
    ["my postcode is SW1A 1AA", "postcode", "SW1A 1AA"],
    ["postcode m1 1ae ok", "postcode", "m1 1ae"],
    ["i live at 14 Acacia Avenue", "address", "Acacia"],
    ["its Flat 3, 41b Mill Lane", "address", "Mill Lane"],
    ["born 14/03/2012", "date_of_birth", "14/03/2012"],
    ["my birthday is 3rd June 2011", "date_of_birth", "June 2011"],
    ["dob 2011-06-03", "date_of_birth", "2011-06-03"],
    ["follow @maya_makes", "handle", "maya_makes"],
    ["my insta is maya.makes", "handle", "maya.makes"],
    ["add me on snap: mayam22", "handle", "mayam22"],
    ["my name is Maya Okafor and the filter is broken", "name", "Okafor"],
    ["I'm called Tom", "name", "Tom"],
    ["account 12345678901 here", "number", "12345678901"],
    ["sort code 12-34-56", "number", "12-34-56"],
  ])("%s → removes the %s", (text, kind, secret) => {
    const result = strip(text);
    expect(result.redactions.map((r) => r.kind)).toContain(kind);
    expect(result.text).not.toContain(secret);
    expect(result.notice).toMatch(/^Before sending that to Coach, we took out /);
  });

  it("counts several items and names each kind once", () => {
    const result = strip("email a@example.com or b@example.com, phone 07700 900123");
    expect(result.redactions).toEqual(expect.arrayContaining([{ kind: "email", count: 2 }, { kind: "phone", count: 1 }]));
    expect(result.notice).toContain("email addresses");
    expect(result.notice).toContain("a phone number");
  });

  it.each([
    "the camera preview is black when i press start",
    "the deadline is 12/03/2027 will my app still work",
    "do i use @media for the phone layout",
    "@app.route('/') gives a 404",
    "my science homework is about filters",
    "my screen is broken",
    "my name is not showing on the certificate",
    "i have 3 filters and 12 buttons",
    "set the width to 1024 and height to 768",
    "the colour is #ff8800 and the timer is 10000 ms",
    "my username is not working",
    "h1 3em looks too big",
    "my preview is at https://3f2a9c1b-4d5e-4f6a-8b7c-9d0e1f2a3b4c-00-1abcd2efgh3ij.janeway.replit.dev",
  ])("leaves ordinary text alone: %s", (text) => {
    const result = strip(text);
    expect(result.redactions).toEqual([]);
    expect(result.text).toBe(text);
    expect(result.notice).toBeNull();
  });

  it("only treats a full date as a date of birth when it could be one", () => {
    expect(kinds("we launch on 1 March 2027")).toEqual([]);
    expect(kinds("i was born on 1 March 2027")).toEqual(["date_of_birth"]);
    expect(kinds("5 May 2010 was a good day")).toEqual(["date_of_birth"]);
  });

  it("redactionNotice is null when nothing was removed", () => {
    expect(redactionNotice([])).toBeNull();
  });
});

describe("redactInput: secrets are refused, never forwarded", () => {
  it.each([
    ["my password is Hunter2Rocks!", "password"],
    ["password: sunshine99", "password"],
    ["pw = letmein123", "password"],
    ["login is maya_m and pw: sunshine99", "password"],
    ["my pin is 4821", "password"],
    ["here is my key sk-proj-Ab3dEf6hIj9kLmN0pQrStUvWxYz123456", "api_key"],
    ["sk_live_51Habcdefghijklmnop", "api_key"],
    ["token ghp_aB3dEf6hIj9kLmN0pQrStUvWxYz1234567", "api_key"],
    ["AKIAIOSFODNN7EXAMPLE is my aws key", "api_key"],
    ["AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvWx", "api_key"],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345", "api_key"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV", "api_key"],
    ["my api key is 9f8e7d6c5b4a39281706f5e4d3c2b1a0", "api_key"],
    ["x9Kp2mQ7vL4nR8sT1wZ6yB3cD5fG0hJ why does this not work", "api_key"],
    ["https://example.com/cb?token=abc123def456ghi", "api_key"],
    ["the code is 482913", "one_time_code"],
    ["verification code: 771 204", "one_time_code"],
    ["they texted me a code 4829", "one_time_code"],
    ["otp 123456", "one_time_code"],
    ["4111 1111 1111 1111", "card"],
    ["card number 5555555555554444 cvv 123", "card"],
    ["expiry 04/27 and cvv 321", "card"],
  ])("%s → refused as %s", (text, secret) => {
    const result = redactInput(text);
    expect(result.refused).toBe(true);
    if (result.refused) {
      expect(result.secret).toBe(secret);
      expect(result.message).toMatch(/Coach never needs/);
      // The refusal never repeats the secret back.
      for (const token of text.split(/\s+/).filter((t) => t.length >= 8 && /\d/.test(t))) expect(result.message).not.toContain(token);
    }
  });

  it.each([
    "my password is not working",
    "the password is wrong and i cant log in",
    "how do i make a password box",
    "const user = { name: nameInput.value, password: passInput.value }",
    'password: z.string().min(8)',
    "what is an api key",
    "the code is broken on line 12",
    "getUserMedia2024FallbackHandlerForIOS17Safari is my function",
    "cameraPreviewContainerElement is undefined",
    "i got 1234 points",
  ])("does not refuse ordinary talk: %s", (text) => {
    expect(redactInput(text).refused).toBe(false);
  });

  it("Luhn and entropy helpers behave", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    expect(passesLuhn("4111111111111112")).toBe(false);
    expect(passesLuhn("1234")).toBe(false);
    expect(looksLikeHighEntropyToken("x9Kp2mQ7vL4nR8sT1wZ6yB3cD5fG0hJ")).toBe(true);
    expect(looksLikeHighEntropyToken("cameraPreviewContainerElement")).toBe(false);
    expect(looksLikeHighEntropyToken("short1")).toBe(false);
  });

  it("scrubForStorage blanks a secret rather than keeping it", () => {
    expect(scrubForStorage("my password is Hunter2Rocks!")).not.toContain("Hunter2Rocks");
    expect(scrubForStorage("email me at a@example.com")).toBe("email me at [email removed]");
  });
});
